import { Injectable } from '@nestjs/common';

/**
 * Phase 13 — email delivery abstraction.
 *
 * The concrete production email adapter is SMTP (nodemailer), selected with
 * EMAIL_PROVIDER=smtp. The factory is configuration-driven and FAILS SAFE:
 * in production, without a real provider wired up, it refuses to operate
 * rather than pretending an email was sent. Provider credentials must come
 * exclusively from environment variables (never source, never NEXT_PUBLIC_*
 * variables).
 */

export interface SendEmailRequest {
  to: string;
  subject: string;
  body: string;
  /** Optional sender override; defaults to the EMAIL_FROM environment variable. */
  from?: string;
}

/** Abstraction over the email delivery channel (SMTP, provider API, ...). */
export interface EmailSender {
  readonly name: string;
  send(message: SendEmailRequest): Promise<void>;
}

/** Development-only sender. Never logs message content or tokens; NEVER enabled in production. */
export class DevLogEmailSender implements EmailSender {
  readonly name = 'dev-log';

  async send(message: SendEmailRequest): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      // A production misconfiguration — getEmailSender()/OtpService convert
      // this into 503 (never a generic 500).
      throw new Error('DevLogEmailSender must never run in production');
    }
    // Lazy logger keeps this module importable without the Nest context.
    const { Logger } = await import('@nestjs/common');
    new Logger(DevLogEmailSender.name).log(
      `[DEV ONLY] email delivery simulated for ${message.to}`,
    );
  }
}

/**
 * Real SMTP adapter (nodemailer). The ONLY concrete production email adapter.
 * Credentials come exclusively from environment variables (never source,
 * never NEXT_PUBLIC_* variables):
 *
 *   EMAIL_PROVIDER=smtp
 *   SMTP_HOST=smtp.example.com        (e.g. smtp.gmail.com for Gmail SMTP)
 *   SMTP_PORT=587                     (465 also supported)
 *   SMTP_SECURE=false                 (true when the provider requires implicit TLS, e.g. port 465)
 *   SMTP_USER=<user will enter manually>
 *   SMTP_PASSWORD=<user will enter manually — for Gmail an App Password>
 *   EMAIL_FROM="TANVIONROYALE <no-reply@yourdomain.com>"
 *
 * The SMTP sender account is the APPLICATION's account configured by the
 * owner; OTP recipients can be any address (including user@gmail.com).
 */
export class SmtpEmailSender implements EmailSender {
  readonly name = 'smtp';

  constructor(private readonly transport: NodemailerTransporter) {}

  async send(message: SendEmailRequest): Promise<void> {
    // Fail-safe: an SMTP hiccup must surface as a delivery failure (the caller
    // burns any OTP/token), never as a pretended success.
    await this.transport.sendMail({
      from: message.from ?? ((process.env.EMAIL_FROM ?? '').trim() || undefined),
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  }
}

/** Minimal structural type so the module works with or without @types/nodemailer at compile time. */
interface NodemailerTransporter {
  sendMail(options: { from?: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** Dev-only SMTP option parser shared by the factory below. */
function buildSmtpTransport(): NodemailerTransporter {
  // Lazy require keeps nodemailer out of any bundle that never sends email.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer') as typeof import('nodemailer');
  const host = (process.env.SMTP_HOST ?? '').trim();
  if (!host) {
    throw new Error('Email delivery is not configured (EMAIL_PROVIDER=smtp but SMTP_HOST is missing)');
  }
  const port = Number.parseInt(process.env.SMTP_PORT?.trim() ?? '587', 10);
  const secureEnv = (process.env.SMTP_SECURE ?? '').trim().toLowerCase();
  // Default: implicit TLS on 465, STARTTLS-style otherwise (587).
  const secure = secureEnv ? secureEnv === 'true' || secureEnv === '1' : port === 465;
  const user = (process.env.SMTP_USER ?? '').trim();
  const pass = process.env.SMTP_PASSWORD ?? '';
  const from = (process.env.EMAIL_FROM ?? '').trim();
  if (!from) {
    throw new Error('Email delivery is not configured (EMAIL_FROM is missing)');
  }
  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    ...(user ? { auth: { user, pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/**
 * Returns the configured EmailSender.
 * - EMAIL_PROVIDER unset/"mock": dev-only log sender outside production;
 *   ServiceUnavailableException (fail-safe) in production.
 * - EMAIL_PROVIDER=smtp: real SMTP delivery via nodemailer (credentials from
 *   SMTP_* environment variables — never source code).
 * - Any other value: no adapter exists yet for that provider, so this also
 *   fails safely — a real adapter must be implemented and wired here when a
 *   provider is selected.
 */
export function createEmailSender(): EmailSender {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production';

  if (!provider || provider === 'mock') {
    if (isProduction) {
      throw new Error('Email delivery is not configured');
    }
    return new DevLogEmailSender();
  }

  if (provider === 'smtp') {
    // Throws a clear fail-safe Error when SMTP is half-configured — never
    // silently drops the message and never pretends delivery happened.
    return new SmtpEmailSender(buildSmtpTransport());
  }

  // A provider name is configured but no adapter is implemented for it yet.
  // Fail safely instead of silently dropping the message.
  throw new Error(
    `Email provider "${provider}" is configured but no adapter is implemented. Email delivery is not configured.`,
  );
}

/**
 * Lazy, cached accessor used by services. Mirrors createEmailSender but
 * converts construction failures into the safe HTTP surface error.
 */
export function getEmailSender(): EmailSender {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ServiceUnavailableException } = require('@nestjs/common') as typeof import('@nestjs/common');
  try {
    return createEmailSender();
  } catch {
    // Fail safe: never pretend an email was sent.
    throw new ServiceUnavailableException('Email delivery is not configured');
  }
}

/** Convenience injectable wrapper for DI-based consumers. */
@Injectable()
export class EmailSenderProvider {
  private cached: EmailSender | null = null;
  get(): EmailSender {
    if (!this.cached) this.cached = getEmailSender();
    return this.cached;
  }
}