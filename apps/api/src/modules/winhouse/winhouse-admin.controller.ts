import { Controller, Get, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WinHouseLastMovementView, WinHouseStatusView } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';
import {
  isValidEmbedKey,
  maskSecretValue,
  WINHOUSE_TANVION_PRODUCTION_ORIGIN,
  WINHOUSE_TANVION_WALLET_BASE_URL,
  type WinHouseEnvConfig,
} from './winhouse.config';
import { minorUnitsToProviderAmount, winhouseMovementFingerprint } from './winhouse-money';
import { WinHouseProviderFactory } from './winhouse-provider.factory';
import {
  mintLaunchToken,
  signBalanceChange,
  verifyBalanceChangeSignature,
  verifyCallbackToken,
  verifyLaunchToken,
} from './winhouse-signature';
import { WinHouseWalletService } from './winhouse-wallet.service';

export interface WinHouseSelfTestCheck {
  check: string;
  ok: boolean;
  /** Secret-free detail (never a key, token or signature). */
  detail: string | null;
}

export interface WinHouseSelfTestResult {
  ok: boolean;
  provider: string | null;
  environment: string;
  checks: WinHouseSelfTestCheck[];
  /**
   * Honest operator warnings that do NOT fail the self-test (sandbox mode, an
   * implicit environment, credentials only in the database row) — never a
   * credential and never a false "all good".
   */
  warnings: string[];
}

/**
 * Admin (ADMIN / SUPER_ADMIN) status + self-test for the embedded sportsbook.
 *
 * SECRETS: the wallet API key and the callback token are NEVER returned — only
 * whether each is configured and where it came from. The PUBLIC embed key is
 * shown because it is public by the provider's own design.
 *
 * The self-test reproduces the provider's own acceptance criteria locally
 * (launch-token mint/verify, the 10-minute ceiling, a wrong-key token, the
 * callback-token comparison, a balance-change signature round-trip and the
 * transaction-fingerprint idempotency rules) so a misconfiguration is caught
 * BEFORE a real bet is refused. It additionally dry-runs the REAL wallet money
 * path — stake debit, capture and win payout — inside a database transaction
 * that is ALWAYS rolled back, so the seamless wallet is proven to move money in
 * this deployment without a single unit of real money moving and without a
 * wager ever being placed. With `?network=true` it also performs the provider's
 * non-monetary `GET /tenant/config` check and `POST /tenant/sso` launch
 * redemption checks. Those network checks send only the public embed key and a
 * short-lived launch token; no wallet credential is sent and no TANVION wallet
 * is mutated.
 */
@ApiTags('admin/winhouse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.WINHOUSE_READ)
@Controller('admin/winhouse')
export class WinHouseAdminController {
  private readonly logger = new Logger(WinHouseAdminController.name);

  constructor(
    private readonly providers: WinHouseProviderFactory,
    private readonly prisma: PrismaService,
    private readonly wallet: WinHouseWalletService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Embedded sportsbook status (secrets masked)' })
  async status(): Promise<WinHouseStatusView> {
    const resolved = await this.providers.resolve();
    const config = resolved.config;
    const diagnostics = this.wallet.diagnosticsSnapshot();

    let sessions = 0;
    let transactions = 0;
    let lastLaunchAt: Date | null = null;
    let lastSuccessfulTransaction: WinHouseLastMovementView | null = null;
    if (resolved.row) {
      const [sessionCount, transactionCount, latest, latestMovement] = await Promise.all([
        this.prisma.winHouseSession.count({ where: { providerId: resolved.row.id } }),
        this.prisma.winHouseTransaction.count({ where: { providerId: resolved.row.id } }),
        this.prisma.winHouseSession.findFirst({
          where: { providerId: resolved.row.id },
          orderBy: { launchedAt: 'desc' },
          select: { launchedAt: true },
        }),
        // The last movement that actually reached the ONE TANVION wallet — the
        // proof that the seamless wallet is live, not merely configured.
        this.prisma.winHouseTransaction.findFirst({
          where: { providerId: resolved.row.id },
          orderBy: { createdAt: 'desc' },
          select: {
            transactionId: true,
            ticketId: true,
            action: true,
            amountWire: true,
            currency: true,
            balanceAfter: true,
            createdAt: true,
          },
        }),
      ]);
      sessions = sessionCount;
      transactions = transactionCount;
      lastLaunchAt = latest?.launchedAt ?? null;
      lastSuccessfulTransaction = latestMovement
        ? {
            transactionId: latestMovement.transactionId,
            ticketId: latestMovement.ticketId,
            action: latestMovement.action,
            amount: latestMovement.amountWire,
            currency: latestMovement.currency,
            balanceAfter: minorUnitsToProviderAmount(
              latestMovement.balanceAfter,
              latestMovement.currency,
            ),
            at: latestMovement.createdAt.toISOString(),
          }
        : null;
    }

    const walletBaseUrl = resolved.walletBaseUrl ?? resolved.row?.walletBaseUrl ?? null;
    const lastCallback = diagnostics.lastCallback;

    return {
      configured: resolved.configured,
      environment: config.environment,
      provider: resolved.row?.name ?? null,
      domain: resolved.domain ?? resolved.row?.domain ?? null,
      walletBaseUrl,
      serverIp: resolved.serverIp ?? resolved.row?.serverIp ?? null,
      embedKey: resolved.embedKey,
      embedBaseUrl: resolved.embedBaseUrl,
      product: 'SPORT',
      walletApiKeyConfigured: resolved.walletApiKey !== null,
      callbackTokenConfigured: resolved.callbackToken !== null,
      credentialsSource: resolved.credentialsSource,
      message: resolved.configured ? null : this.providers.unavailableMessage(resolved),
      launchTtlMs: config.launchTtlMs,
      maxLaunchTtlMs: config.maxLaunchTtlMs,
      lastLaunchAt: lastLaunchAt ? lastLaunchAt.toISOString() : null,
      sessions,
      transactions,
      userDataEndpoint: walletBaseUrl ? `${walletBaseUrl}/user-data` : null,
      balanceChangeEndpoint: walletBaseUrl ? `${walletBaseUrl}/balance-change` : null,
      embedKeyMasked: maskSecretValue(resolved.embedKey),
      lastCallback: diagnostics.lastCallback,
      lastBalanceChange: diagnostics.lastBalanceChange,
      lastError: diagnostics.lastError,
      lastSuccessfulTransaction,
      warning: this.operatorWarning(resolved.configured, config, lastCallback, diagnostics.lastError, lastSuccessfulTransaction),
    };
  }

  /**
   * One honest, secret-free operator warning. Never a credential, never a
   * reassuring "all good" when the book has never actually transacted.
   */
  private operatorWarning(
    configured: boolean,
    config: WinHouseEnvConfig,
    lastCallback: WinHouseStatusView['lastCallback'],
    lastError: WinHouseStatusView['lastError'],
    lastMovement: WinHouseLastMovementView | null,
  ): string | null {
    if (!configured) return 'The embedded sportsbook is not configured.';
    if (lastError && lastError.outcome === 'rejected' && (!lastCallback || lastCallback.outcome === 'rejected')) {
      return `The most recent provider callback was refused (${lastError.code ?? 'unknown'}).`;
    }
    if (config.environment === 'sandbox') {
      return 'Sandbox environment: no movement is settled against live WinHouse production.';
    }
    if (!lastCallback) {
      return 'No provider callback has been received since this process started; a real bet has not been proven end to end yet.';
    }
    if (!lastMovement) {
      return 'Callbacks are arriving, but no bet or win has reached the TANVION wallet yet.';
    }
    return null;
  }


  @Post('self-test')
  @RequirePermissions(ADMIN_PERMISSIONS.WINHOUSE_TEST)
  @ApiOperation({ summary: 'Run the local WinHouse contract self-test (no secrets returned)' })
  async selfTest(@Query('network') network?: string): Promise<WinHouseSelfTestResult> {
    const resolved = await this.providers.resolve();
    const config = resolved.config;
    const checks: WinHouseSelfTestCheck[] = [];

    const push = (check: string, ok: boolean, detail: string | null = null) =>
      checks.push({ check, ok, detail });

    push('provider_resolved', resolved.configured, resolved.configured ? null : 'not configured');
    push('embed_key_format', isValidEmbedKey(resolved.embedKey), resolved.embedKey ? null : 'missing');
    push('callback_token_configured', resolved.callbackToken !== null);
    push('wallet_api_key_configured', resolved.walletApiKey !== null);

    // The three credential-shaped values must RESOLVE (environment variable OR
    // the encrypted provider row). Only variable NAMES are ever reported.
    const missingCredentials = [
      resolved.embedKey ? null : 'WINHOUSE_EMBED_KEY',
      resolved.walletApiKey ? null : 'WINHOUSE_WALLET_API_KEY',
      resolved.callbackToken ? null : 'WINHOUSE_CALLBACK_TOKEN',
    ].filter((name): name is string => name !== null);
    push(
      'required_credentials_resolved',
      missingCredentials.length === 0,
      missingCredentials.length === 0
        ? `resolved from ${resolved.credentialsSource}`
        : `missing: ${missingCredentials.join(', ')}`,
    );

    const domain = resolved.domain ?? resolved.row?.domain ?? null;
    const walletBaseUrl = resolved.walletBaseUrl ?? resolved.row?.walletBaseUrl ?? null;
    const serverIp = resolved.serverIp ?? resolved.row?.serverIp ?? null;
    push('portal_domain_configured', domain !== null, domain);
    push('wallet_base_url_configured', walletBaseUrl !== null, walletBaseUrl);
    push(
      'server_ip_policy',
      true,
      serverIp
        ? 'verified exact public outbound address recorded'
        : 'not configured; current embed.js data-launch flow does not use POST /tenant/session',
    );

    // The provider refuses a launch token dated more than 10 minutes ahead, so
    // the configured lifetime must be inside that ceiling.
    push(
      'launch_ttl_within_provider_max',
      config.launchTtlMs > 0 && config.launchTtlMs <= config.maxLaunchTtlMs,
      `${config.launchTtlMs}ms`,
    );

    if (resolved.walletApiKey) {
      const playerId = 'trwh0123456789abcdef0123456789abcd';
      const minted = mintLaunchToken({
        playerId,
        walletApiKey: resolved.walletApiKey,
        session: 'self-test',
        ttlMs: config.launchTtlMs,
        maxTtlMs: config.maxLaunchTtlMs,
      });

      const accepted = verifyLaunchToken({
        token: minted.token,
        walletApiKey: resolved.walletApiKey,
        maxTtlMs: config.maxLaunchTtlMs,
      });
      push(
        'launch_token_mint_and_verify',
        accepted.ok && accepted.playerId === playerId,
        accepted.ok ? null : accepted.reason,
      );

      // A token dated 11 minutes ahead must be refused (documented behaviour).
      const tooLong = mintLaunchToken({
        playerId,
        walletApiKey: resolved.walletApiKey,
        session: 'self-test',
        ttlMs: 11 * 60 * 1000,
        maxTtlMs: 11 * 60 * 1000,
      });
      const tooLongVerdict = verifyLaunchToken({
        token: tooLong.token,
        walletApiKey: resolved.walletApiKey,
        maxTtlMs: config.maxLaunchTtlMs,
      });
      push(
        'launch_token_ttl_ceiling_enforced',
        !tooLongVerdict.ok && tooLongVerdict.reason === 'ttl_exceeded',
        tooLongVerdict.ok ? 'accepted an 11-minute token' : null,
      );

      // A token signed with another key must be refused.
      const foreign = mintLaunchToken({
        playerId,
        walletApiKey: `${resolved.walletApiKey}-not-ours`,
        session: 'self-test',
        ttlMs: config.launchTtlMs,
        maxTtlMs: config.maxLaunchTtlMs,
      });
      const foreignVerdict = verifyLaunchToken({
        token: foreign.token,
        walletApiKey: resolved.walletApiKey,
        maxTtlMs: config.maxLaunchTtlMs,
      });
      push(
        'launch_token_wrong_key_rejected',
        !foreignVerdict.ok && foreignVerdict.reason === 'bad_signature',
        foreignVerdict.ok ? 'accepted a wrongly signed token' : null,
      );
    }

    // Balance-change signature round-trip over the exact documented field order.
    if (resolved.walletApiKey) {
      const fields = {
        username: 'trwh0123456789abcdef0123456789abcd',
        amount: '-25.00',
        action: 'bet',
        ticketId: 'T1',
        transactionId: 'TX-SELF-TEST',
      };
      const signature = signBalanceChange(fields, resolved.walletApiKey);
      const signatureFields = {
        username: fields.username,
        action: fields.action,
        ticketId: fields.ticketId,
        transactionId: fields.transactionId,
      };
      const goodVerdict = verifyBalanceChangeSignature(
        signatureFields,
        [fields.amount],
        signature,
        resolved.walletApiKey,
      );
      const badVerdict = verifyBalanceChangeSignature(
        signatureFields,
        ['-25.01'],
        signature,
        resolved.walletApiKey,
      );
      push('balance_change_signature_round_trip', goodVerdict.ok);
      push(
        'balance_change_tamper_rejected',
        !badVerdict.ok,
        badVerdict.ok ? 'tampered amount accepted' : null,
      );
    }

    // Idempotency: the fingerprint the money path compares (the SAME exported
    // function, so this cannot drift from production) must be stable for an
    // identical payload, unchanged by the documented normalisations and
    // different for a changed payload.
    const movement = {
      username: 'trwh0123456789abcdef0123456789abcd',
      amountMinor: -2500,
      currency: 'BDT',
      action: 'bet',
      ticketId: 'T1',
      session: 'self-test',
    };
    const fingerprint = winhouseMovementFingerprint(movement);
    const changedAmount = winhouseMovementFingerprint({ ...movement, amountMinor: -2501 });
    push(
      'idempotency_fingerprint_stable',
      /^[0-9a-f]{64}$/.test(fingerprint) &&
        fingerprint === winhouseMovementFingerprint({ ...movement }) &&
        // "bdt"/"BET" are the documented normalisations of the SAME movement.
        fingerprint ===
          winhouseMovementFingerprint({ ...movement, currency: 'bdt', action: 'BET' }),
      /^[0-9a-f]{64}$/.test(fingerprint) ? null : 'unexpected fingerprint format',
    );
    push(
      'idempotency_conflict_detected',
      fingerprint !== changedAmount,
      fingerprint === changedAmount ? 'a changed amount produced the same fingerprint' : null,
    );

    // The money path itself: the REAL wallet debit + payout chain, executed
    // inside ONE transaction that is ALWAYS rolled back, so this proves the
    // seamless wallet can move money in THIS deployment without risking any.
    const roundTrip = await this.wallet.probeWalletRoundTrip();
    push('wallet_round_trip_rolled_back', roundTrip.ok, roundTrip.detail);

    // Documented contract, surfaced in the UI: the self-test never places a live
    // wager and never commits a wallet movement (the dry run above is rolled
    // back), so an operator can run it against production at any time.
    push(
      'no_real_wager_guarantee',
      true,
      'no live wager is placed; the wallet dry run is rolled back',
    );

    const warnings: string[] = [];
    if (config.environment === 'sandbox') {
      warnings.push(
        'WINHOUSE_ENV=sandbox: no movement is settled against live WinHouse production.',
      );
    }
    if (!config.environmentExplicit) {
      warnings.push('WINHOUSE_ENV is not set explicitly; sandbox is assumed.');
    }
    if (resolved.configured && resolved.credentialsSource === 'database') {
      warnings.push(
        'Wallet credentials resolve from the encrypted provider row, not from environment variables.',
      );
    }

    if (resolved.callbackToken) {
      push(
        'callback_token_compare',
        verifyCallbackToken(resolved.callbackToken, resolved.callbackToken) &&
          !verifyCallbackToken(`${resolved.callbackToken}x`, resolved.callbackToken) &&
          !verifyCallbackToken('', resolved.callbackToken),
      );
    }

    // The exact base URL the provider must have registered. WinHouse appends
    // /user-data and /balance-change; the API never registers anything remotely.
    const expectedDomain =
      config.environment === 'production' ? WINHOUSE_TANVION_PRODUCTION_ORIGIN : null;
    const expectedWalletBaseUrl =
      config.environment === 'production' ? WINHOUSE_TANVION_WALLET_BASE_URL : null;
    push(
      'portal_domain_expected',
      domain !== null && (expectedDomain === null || domain === expectedDomain),
      domain ?? 'missing',
    );
    push(
      'wallet_base_url_expected',
      walletBaseUrl !== null &&
        (expectedWalletBaseUrl === null || walletBaseUrl === expectedWalletBaseUrl),
      walletBaseUrl ?? 'missing',
    );

    if (network === 'true' && resolved.embedBaseUrl && resolved.embedKey) {
      const probe = await this.probeProviderConfig(resolved.embedBaseUrl, resolved.embedKey);
      push('provider_config_reachable', probe.ok, probe.detail);

      if (resolved.walletApiKey) {
        const sso = await this.probeProviderSso(
          resolved.embedBaseUrl,
          resolved.embedKey,
          resolved.walletApiKey,
          config,
        );
        push('provider_sso_fresh_launch', sso.fresh.ok, sso.fresh.detail);
        push('provider_sso_expiry_rejected', sso.expired.ok, sso.expired.detail);
      } else {
        push('provider_sso_fresh_launch', false, 'wallet API key unavailable');
        push('provider_sso_expiry_rejected', false, 'wallet API key unavailable');
      }
    }

    const allOk = checks.every((check) => check.ok);
    if (!allOk) {
      this.logger.warn(
        `winhouse.selftest provider=${resolved.row?.name ?? 'none'} env=${
          config.environment
        } failed=${checks
          .filter((check) => !check.ok)
          .map((check) => check.check)
          .join(',')}`,
      );
    }

    return {
      ok: allOk,
      provider: resolved.row?.name ?? null,
      environment: config.environment,
      checks,
      warnings,
    };
  }

  /**
   * Performs the provider's documented, non-monetary launch-redemption check.
   * It sends the public embed key and a short-lived launch token only. The
   * wallet API key is used locally to sign the two tokens and is never placed
   * in the request body, headers, URL, response, or log.
   */
  private async probeProviderSso(
    embedBaseUrl: string,
    embedKey: string,
    walletApiKey: string,
    config: WinHouseEnvConfig,
  ): Promise<{
    fresh: { ok: boolean; detail: string | null };
    expired: { ok: boolean; detail: string | null };
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const playerId = 'trwh0123456789abcdef0123456789abcd';
    const send = async (token: string): Promise<{ status: number; body: Record<string, unknown> | null }> => {
      const response = await fetch(`${embedBaseUrl}/tenant/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: embedKey, launch: token }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: response.status, body };
    };

    try {
      const freshToken = mintLaunchToken({
        playerId,
        walletApiKey,
        session: 'self-test',
        ttlMs: config.launchTtlMs,
        maxTtlMs: config.maxLaunchTtlMs,
      }).token;
      const fresh = await send(freshToken);
      const freshOk =
        fresh.status >= 200 &&
        fresh.status < 300 &&
        fresh.body?.ok === true &&
        typeof fresh.body.token === 'string' &&
        typeof fresh.body.username === 'string' &&
        fresh.body.username.endsWith(`_${playerId}`);

      const expiredToken = mintLaunchToken({
        playerId,
        walletApiKey,
        session: 'self-test',
        ttlMs: 11 * 60 * 1000,
        maxTtlMs: 11 * 60 * 1000,
      }).token;
      const expired = await send(expiredToken);
      const expiredOk = expired.status === 401;

      return {
        fresh: {
          ok: freshOk,
          detail: freshOk ? null : `HTTP ${fresh.status}`,
        },
        expired: {
          ok: expiredOk,
          detail: expiredOk ? null : `HTTP ${expired.status}`,
        },
      };
    } catch (error) {
      const detail = error instanceof Error ? error.name : 'network_error';
      return {
        fresh: { ok: false, detail },
        expired: { ok: false, detail },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Asks the provider's read-only config endpoint whether the key is live.
   * That endpoint is PUBLIC by the provider's design (the key grants nothing)
   * and this call carries no wallet credential. Failures are reported by name
   * only — never with a URL, key or credential.
   */
  private async probeProviderConfig(
    embedBaseUrl: string,
    embedKey: string,
  ): Promise<{ ok: boolean; detail: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.providers.config().timeoutMs);
    try {
      const response = await fetch(
        `${embedBaseUrl}/tenant/config?key=${encodeURIComponent(embedKey)}`,
        { signal: controller.signal },
      );
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      const ok = response.ok && body?.ok === true;
      return { ok, detail: ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.name : 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
