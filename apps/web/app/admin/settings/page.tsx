'use client';

/**
 * Admin settings (Phase 4/12/13). Displays the REAL configuration status of
 * the platform using existing endpoints only:
 *  - /api/v1/health → database/provider health
 *  - /api/v1/admin/settings → provider/configuration status without business metrics
 *  - /api/v1/verification/methods → phone/OAuth login availability
 *  - /api/v1/verification/status → face verification provider configuration
 *
 * No secrets or environment values are ever displayed — only availability
 * booleans and names. Missing configuration is reported honestly instead of
 * being faked.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import { apiFetch } from '@/lib/api/client';
import {
  getAdminSettings,
  getAdminSmsProviderSettings,
  updateAdminSmsProviderSettings,
  type AdminSettingsView,
  type AdminSmsProviderSettings,
  type SmsProviderMode,
  type SmsProviderName,
} from '@/lib/api/admin';
import {
  getLoginMethods,
  getVerificationStatus,
  type LoginMethods,
  type VerificationStatus,
} from '@/lib/api/verification';
import { AdminPageHeader, AdminStatusBadge, formatRelative } from '@/components/admin/ui';
import { AdminTableSkeleton, AdminErrorState } from '@/components/admin/data-table';
import { useAdminPermission } from '@/components/admin/admin-guard';
import { useToast } from '@/components/admin/toast';

interface HealthStatus {
  status: string;
  service: string;
  checks: { db: string; redis: string; provider: string };
  timestamp: string;
}

const SMS_MODES: ReadonlyArray<{ value: SmsProviderMode; label: string }> = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'vonage', label: 'Vonage' },
  { value: 'auto', label: 'Auto Failover' },
];

const SMS_PROVIDERS: ReadonlyArray<{ value: SmsProviderName; label: string }> = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'vonage', label: 'Vonage' },
];

// Same field styling the other admin forms use (Admin → Referral).
const smsSelectClass =
  'w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-brand/60 focus:outline-none';
const smsLabelClass = 'flex flex-col gap-1 text-xs font-medium text-slate-400';
const smsOptionClass = 'bg-ink-800 text-slate-100';

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const canReadPartners = useAdminPermission(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ);
  const canWriteSettings = useAdminPermission(ADMIN_PERMISSIONS.SETTINGS_WRITE);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [settings, setSettings] = useState<AdminSettingsView | null>(null);
  const [methods, setMethods] = useState<LoginMethods | null>(null);
  const [verification, setVerification] = useState<VerificationStatus | null>(null);
  const [sms, setSms] = useState<AdminSmsProviderSettings | null>(null);
  const [smsForm, setSmsForm] = useState<{
    smsProvider: SmsProviderMode;
    primarySmsProvider: SmsProviderName;
    fallbackSmsProvider: SmsProviderName;
  } | null>(null);
  const [smsSaving, setSmsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, settingsData, methodsData, verificationData, smsData] =
        await Promise.all([
          apiFetch<HealthStatus>('/health'),
          getAdminSettings(),
          getLoginMethods(),
          getVerificationStatus(),
          getAdminSmsProviderSettings(),
        ]);
      setHealth(healthData);
      setSettings(settingsData);
      setMethods(methodsData);
      setVerification(verificationData);
      setSms(smsData);
      setSmsForm({
        smsProvider: smsData.smsProvider,
        primarySmsProvider: smsData.primarySmsProvider,
        fallbackSmsProvider: smsData.fallbackSmsProvider,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSmsProvider = useCallback(async () => {
    if (!smsForm) return;
    setSmsSaving(true);
    setError(null);
    try {
      const saved = await updateAdminSmsProviderSettings(smsForm);
      setSms(saved);
      setSmsForm({
        smsProvider: saved.smsProvider,
        primarySmsProvider: saved.primarySmsProvider,
        fallbackSmsProvider: saved.fallbackSmsProvider,
      });
      toast('SMS provider saved', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the SMS provider.');
      toast('Failed to save the SMS provider', 'error');
    } finally {
      setSmsSaving(false);
    }
  }, [smsForm, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <AdminPageHeader
        title="Settings"
        description="Platform configuration status. Values come from live endpoints — no secrets are shown, and missing configuration is reported honestly."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Settings' }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <AdminTableSkeleton rows={6} />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className="space-y-6">
          {/* Health */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="health-heading">
            <h2 id="health-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              API health
            </h2>
            {health ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-slate-300">
                  Overall: <span className="font-medium text-white">{health.status}</span>
                </span>
                <span className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-slate-300">
                  Database:{' '}
                  <span className={health.checks.db === 'up' ? 'font-medium text-emerald-300' : 'font-medium text-red-300'}>
                    {health.checks.db}
                  </span>
                </span>
                <span className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-slate-300">
                  Provider: <span className="font-medium text-white">{health.checks.provider}</span>
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Health endpoint did not respond.</p>
            )}
          </section>

          {/* Betting operator */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="operator-heading">
            <h2 id="operator-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Betting operator
            </h2>
            {settings && (
              <p className="text-sm text-slate-300">
                {settings.system.bettingProvider ? (
                  <>
                    Configured operator adapter:{' '}
                    <span className="font-medium text-teal-300">{settings.system.bettingProvider}</span>
                  </>
                ) : (
                  <span className="text-amber-300">
                    Betting provider is not configured. Betting surfaces report &quot;provider not configured&quot; — no
                    demo provider is ever selected in production.
                  </span>
                )}
              </p>
            )}
          </section>

          {/* Partner providers */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="partners-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="partners-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Sports partner providers
              </h2>
               {canReadPartners ? (
                 <Link href="/admin/partner-providers" className="text-xs text-teal-300 hover:underline">
                   Manage →
                 </Link>
               ) : null}
             </div>
             {/* partner configuration list */}
            {settings && settings.providers.length === 0 ? (
              <p className="text-sm text-amber-300">
                Sports provider is not configured — the public sports hub shows no events instead of demo games.
              </p>
            ) : (
              <ul className="space-y-2">
                {(settings?.providers ?? []).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-600 bg-ink-800/60 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-200">
                      {p.name} <span className="text-slate-500">({p.baseUrl})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <AdminStatusBadge value={p.status} />
                      <AdminStatusBadge value={p.syncStatus} />
                      <span className="text-slate-500">last sync {formatRelative(p.lastSyncAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* SMS provider (admin-controlled Twilio / Vonage / auto failover) */}
          <section
            className="rounded-lg border border-ink-600 bg-ink-900 p-4"
            aria-labelledby="sms-provider-heading"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2
                id="sms-provider-heading"
                className="text-sm font-semibold uppercase tracking-wide text-slate-400"
              >
                SMS provider
              </h2>
              {sms ? <AdminStatusBadge value={sms.source} /> : null}
            </div>

            {smsForm && sms ? (
              <div className="space-y-3">
                <label className={smsLabelClass}>
                  Delivery mode
                  <select
                    className={smsSelectClass}
                    value={smsForm.smsProvider}
                    disabled={!canWriteSettings || smsSaving}
                    onChange={(e) =>
                      setSmsForm({
                        ...smsForm,
                        smsProvider: e.target.value as SmsProviderMode,
                      })
                    }
                  >
                    {SMS_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value} className={smsOptionClass}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>

                {smsForm.smsProvider === 'auto' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={smsLabelClass}>
                      Primary provider
                      <select
                        className={smsSelectClass}
                        value={smsForm.primarySmsProvider}
                        disabled={!canWriteSettings || smsSaving}
                        onChange={(e) =>
                          setSmsForm({
                            ...smsForm,
                            primarySmsProvider: e.target.value as SmsProviderName,
                            // The fallback must never equal the primary, so it
                            // follows the primary instead of staying invalid.
                            fallbackSmsProvider:
                              smsForm.fallbackSmsProvider === e.target.value
                                ? e.target.value === 'twilio'
                                  ? 'vonage'
                                  : 'twilio'
                                : smsForm.fallbackSmsProvider,
                          })
                        }
                      >
                        {SMS_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value} className={smsOptionClass}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={smsLabelClass}>
                      Fallback provider
                      <select
                        className={smsSelectClass}
                        value={smsForm.fallbackSmsProvider}
                        disabled={!canWriteSettings || smsSaving}
                        onChange={(e) =>
                          setSmsForm({
                            ...smsForm,
                            fallbackSmsProvider: e.target.value as SmsProviderName,
                          })
                        }
                      >
                        {SMS_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value} className={smsOptionClass}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                <ul className="space-y-1 text-sm text-slate-300">
                  <li>
                    Twilio — Configured:{' '}
                    {sms.twilio.configured ? (
                      <span className="text-teal-300">Yes</span>
                    ) : (
                      <span className="text-amber-300">No</span>
                    )}
                  </li>
                  <li>
                    Vonage — Configured:{' '}
                    {sms.vonage.configured ? (
                      <span className="text-teal-300">Yes</span>
                    ) : (
                      <span className="text-amber-300">No</span>
                    )}
                  </li>
                </ul>

                <p className="text-xs text-slate-500">
                  Provider credentials are configured in the server environment and are never shown
                  or editable here.
                  {sms.updatedAt
                    ? ` Last changed ${formatRelative(sms.updatedAt)} by ${sms.updatedBy ?? 'an administrator'}.`
                    : ' No selection has been saved yet — SMS_PROVIDER from the environment is in use.'}
                </p>

                {canWriteSettings ? (
                  <Button size="sm" onClick={() => void saveSmsProvider()} loading={smsSaving}>
                    Save
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500">
                    Read-only: your staff role cannot change platform settings.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">SMS provider configuration did not respond.</p>
            )}
          </section>

          {/* Login methods */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="login-heading">
            <h2 id="login-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Login methods
            </h2>
            {methods && (
              <ul className="space-y-1 text-sm text-slate-300">
                <li>
                  Phone: <span className="text-teal-300">{methods.phone.join(', ') || 'unavailable'}</span>
                </li>
                <li>
                  Google OAuth:{' '}
                  {methods.google ? (
                    <span className="text-teal-300">configured</span>
                  ) : (
                    <span className="text-amber-300">not configured</span>
                  )}
                </li>
                <li>
                  Facebook OAuth:{' '}
                  {methods.facebook ? (
                    <span className="text-teal-300">configured</span>
                  ) : (
                    <span className="text-amber-300">not configured</span>
                  )}
                </li>
              </ul>
            )}
          </section>

          {/* Verification providers */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="verification-heading">
            <h2 id="verification-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Verification providers
            </h2>
            {verification && (
              <ul className="space-y-1 text-sm text-slate-300">
                <li>
                  Phone (SMS/OTP):{' '}
                  {verification.phone.phone ? (
                    <span className="text-teal-300">active for your account</span>
                  ) : (
                    <span className="text-slate-400">available via Verification Center</span>
                  )}
                </li>
                <li>
                  Face verification provider:{' '}
                  {verification.face.configured ? (
                    <span className="text-teal-300">configured ({verification.face.provider})</span>
                  ) : (
                    <span className="text-amber-300">
                      not configured — face verification is unavailable and never faked
                    </span>
                  )}
                </li>
              </ul>
            )}
          </section>

          {/* Required environment configuration (names only — never values) */}
          <section className="rounded-lg border border-ink-600 bg-ink-900 p-4" aria-labelledby="env-heading">
            <h2 id="env-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Production configuration checklist (variable names only)
            </h2>
            <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <p>• Database: DATABASE_URL</p>
              <p>• Auth: JWT_SECRET, ENCRYPTION_KEY</p>
              <p>• CORS/frontend: CORS_ORIGIN, APP_URL or OAUTH_ALLOWED_REDIRECTS</p>
              <p>• Google OAuth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL</p>
              <p>• Facebook OAuth: FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, FACEBOOK_CALLBACK_URL</p>
              <p>• SMS/OTP: SMS provider credentials (per configured sender)</p>
              <p>• Face verification: provider credentials (per configured provider)</p>
              <p>• Betting operator: OPERATOR_PROVIDER (+ adapter credentials)</p>
              <p>• Payments: payment provider credentials (per configured provider)</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Statuses above derive from live endpoint responses; unset variables fail safely with structured
              configuration errors instead of demo fallbacks.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
