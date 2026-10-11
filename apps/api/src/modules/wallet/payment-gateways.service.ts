import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { decryptSecret, encryptSecret, hasSecret } from '../../common/utils/encryption';
import { HttpGatewayPaymentProvider } from '@tanvion-royale/integrations';

export interface PaymentGatewayView {
  id: string;
  name: string;
  code: string;
  providerType: string;
  baseUrl: string;
  status: string;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  webhookSecretSet: boolean;
  authMode: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const GATEWAY_CODE_RE = /^[a-z0-9_-]{2,40}$/;
const ALLOWED_CURRENCIES = new Set(['BDT', 'USD', 'EUR']);

@Injectable()
export class PaymentGatewaysService {
  private readonly logger = new Logger(PaymentGatewaysService.name);
  constructor(private readonly prisma: PrismaService) {}

  private delegate(): any {
    const d = (this.prisma as any).paymentGatewayConfig;
    if (!d) {
      throw new ServiceUnavailableException('Payment gateway storage is not migrated yet.');
    }
    return d;
  }

  private ensureEncryption(hasSecretValue: boolean): void {
    if (hasSecretValue && process.env.NODE_ENV === 'production') {
      const key = process.env.ENCRYPTION_KEY ?? '';
      if (!key || key.includes('change-me') || key.includes('dev-only')) {
        throw new ServiceUnavailableException('ENCRYPTION_KEY is not configured.');
      }
    }
  }

  private normalizeCode(code: string): string {
    const value = code.trim().toLowerCase();
    if (!GATEWAY_CODE_RE.test(value)) throw new BadRequestException('Invalid gateway code');
    return value;
  }

  private normalizeCurrencies(input: string[] | undefined): string[] {
    if (input === undefined) return ['BDT'];
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestException('At least one supported currency is required');
    }
    const unique = Array.from(new Set(input.map((c) => String(c).trim().toUpperCase())));
    for (const c of unique) {
      if (!ALLOWED_CURRENCIES.has(c)) throw new BadRequestException(`Unsupported currency: ${c}`);
    }
    return unique;
  }

  toView(row: any): PaymentGatewayView {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      providerType: row.providerType,
      baseUrl: row.baseUrl,
      status: row.status,
      apiKeySet: hasSecret(row.apiKeyEnc),
      apiSecretSet: hasSecret(row.apiSecretEnc),
      webhookSecretSet: hasSecret(row.webhookSecretEnc),
      authMode: row.authMode ?? null,
      apiVersion: row.apiVersion ?? null,
      timeoutMs: Number(row.timeoutMs ?? 15000),
      supportedCurrencies: Array.isArray(row.supportedCurrencies) ? row.supportedCurrencies : [],
      depositEnabled: Boolean(row.depositEnabled),
      withdrawalEnabled: Boolean(row.withdrawalEnabled),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(): Promise<PaymentGatewayView[]> {
    const rows = await this.delegate().findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row: any) => this.toView(row));
  }

  async detail(id: string): Promise<PaymentGatewayView> {
    const row = await this.delegate().findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payment gateway not found');
    return this.toView(row);
  }

  async create(auth: AuthenticatedUser, dto: any, ip?: string, userAgent?: string): Promise<PaymentGatewayView> {
    const code = this.normalizeCode(dto.code);
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Gateway name is required');
    this.ensureEncryption(Boolean(dto.apiKey || dto.apiSecret || dto.webhookSecret));
    const byCode = await this.delegate().findUnique({ where: { code } }).catch(() => null);
    if (byCode) throw new ConflictException('A gateway with this code already exists');
    const row = await this.delegate().create({
      data: {
        name, code,
        providerType: String(dto.providerType ?? 'generic-http').trim().toLowerCase() || 'generic-http',
        baseUrl: String(dto.baseUrl).trim().replace(/\/+$/, ''),
        status: 'ACTIVE',
        apiKeyEnc: dto.apiKey ? encryptSecret(dto.apiKey) : null,
        apiSecretEnc: dto.apiSecret ? encryptSecret(dto.apiSecret) : null,
        webhookSecretEnc: dto.webhookSecret ? encryptSecret(dto.webhookSecret) : null,
        authMode: dto.authMode?.trim() || null,
        apiVersion: dto.apiVersion?.trim() || null,
        timeoutMs: dto.timeoutMs ?? 15000,
        supportedCurrencies: this.normalizeCurrencies(dto.supportedCurrencies),
        depositEnabled: dto.depositEnabled ?? true,
        withdrawalEnabled: dto.withdrawalEnabled ?? true,
      },
    });
    await this.audit(auth.id, 'PAYMENT_GATEWAY_CREATED', row.id, { code }, ip, userAgent);
    return this.toView(row);
  }

  async update(id: string, auth: AuthenticatedUser, dto: any, ip?: string, userAgent?: string): Promise<PaymentGatewayView> {
    const existing = await this.delegate().findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment gateway not found');
    this.ensureEncryption(Boolean(dto.apiKey || dto.apiSecret || dto.webhookSecret));
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = String(dto.name).trim();
    if (dto.baseUrl !== undefined) data['baseUrl'] = String(dto.baseUrl).trim().replace(/\/+$/, '');
    if (dto.status !== undefined) data['status'] = dto.status;
    if (dto.depositEnabled !== undefined) data['depositEnabled'] = dto.depositEnabled;
    if (dto.withdrawalEnabled !== undefined) data['withdrawalEnabled'] = dto.withdrawalEnabled;
    if (dto.timeoutMs !== undefined) data['timeoutMs'] = dto.timeoutMs;
    if (dto.apiKey !== undefined) data['apiKeyEnc'] = dto.apiKey === '' ? null : dto.apiKey ? encryptSecret(dto.apiKey) : undefined;
    if (dto.apiSecret !== undefined) data['apiSecretEnc'] = dto.apiSecret === '' ? null : dto.apiSecret ? encryptSecret(dto.apiSecret) : undefined;
    if (dto.webhookSecret !== undefined) data['webhookSecretEnc'] = dto.webhookSecret === '' ? null : dto.webhookSecret ? encryptSecret(dto.webhookSecret) : undefined;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) cleaned[k] = v;
    const updated = await this.delegate().update({ where: { id }, data: cleaned });
    await this.audit(auth.id, 'PAYMENT_GATEWAY_UPDATED', id, { changedFields: Object.keys(cleaned) }, ip, userAgent);
    return this.toView(updated);
  }

  async remove(id: string, auth: AuthenticatedUser, ip?: string, userAgent?: string): Promise<PaymentGatewayView> {
    const existing = await this.delegate().findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment gateway not found');
    const updated = await this.delegate().update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.audit(auth.id, 'PAYMENT_GATEWAY_DELETED', id, { code: existing.code }, ip, userAgent);
    return this.toView(updated);
  }

  async setStatus(id: string, auth: AuthenticatedUser, status: 'ACTIVE' | 'INACTIVE', ip?: string, userAgent?: string): Promise<PaymentGatewayView> {
    const existing = await this.delegate().findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment gateway not found');
    const updated = await this.delegate().update({ where: { id }, data: { status } });
    await this.audit(auth.id, status === 'ACTIVE' ? 'PAYMENT_GATEWAY_ENABLED' : 'PAYMENT_GATEWAY_DISABLED', id, { status }, ip, userAgent);
    return this.toView(updated);
  }

  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const row = await this.delegate().findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payment gateway not found');
    const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : '';
    if (!apiKey) return { ok: false, message: 'Gateway credentials are not configured' };
    try {
      const provider = new HttpGatewayPaymentProvider({
        name: row.code, baseUrl: row.baseUrl, apiKey,
        apiSecret: row.apiSecretEnc ? decryptSecret(row.apiSecretEnc) : undefined,
        timeoutMs: row.timeoutMs ?? 15000,
      });
      void provider;
      return { ok: true, message: 'Gateway configuration is valid. Live status check requires provider-specific health endpoint.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gateway unavailable';
      this.logger.warn(`Gateway test failed: ${message}`);
      return { ok: false, message: 'Gateway unavailable' };
    }
  }

  private async audit(actorId: string, action: string, entityId: string, value: Record<string, unknown>, ip?: string, userAgent?: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { actorId, actorType: 'ADMIN', action, entityType: 'PaymentGatewayConfig', entityId, oldValue: Prisma.JsonNull, newValue: value as Prisma.InputJsonValue, ip, userAgent },
      });
    } catch { /* best-effort */ }
  }
}
