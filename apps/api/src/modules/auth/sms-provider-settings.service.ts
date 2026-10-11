import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  DEFAULT_FALLBACK_SMS_PROVIDER,
  DEFAULT_PRIMARY_SMS_PROVIDER,
  isSmsProviderMode,
  isSmsProviderName,
  type SmsProviderConfigurationStatus,
  type SmsProviderMode,
  type SmsProviderName,
  type SmsProviderSelection,
} from './sms-provider-common';
import {
  getSmsProviderConfigurationStatus,
  normalizeSmsProviderSelection,
  readSmsProviderSelectionFromEnv,
} from './sms-provider-config';

/**
 * SMS PROVIDER SETTINGS (the Admin Panel's persistent SMS selection).
 *
 * STORAGE
 *   One singleton `SmsProviderSettings` row (id = 1), written by the admin API
 *   through the SAME mechanism the referral program settings use. Nothing about
 *   a provider CREDENTIAL is stored or returned here: the row holds the
 *   provider selection only, and credentials remain server/Render environment
 *   variables that never reach an API response, a log line or the browser.
 *
 * PRECEDENCE
 *   The stored selection wins over the environment when it exists, because it
 *   is the operator's most recent explicit decision from the Admin Panel. With
 *   no stored row, `SMS_PROVIDER` behaves exactly as it always has.
 *
 * FAIL-SAFE
 *   A missing row, an unreadable table or a database outage must never take the
 *   OTP flow down: the caller receives `null` and falls back to the environment.
 */

/** The admin-safe projection of the SMS provider configuration. */
export interface SmsProviderSettingsView {
  /** Which provider is selected: twilio | vonage | auto. */
  smsProvider: SmsProviderMode;
  /** Tried first in auto mode: twilio | vonage. */
  primarySmsProvider: SmsProviderName;
  /** Tried once after the primary fails in auto mode: twilio | vonage. */
  fallbackSmsProvider: SmsProviderName;
  /**
   * Where the selection above comes from. `environment` means the Admin Panel
   * has never saved a preference and SMS_PROVIDER is still authoritative.
   */
  source: 'database' | 'environment';
  /** Whether each provider's environment credentials are present. */
  twilio: SmsProviderConfigurationStatus['twilio'];
  vonage: SmsProviderConfigurationStatus['vonage'];
  /** Who last changed the selection, and when (null = never changed). */
  updatedAt: string | null;
  updatedBy: string | null;
}

/** The recommended selection when nothing has been stored or configured. */
const RECOMMENDED_SELECTION: SmsProviderSelection = {
  smsProvider: 'twilio',
  primarySmsProvider: DEFAULT_PRIMARY_SMS_PROVIDER,
  fallbackSmsProvider: DEFAULT_FALLBACK_SMS_PROVIDER,
};

@Injectable()
export class SmsProviderSettingsService {
  private readonly logger = new Logger(SmsProviderSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored selection, or `null` when none exists / the table is not
   * readable yet. Never throws: a settings problem must degrade to the
   * environment, never block an OTP from being sent.
   */
  async getSelection(): Promise<SmsProviderSelection | null> {
    const row = await this.readRowSafely();
    return row ? this.toSelection(row) : null;
  }

  /**
   * The admin-facing configuration view. NEVER contains a credential: only the
   * selection, where it came from, and a per-provider `configured` boolean.
   */
  async getView(): Promise<SmsProviderSettingsView> {
    // ONE row read serves both the selection and the audit stamp.
    const row = await this.readRowSafely();
    const stored = row ? this.toSelection(row) : null;
    const status = getSmsProviderConfigurationStatus();
    const selection = stored ?? this.environmentSelection() ?? RECOMMENDED_SELECTION;
    return {
      smsProvider: selection.smsProvider,
      primarySmsProvider: selection.primarySmsProvider,
      fallbackSmsProvider: selection.fallbackSmsProvider,
      source: stored ? 'database' : 'environment',
      twilio: status.twilio,
      vonage: status.vonage,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /** Maps the stored enum row onto the provider-agnostic selection. */
  private toSelection(row: { smsProvider: string; primarySmsProvider: string; fallbackSmsProvider: string }): SmsProviderSelection {
    return normalizeSmsProviderSelection({
      smsProvider: row.smsProvider.toLowerCase() as SmsProviderMode,
      primarySmsProvider: row.primarySmsProvider.toLowerCase() as SmsProviderName,
      fallbackSmsProvider: row.fallbackSmsProvider.toLowerCase() as SmsProviderName,
    });
  }

  /**
   * Admin-only write of the provider selection. Validated again here (not only
   * in the DTO) so no caller can persist a provider name the delivery factory
   * does not implement, and so a same-provider "failover" is never stored.
   */
  async update(
    patch: Partial<SmsProviderSelection>,
    adminUserId: string,
  ): Promise<SmsProviderSettingsView> {
    const current = (await this.getSelection()) ?? RECOMMENDED_SELECTION;

    const requested: SmsProviderSelection = {
      smsProvider: patch.smsProvider ?? current.smsProvider,
      primarySmsProvider: patch.primarySmsProvider ?? current.primarySmsProvider,
      fallbackSmsProvider: patch.fallbackSmsProvider ?? current.fallbackSmsProvider,
    };

    if (!isSmsProviderMode(requested.smsProvider)) {
      throw new BadRequestException('smsProvider must be one of: twilio, vonage, auto');
    }
    if (!isSmsProviderName(requested.primarySmsProvider)) {
      throw new BadRequestException('primarySmsProvider must be one of: twilio, vonage');
    }
    if (!isSmsProviderName(requested.fallbackSmsProvider)) {
      throw new BadRequestException('fallbackSmsProvider must be one of: twilio, vonage');
    }
    if (requested.primarySmsProvider === requested.fallbackSmsProvider) {
      throw new BadRequestException(
        'The fallback provider must be different from the primary provider',
      );
    }

    // Repairs the ordering (a single-provider mode always names one provider).
    const selection = normalizeSmsProviderSelection(requested);
    const data = {
      smsProvider: selection.smsProvider.toUpperCase() as never,
      primarySmsProvider: selection.primarySmsProvider.toUpperCase() as never,
      fallbackSmsProvider: selection.fallbackSmsProvider.toUpperCase() as never,
      updatedBy: adminUserId,
    };

    await this.prisma.smsProviderSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data } as never,
      update: data as never,
    });

    // Only the provider NAMES are audited. There is no credential in the
    // payload, and this method has no parameter that could add one.
    await this.audit(adminUserId, selection);

    return this.getView();
  }

  /**
   * The raw singleton row, or `null` when it cannot be read. A pending
   * migration, a missing table or a database outage must degrade to the
   * environment default, never break the OTP flow or the admin page.
   */
  private async readRowSafely(): Promise<{
    smsProvider: string;
    primarySmsProvider: string;
    fallbackSmsProvider: string;
    updatedAt: Date;
    updatedBy: string | null;
  } | null> {
    try {
      return await this.prisma.smsProviderSettings.findUnique({
        where: { id: 1 },
        select: {
          smsProvider: true,
          primarySmsProvider: true,
          fallbackSmsProvider: true,
          updatedAt: true,
          updatedBy: true,
        },
      });
    } catch (error) {
      this.logger.warn(
        `sms_provider_settings_unavailable reason=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      return null;
    }
  }

  /**
   * The environment's selection, or `null` when SMS_PROVIDER is unset/mock.
   * An unknown provider name falls back to the recommended selection instead
   * of throwing, so the ADMIN VIEW can always be rendered; the delivery
   * factory keeps its own strict fail-safe for that case.
   */
  private environmentSelection(): SmsProviderSelection | null {
    try {
      const selection = readSmsProviderSelectionFromEnv();
      return selection ? normalizeSmsProviderSelection(selection) : null;
    } catch {
      return null;
    }
  }

  private async audit(actorId: string, selection: SmsProviderSelection): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action: 'SMS_PROVIDER_SETTINGS_UPDATED',
          entityType: 'SmsProviderSettings',
          entityId: '1',
          newValue: selection as never,
        },
      });
    } catch (error) {
      this.logger.warn(
        `sms_provider_settings_audit_failed reason=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}

