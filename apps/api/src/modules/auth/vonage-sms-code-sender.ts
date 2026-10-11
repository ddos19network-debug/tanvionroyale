import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OneTimeCodeSender } from './otp.service';
import {
  MAX_LOGGED_PROVIDER_BODY,
  MAX_LOGGED_PROVIDER_MESSAGE,
  SMS_DELIVERY_FAILED,
  boundLogText,
  buildSmsOtpBody,
  isRedactableSecret,
  sanitizeProviderText,
  smsDeliveryLogLine,
} from './sms-provider-common';

/**
 * VONAGE SMS ADAPTER.
 *
 * WHY NATIVE `fetch` AND NOT THE OFFICIAL SDK
 *   The Twilio adapter in this codebase already talks to the provider over
 *   native `fetch` (no provider SDK is installed for it), so Vonage is added
 *   with the exact same transport rather than introducing a second dependency
 *   strategy for a single HTTP call. This is Vonage's documented SMS API:
 *   POST https://rest.nexmo.com/sms/json, application/x-www-form-urlencoded,
 *   authenticated with the account API key + API secret.
 *
 * OTP LOGIC IS NOT HERE
 *   The adapter never generates, re-generates, stores or expires a code: it
 *   receives the one code OtpService already created and delivers it. That is
 *   what lets a failover deliver the SAME code through a second provider
 *   without burning or creating an OTP.
 *
 * PHONE NUMBERS
 *   The `to` value is passed through EXACTLY as the caller supplies it. That
 *   value is the canonical E.164 string produced by common/utils/phone, so no
 *   normalization is duplicated (or second-guessed) here.
 *
 * NEVER LOGGED
 *   The API key, the API secret, the one-time code, the recipient number and
 *   the request body. Provider text is redacted with the same helpers the
 *   Twilio adapter uses, then length-bounded.
 */

const VONAGE_SMS_ENDPOINT = 'https://rest.nexmo.com/sms/json';

/** Vonage answers HTTP 200 with a per-message status; "0" is the only success. */
const VONAGE_SUCCESS_STATUS = '0';

/** Transport timeout, identical to the Twilio adapter's. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Real Vonage SMS adapter (api key + api secret authentication). */
export class VonageSmsCodeSender implements OneTimeCodeSender {
  readonly channel = 'sms';
  private readonly logger = new Logger(VonageSmsCodeSender.name);

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    /**
     * The Vonage `from` value. Deliberately NOT validated as a phone number:
     * like Twilio, some destinations require an approved alphanumeric sender
     * ID, so whatever the operator configured is passed through verbatim.
     */
    private readonly from: string,
  ) {}

  async send(identifier: string, code: string, purpose: string): Promise<void> {
    const body = new URLSearchParams({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      // Canonical E.164 recipient, unchanged.
      to: identifier,
      from: this.from,
      text: buildSmsOtpBody(code, purpose),
      type: 'text',
    });

    // Everything that must never reach a log line. The request body (which
    // embeds the credentials AND the code) is never logged; the code and the
    // recipient are redacted defensively in case Vonage echoes them back.
    const secrets = [this.apiKey, this.apiSecret, code, identifier].filter(isRedactableSecret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(VONAGE_SMS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });

      const outcome = await this.readVonageOutcome(res, secrets);
      if (outcome.accepted) {
        this.logger.log(smsDeliveryLogLine('vonage', 'success'));
        return;
      }
      this.logger.error(
        smsDeliveryLogLine('vonage', 'failed', { status: outcome.status, code: outcome.code }),
      );
    } catch (error) {
      // Transport-level failure (DNS/TLS/abort/offline): no provider payload
      // exists, so log the failure class only — never credentials or the code.
      this.logger.error(
        smsDeliveryLogLine('vonage', 'failed', {
          status: 'no-response',
          code: error instanceof Error ? error.name : 'unknown',
        }),
      );
    } finally {
      clearTimeout(timeout);
    }

    // The client-facing error stays generic and safe in EVERY failure mode;
    // OtpService then burns the just-issued code and surfaces the 503.
    throw new ServiceUnavailableException(SMS_DELIVERY_FAILED);
  }

  /**
   * Normalizes the Vonage answer into the same shape every SMS provider
   * reports, including the documented quirk that a REJECTED message can still
   * arrive with HTTP 200 (`messages[0].status !== "0"`). Everything it logs is
   * safe: the provider text is redacted and length-bounded first.
   */
  private async readVonageOutcome(
    res: Response,
    secrets: readonly string[],
  ): Promise<{ accepted: boolean; status: number; code: string }> {
    const httpStatus = typeof res?.status === 'number' ? res.status : 0;

    let raw = '';
    try {
      // `text` is optional so a minimal (or mocked) Response cannot break us.
      const text =
        typeof (res as Response | undefined)?.text === 'function' ? await res.text() : '';
      raw = typeof text === 'string' ? text : '';
    } catch {
      // Body unavailable (aborted stream, unreadable body): report the status
      // alone rather than a body we could not safely read.
      raw = '';
    }

    if (!raw.trim()) {
      this.logger.error(
        `Vonage SMS rejected: status=${httpStatus} code=unknown message="(no response body returned)"`,
      );
      return { accepted: false, status: httpStatus, code: 'unknown' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // A body that is NOT valid JSON (HTML error page, proxy text) is still
      // worth having — but bounded, so an arbitrary provider response can
      // never flood the log.
      this.logger.error(
        `Vonage SMS rejected: status=${httpStatus} body=${boundLogText(
          sanitizeProviderText(raw, secrets),
          MAX_LOGGED_PROVIDER_BODY,
        )}`,
      );
      return { accepted: false, status: httpStatus, code: 'unknown' };
    }

    const detail = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    const first = (messages[0] && typeof messages[0] === 'object' ? messages[0] : {}) as Record<
      string,
      unknown
    >;

    const messageStatus = first.status;
    const code =
      typeof messageStatus === 'string' || typeof messageStatus === 'number'
        ? String(messageStatus)
        : 'unknown';
    const rawErrorText = first['error-text'] ?? detail['error-text'];
    const errorText = typeof rawErrorText === 'string' ? rawErrorText : '';

    // Success requires BOTH a 2xx HTTP answer AND Vonage's own status "0".
    const accepted = res?.ok === true && code === VONAGE_SUCCESS_STATUS;

    if (!accepted) {
      this.logger.error(
        `Vonage SMS rejected: status=${httpStatus} code=${code} message="${boundLogText(
          sanitizeProviderText(errorText, secrets),
          MAX_LOGGED_PROVIDER_MESSAGE,
        )}"`,
      );
    }

    return { accepted, status: httpStatus, code };
  }
}
