'use client';

/**
 * Partner provider administration (Phase 6).
 *
 * Connects to the EXISTING /api/v1/admin/partner-providers endpoints.
 * API keys/secrets are AES-256-GCM encrypted at rest by the backend and are
 * NEVER returned by the API — the UI only ever shows whether they are set
 * (masked). Secrets are typed directly into the secure form and sent only
 * to the backend over HTTPS; they are never stored in localStorage and
 * never logged.
 *
 * THREE INTEGRATION SHAPES (one form, three branches)
 *  - SPORTS_API         — server-side sports API: base URL + per-event
 *    deep-link template + API key/secret (the pre-existing behaviour, unchanged);
 *  - SPORTS_IFRAME      — an EMBEDDED sportsbook (WinHouse) rendered inside BIG
 *    SPORT with the provider's own loader: PUBLIC embed key (`ifr_…`, not a
 *    secret), book origin, environment and the two SERVER-ONLY secrets
 *    (wallet API key + callback token, encrypted at rest). No deep-link
 *    template and no fake API secret are requested because an embedded book
 *    has neither.
 *  - CASINO_AGGREGATOR  — the B2B casino aggregator (BigBang): environment
 *    (sandbox | production), the verified base URL and ONE SERVER-ONLY API key
 *    (also the callback HMAC signing key), encrypted at rest and never shown
 *    again. No deep-link template, no embed fields and no WinHouse secrets.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listPartnerProviders,
  createPartnerProvider,
  updatePartnerProvider,
  deletePartnerProvider,
  triggerPartnerSync,
  getWinHouseStatus,
  runWinHouseSelfTest,
  type AdminPartnerProvider,
  type AdminPartnerIntegrationType,
  type AdminSyncSummary,
  type AdminWinHouseCallbackDiagnostic,
  type AdminWinHouseStatus,
  type AdminWinHouseSelfTest,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import {
  AdminPageHeader,
  AdminStatusBadge,
  formatDateTime,
  formatRelative,
} from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminPagination,
} from '@/components/admin/data-table';
import { Modal, ConfirmDialog } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';
import AdminBigBangPortalSection from '@/components/admin/bigbang-portal-section';

interface ProviderFormState {
  name: string;
  baseUrl: string;
  deepLinkTemplate: string;
  authMode: string;
  apiVersion: string;
  status: 'ACTIVE' | 'INACTIVE';
  apiKey: string;
  apiSecret: string;
  clearApiKey: boolean;
  clearApiSecret: boolean;
  /** SPORTS_API (server-side API) or SPORTS_IFRAME (embedded WinHouse book). */
  integrationType: AdminPartnerIntegrationType;
  /** sandbox | production — required for an embedded sportsbook, never mixed. */
  environment: 'sandbox' | 'production';
  /** PUBLIC `ifr_…` embed key (never the wallet API key). */
  embedKey: string;
  /** Book origin the loader/iframe is served from. */
  embedBaseUrl: string;
  /** Exact frontend origin registered under the provider's Domain field. */
  domain: string;
  /** Exact base URL; WinHouse appends /user-data and /balance-change. */
  walletBaseUrl: string;
  /** Optional exact public outbound IP (never guessed). */
  serverIp: string;
  /** Server-only HMAC signing key — encrypted at rest, never displayed again. */
  walletApiKey: string;
  /** Server-only callback token — encrypted at rest, never displayed again. */
  callbackToken: string;
  clearWalletApiKey: boolean;
  clearCallbackToken: boolean;
}

/** The provider's documented default book origin (public, never a secret). */
const WINHOUSE_DEFAULT_EMBED_URL = 'https://iframe.winhouse.bet';
/** Exact production frontend origin verified in repository/deployment config. */
const TANVION_PRODUCTION_ORIGIN = 'https://tanvionroyale.vercel.app';
/** Exact API base WinHouse appends its two documented callback paths to. */
const TANVION_WINHOUSE_WALLET_BASE_URL =
  'https://tanvionroyale.onrender.com/api/v1/winhouse';

/**
 * The verified BigBang aggregator API base URL. Public (it is only a
 * destination, never a credential); the backend rejects any other host/path
 * for a CASINO_AGGREGATOR row.
 */
const BIGBANG_DEFAULT_BASE_URL = 'https://api.bigbangcasino.bet/api/v1';

/** Stable provider adapter code the backend requires for CASINO_AGGREGATOR. */
const BIGBANG_PROVIDER_CODE = 'BIGBANG';

/** PUBLIC embed key shape: `ifr_` + 40 hex characters. */
const EMBED_KEY_PATTERN = /^ifr_[0-9a-f]{40}$/i;

function isExactHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hostname.includes('*') &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.pathname === '' || parsed.pathname === '/')
    );
  } catch {
    return false;
  }
}

function isOfficialEmbedOrigin(value: string): boolean {
  try {
    return isExactHttpsOrigin(value) && new URL(value.trim()).origin === WINHOUSE_DEFAULT_EMBED_URL;
  } catch {
    return false;
  }
}

function isWinHouseWalletBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hostname.includes('*') &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname.replace(/\/+$/, '') === '/api/v1/winhouse'
    );
  } catch {
    return false;
  }
}

const EMPTY_FORM: ProviderFormState = {
  name: '',
  baseUrl: 'https://',
  deepLinkTemplate: '/sport/{sportSlug}/event/{externalEventId}',
  authMode: 'api-key',
  apiVersion: '',
  status: 'ACTIVE',
  apiKey: '',
  apiSecret: '',
  clearApiKey: false,
  clearApiSecret: false,
  integrationType: 'SPORTS_API',
  environment: 'sandbox',
  embedKey: '',
  embedBaseUrl: WINHOUSE_DEFAULT_EMBED_URL,
  domain: TANVION_PRODUCTION_ORIGIN,
  walletBaseUrl: TANVION_WINHOUSE_WALLET_BASE_URL,
  serverIp: '',
  walletApiKey: '',
  callbackToken: '',
  clearWalletApiKey: false,
  clearCallbackToken: false,
};

/** True when the row is an EMBEDDED sportsbook (the provider hosts the book). */
function isEmbeddedBook(integrationType: AdminPartnerIntegrationType): boolean {
  return integrationType === 'SPORTS_IFRAME';
}

/** True when the row is the B2B casino aggregator (BigBang). */
function isCasinoAggregator(integrationType: AdminPartnerIntegrationType): boolean {
  return integrationType === 'CASINO_AGGREGATOR';
}

/** Human label for an integration type (table + form). */
const INTEGRATION_LABELS: Record<AdminPartnerIntegrationType, string> = {
  SPORTS_API: 'Sports API',
  SPORTS_IFRAME: 'BIG SPORT iframe',
  CASINO_API: 'Casino API',
  LIVE_CASINO_API: 'Live casino API',
  CASINO_AGGREGATOR: 'Casino Aggregator (BigBang)',
};

export default function PartnerProvidersPage() {
  const { toast } = useToast();
  const canCreate = useAdminPermission(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_CREATE);
  const canUpdate = useAdminPermission(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_UPDATE);
  const canDelete = useAdminPermission(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_DELETE);
  const canSync = useAdminPermission(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_SYNC);
  const canSelfTest = useAdminPermission(ADMIN_PERMISSIONS.WINHOUSE_TEST);
  const [providers, setProviders] = useState<AdminPartnerProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminPartnerProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPartnerProvider | null>(null);
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Embedded sportsbook (BIG SPORT) status — secret-free read model.
  const [winhouse, setWinHouse] = useState<AdminWinHouseStatus | null>(null);
  const [winhouseTest, setWinHouseTest] = useState<AdminWinHouseSelfTest | null>(null);
  const [winhouseBusy, setWinHouseBusy] = useState(false);
  const [winhouseError, setWinHouseError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const data = await listPartnerProviders();
      setProviders(data);
      return true;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load partner providers.');
      return false;
    }
  }, []);

  /**
   * Reads the embedded-sportsbook status. Called only when the provider list
   * actually contains a SPORTS_IFRAME row, so a deployment without WinHouse
   * never shows the panel and never sees a 403/404 from the endpoint.
   */
  const loadWinHouse = useCallback(async (): Promise<boolean> => {
    setWinHouseError(null);
    try {
      setWinHouse(await getWinHouseStatus());
      return true;
    } catch (err) {
      setWinHouseError(
        err instanceof ApiClientError ? err.message : 'Failed to load the embedded sportsbook status.',
      );
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasEmbeddedBook = (providers ?? []).some((p) => isEmbeddedBook(p.integrationType));
  // The BigBang portal section only renders when a BigBang aggregator row is
  // actually configured, so the panel can never show URLs for a provider that
  // does not exist.
  const hasBigBangAggregator = (providers ?? []).some(
    (p) => p.providerCode === 'BIGBANG' || p.integrationType === 'CASINO_AGGREGATOR',
  );

  useEffect(() => {
    if (hasEmbeddedBook) void loadWinHouse();
  }, [hasEmbeddedBook, loadWinHouse]);

  async function onRunSelfTest() {
    setWinHouseBusy(true);
    setWinHouseError(null);
    try {
      setWinHouseTest(await runWinHouseSelfTest(true));
      if (!(await loadWinHouse())) throw new Error('Self-test completed, but status could not be refreshed.');
    } catch (err) {
      setWinHouseError(
        err instanceof ApiClientError ? err.message : 'The embedded sportsbook self-test failed to run.',
      );
    } finally {
      setWinHouseBusy(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(provider: AdminPartnerProvider) {
    const integration = provider.integrationType ?? 'SPORTS_API';
    setForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      deepLinkTemplate: provider.deepLinkTemplate,
      authMode: provider.authMode ?? '',
      apiVersion: provider.apiVersion ?? '',
      status: provider.status,
      apiKey: '',
      apiSecret: '',
      clearApiKey: false,
      clearApiSecret: false,
      integrationType: integration,
      environment: provider.environment ?? 'sandbox',
      embedKey: provider.embedKey ?? '',
      embedBaseUrl: provider.embedBaseUrl ?? WINHOUSE_DEFAULT_EMBED_URL,
      domain: provider.domain ?? TANVION_PRODUCTION_ORIGIN,
      walletBaseUrl: provider.walletBaseUrl ?? TANVION_WINHOUSE_WALLET_BASE_URL,
      serverIp: provider.serverIp ?? '',
      walletApiKey: '',
      callbackToken: '',
      clearWalletApiKey: false,
      clearCallbackToken: false,
    });
    setEditTarget(provider);
  }

  async function onSave() {
    const embedded = isEmbeddedBook(form.integrationType);
    const aggregator = isCasinoAggregator(form.integrationType);

    // Double-submit guard (Part 35).
    if (saving) return;

    if (!form.name.trim()) {
      toast('Provider name is required.', 'error');
      return;
    }
    if (embedded) {
      if (!EMBED_KEY_PATTERN.test(form.embedKey.trim())) {
        toast('Embed key must look like ifr_ followed by 40 hex characters.', 'error');
        return;
      }
      if (!isOfficialEmbedOrigin(form.embedBaseUrl)) {
        toast(`Embed URL must be the official exact origin ${WINHOUSE_DEFAULT_EMBED_URL}.`, 'error');
        return;
      }
      if (!isExactHttpsOrigin(form.domain)) {
        toast('Domain must be one exact https origin with no path, query, or wildcard.', 'error');
        return;
      }
      if (
        form.environment === 'production' &&
        form.domain.trim() !== TANVION_PRODUCTION_ORIGIN
      ) {
        toast(`Production Domain must be exactly ${TANVION_PRODUCTION_ORIGIN}.`, 'error');
        return;
      }
      if (!isWinHouseWalletBaseUrl(form.walletBaseUrl)) {
        toast('Wallet base URL must end in /api/v1/winhouse on an exact https origin.', 'error');
        return;
      }
      if (
        form.environment === 'production' &&
        form.walletBaseUrl.trim() !== TANVION_WINHOUSE_WALLET_BASE_URL
      ) {
        toast(
          `Production wallet base URL must be exactly ${TANVION_WINHOUSE_WALLET_BASE_URL}.`,
          'error',
        );
        return;
      }
      if (form.serverIp.trim() && (form.serverIp.includes('/') || /\s/.test(form.serverIp.trim()))) {
        toast('Server IP must be one exact public IP, not a CIDR range or placeholder.', 'error');
        return;
      }
      if (!editTarget && (!form.walletApiKey || !form.callbackToken)) {
        toast('Wallet API key and callback token are required for an embedded sportsbook.', 'error');
        return;
      }
    } else if (aggregator) {
      // BigBang: the verified base URL, an explicit environment and — for an
      // ACTIVE row — at least one API key (stored or newly typed).
      if (form.baseUrl.trim() !== BIGBANG_DEFAULT_BASE_URL) {
        toast(`Base URL must be exactly ${BIGBANG_DEFAULT_BASE_URL}.`, 'error');
        return;
      }
      if (
        form.status === 'ACTIVE' &&
        !form.apiKey.trim() &&
        !(editTarget && editTarget.apiKeySet)
      ) {
        toast('API key is required for an active BigBang provider.', 'error');
        return;
      }
    } else if (!form.baseUrl.trim()) {
      toast('Base URL is required.', 'error');
      return;
    } else if (form.integrationType === 'SPORTS_API' && !form.deepLinkTemplate.trim()) {
      toast('Deep-link template is required for a sports API provider.', 'error');
      return;
    }

    setSaving(true);
    try {
      const wasEdit = Boolean(editTarget);
      if (editTarget) {
        await updatePartnerProvider(editTarget.id, {
          name: form.name.trim(),
          // An embedded sportsbook has no API base URL of its own: the book
          // origin is the only address that exists for it (kept in sync so the
          // row stays valid for both shapes). A BigBang row keeps its verified
          // API base URL.
          baseUrl: embedded ? form.embedBaseUrl.trim() : form.baseUrl.trim(),
          providerCode: aggregator ? BIGBANG_PROVIDER_CODE : undefined,
          integrationType: form.integrationType,
          environment: embedded || aggregator ? form.environment : undefined,
          embedKey: embedded ? form.embedKey.trim() : undefined,
          embedBaseUrl: embedded ? form.embedBaseUrl.trim() : undefined,
          domain: embedded ? form.domain.trim() : undefined,
          walletBaseUrl: embedded ? form.walletBaseUrl.trim() : undefined,
          serverIp: embedded ? form.serverIp.trim() : undefined,
          // Blank secret input is omitted and therefore preserves the stored
          // ciphertext. Only the explicit remove checkbox sends the clear sentinel.
          walletApiKey: embedded
            ? form.clearWalletApiKey
              ? ''
              : form.walletApiKey || undefined
            : undefined,
          callbackToken: embedded
            ? form.clearCallbackToken
              ? ''
              : form.callbackToken || undefined
            : undefined,
          // The legacy fields belong to the server-side sports API shape only —
          // an embedded book and the BigBang aggregator have no deep-link
          // template, auth mode or API version of this kind.
          deepLinkTemplate: embedded || aggregator ? undefined : form.deepLinkTemplate.trim(),
          authMode: embedded || aggregator ? undefined : form.authMode.trim() || null,
          apiVersion: embedded || aggregator ? undefined : form.apiVersion.trim() || null,
          status: form.status,
          apiKey: form.clearApiKey ? '' : form.apiKey || undefined,
          apiSecret: aggregator
            ? undefined
            : form.clearApiSecret
              ? ''
              : form.apiSecret || undefined,
        });
      } else {
        await createPartnerProvider({
          name: form.name.trim(),
          baseUrl: embedded ? form.embedBaseUrl.trim() : form.baseUrl.trim(),
          providerCode: aggregator ? BIGBANG_PROVIDER_CODE : undefined,
          integrationType: form.integrationType,
          environment: embedded || aggregator ? form.environment : undefined,
          embedKey: embedded ? form.embedKey.trim() : undefined,
          embedBaseUrl: embedded ? form.embedBaseUrl.trim() : undefined,
          domain: embedded ? form.domain.trim() : undefined,
          walletBaseUrl: embedded ? form.walletBaseUrl.trim() : undefined,
          serverIp: embedded ? form.serverIp.trim() : undefined,
          walletApiKey: embedded ? form.walletApiKey : undefined,
          callbackToken: embedded ? form.callbackToken : undefined,
          deepLinkTemplate:
            embedded || aggregator ? undefined : form.deepLinkTemplate.trim(),
          authMode: embedded || aggregator ? undefined : form.authMode.trim() || undefined,
          apiVersion: embedded || aggregator ? undefined : form.apiVersion.trim() || undefined,
          status: form.status,
          apiKey: embedded ? undefined : form.apiKey || undefined,
          apiSecret: aggregator || embedded ? undefined : form.apiSecret || undefined,
        });
      }
      // The mutation is successful only after the authoritative list refresh
      // succeeds. If refresh fails, retain the modal and entered values so the
      // operator can retry without mistaking stale state for a confirmed save.
      const refreshed = await load();
      if (!refreshed) throw new Error('Provider saved, but the authoritative list could not be refreshed.');
      if (embedded) {
        const statusRefreshed = await loadWinHouse();
        if (!statusRefreshed) throw new Error('Provider saved, but WinHouse status could not be refreshed.');
      }
      setCreateOpen(false);
      setEditTarget(null);
      toast(`Provider "${form.name}" ${wasEdit ? 'updated' : 'created'}.`, 'success');
    } catch (err) {
      // FAILURE: modal stays open, error toast, values intact, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Failed to save the provider.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus(provider: AdminPartnerProvider) {
    // Double-submit guard (Part 35) for this row.
    if (busyId === provider.id) return;
    setBusyId(provider.id);
    try {
      await updatePartnerProvider(provider.id, {
        status: provider.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      // Do not claim success until the authoritative list refresh succeeds.
      if (!(await load())) throw new Error('Status changed, but the provider list could not be refreshed.');
      toast(
        `Provider "${provider.name}" ${provider.status === 'ACTIVE' ? 'disabled' : 'enabled'}.`,
        'success',
      );
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Failed to change provider status.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onSync(provider?: AdminPartnerProvider) {
    // Double-submit guard (Part 35).
    if (provider ? busyId === provider.id : syncingAll) return;
    if (provider) setBusyId(provider.id);
    else setSyncingAll(true);
    try {
      const result = await triggerPartnerSync(provider?.id);
      const s = result.summary;
      const failed = s.errors.length > 0;
      // Do not claim success until the authoritative list refresh succeeds.
      if (!(await load())) throw new Error('Sync finished, but the provider list could not be refreshed.');
      toast(
        `Sync finished — ${s.sports} sports, ${s.events} events, ${s.odds} odds updates.` +
          (failed ? ` ${s.errors.length} error(s): ${s.errors[0]}` : ''),
        failed ? 'error' : 'success',
      );
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Sync failed.', 'error');
    } finally {
      setBusyId(null);
      setSyncingAll(false);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    // Double-submit guard (Part 35).
    if (busyId === deleteTarget.id) return;
    const name = deleteTarget.name;
    setBusyId(deleteTarget.id);
    try {
      await deletePartnerProvider(deleteTarget.id);
      // Keep the confirmation open if the authoritative refresh fails.
      if (!(await load())) throw new Error('Provider deleted, but the authoritative list could not be refreshed.');
      setDeleteTarget(null);
      toast(`Provider "${name}" deleted.`, 'success');
    } catch (err) {
      // FAILURE: confirm dialog stays open, error toast, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Failed to delete the provider.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const paged = providers === null ? [] : providers.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <AdminPageHeader
        title="Partner providers"
        description="Allowlisted sports partner configuration. Credentials are encrypted at rest and shown only as set/unset — never in plaintext."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Partner providers' }]}
        actions={
          <>
            {canSync ? (
              <Button variant="outline" size="sm" onClick={() => void onSync()} loading={syncingAll}>
                Sync all
              </Button>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={openCreate}>
                Add provider
              </Button>
            ) : null}
          </>
        }
      />

      {/* BigBang (BIG CASINO / BIG LIVE CASINO) — portal configuration.
          The wallet callback URLs to register in the BigBang Dashboard, the
          webhook URL, and the one-time webhook secret. Gated by the same
          partner-provider read permission as the rest of this page. */}
      {hasBigBangAggregator && (
        <section className="mb-6">
          <AdminBigBangPortalSection />
        </section>
      )}

      {/* Embedded sportsbook (BIG SPORT) — shown ONLY when an embedded provider
          row exists. Every value here is secret-free: the wallet API key and
          the callback token are reported as set/unset only. */}
      {hasEmbeddedBook && (
        <section className="mb-6 rounded-lg border border-white/10 bg-ink-900/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">
                Embedded sportsbook — BIG SPORT
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                The provider hosts the book inside BIG SPORT. Bets and payouts move on the ONE TANVION
                wallet through the provider&apos;s signed callbacks — no second balance exists.
              </p>
            </div>
            {canSelfTest ? (
              <Button size="sm" variant="outline" onClick={() => void onRunSelfTest()} loading={winhouseBusy}>
                Run self-test
              </Button>
            ) : null}
          </div>

          {winhouseError ? (
            <p className="mt-3 rounded-md bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
              {winhouseError}
            </p>
          ) : winhouse ? (
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <StatusFact label="Configured" value={winhouse.configured ? 'yes' : 'no'} />
              <StatusFact label="Environment" value={winhouse.environment} />
              <StatusFact label="Provider" value={winhouse.provider ?? '—'} />
              <StatusFact label="Product" value={winhouse.product} />
              {/* Only ever the MASKED key: the UI never prints a full credential. */}
              <StatusFact label="Embed key" value={winhouse.embedKeyMasked ?? '—'} />
              <StatusFact label="Embed URL" value={winhouse.embedBaseUrl ?? '—'} />
              <StatusFact label="Portal domain" value={winhouse.domain ?? 'not configured'} />
              <StatusFact label="Wallet base URL" value={winhouse.walletBaseUrl ?? 'not configured'} />
              <StatusFact
                label="Balance endpoint"
                value={winhouse.userDataEndpoint ?? 'not configured'}
              />
              <StatusFact
                label="Movement endpoint"
                value={winhouse.balanceChangeEndpoint ?? 'not configured'}
              />
              <StatusFact
                label="Server IP"
                value={winhouse.serverIp ?? 'not configured (not used by data-launch)'}
              />
              <StatusFact
                label="Wallet API key"
                value={winhouse.walletApiKeyConfigured ? '•••••••• (set)' : 'not set'}
              />
              <StatusFact
                label="Callback token"
                value={winhouse.callbackTokenConfigured ? '•••••••• (set)' : 'not set'}
              />
              <StatusFact label="Credentials from" value={winhouse.credentialsSource} />
              <StatusFact
                label="Launch token TTL"
                value={`${Math.round(winhouse.launchTtlMs / 1000)}s (max ${Math.round(
                  winhouse.maxLaunchTtlMs / 1000,
                )}s)`}
              />
              <StatusFact label="Sessions" value={String(winhouse.sessions)} />
              <StatusFact label="Transactions" value={String(winhouse.transactions)} />
              <StatusFact
                label="Last callback"
                value={describeCallback(winhouse.lastCallback)}
              />
              <StatusFact
                label="Last balance-change"
                value={describeCallback(winhouse.lastBalanceChange)}
              />
              <StatusFact label="Last error" value={describeCallback(winhouse.lastError, true)} />
              <StatusFact
                label="Last wallet movement"
                value={
                  winhouse.lastSuccessfulTransaction
                    ? `${winhouse.lastSuccessfulTransaction.action} ${
                        winhouse.lastSuccessfulTransaction.amount
                      } ${winhouse.lastSuccessfulTransaction.currency} → balance ${
                        winhouse.lastSuccessfulTransaction.balanceAfter
                      }`
                    : 'none yet'
                }
              />
              {winhouse.lastSuccessfulTransaction && (
                <StatusFact
                  label="Ticket"
                  value={`${winhouse.lastSuccessfulTransaction.ticketId ?? '—'} (${
                    winhouse.lastSuccessfulTransaction.transactionId
                  })`}
                />
              )}
              {winhouse.message && <StatusFact label="Note" value={winhouse.message} />}
            </dl>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Reading status…</p>
          )}

          {/* Callback diagnostics are in-memory: say so, instead of implying a history. */}
          {winhouse?.lastCallback || winhouse?.lastError ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Callback timestamps are recorded since the API process last started (they reset on
              deploy). Refusal codes are the provider-facing contract.
            </p>
          ) : null}

          {/* Honest operator warning — never a reassuring "all good". */}
          {winhouse?.warning ? (
            <p className="mt-3 rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-200" role="status">
              {winhouse.warning}
            </p>
          ) : null}

          {winhouseTest && (
            <ul className="mt-3 space-y-1 text-xs">
              {winhouseTest.checks.map((check) => (
                <li key={check.check} className={check.ok ? 'text-teal-300' : 'text-red-300'}>
                  {check.ok ? '✓' : '✗'} {check.check}
                  {check.detail ? ` — ${check.detail}` : ''}
                </li>
              ))}
              {winhouseTest.warnings.map((warning) => (
                <li key={`warning:${warning}`} className="text-amber-300">
                  ⚠ {warning}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs text-slate-500">
            Provider wallet base URL:{' '}
            <span className="text-slate-300">
              {winhouse?.walletBaseUrl ?? 'not configured'}
            </span>{' '}
            — WinHouse appends <span className="text-slate-300">GET /user-data</span> and{' '}
            <span className="text-slate-300">POST /balance-change</span>. Callback token plus HMAC-SHA256
            authenticate these calls; they never use a TANVION customer JWT.
          </p>
        </section>
      )}

      {providers === null && !error ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : providers && providers.length === 0 ? (
        <AdminEmptyState
          title="No partner providers configured"
          hint='Add a server-side sports provider with its allowlisted base URL, deep-link template and API credentials (then run "Sync all" to import real events), an EMBEDDED sportsbook provider (WinHouse) with its public embed key plus the wallet API key and callback token, or the BigBang casino aggregator with its environment, verified base URL and API key (its catalog sync lives in Admin → Casino).'
        />
      ) : (
        providers && (
          <>
            <AdminTable
              columns={PROVIDER_COLUMNS({
                busyId,
                canSync,
                canUpdate,
                canDelete,
                onSync: (p) => void onSync(p),
                onEdit: openEdit,
                onToggle: (p) => void onToggleStatus(p),
                onDelete: (p) => setDeleteTarget(p),
              })}
              rows={paged}
              rowKey={(p) => p.id}
            />
            <AdminPagination page={page} limit={pageSize} total={providers.length} onPageChange={setPage} />
          </>
        )
      )}

      <ProviderFormModal
        open={createOpen || editTarget !== null}
        editTarget={editTarget}
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={() => void onSave()}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete provider"
        message={`Delete partner provider "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={busyId === deleteTarget?.id}
        onConfirm={() => void onDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------

interface ColumnActions {
  busyId: string | null;
  canSync: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onSync: (p: AdminPartnerProvider) => void;
  onEdit: (p: AdminPartnerProvider) => void;
  onToggle: (p: AdminPartnerProvider) => void;
  onDelete: (p: AdminPartnerProvider) => void;
}

function PROVIDER_COLUMNS({
  busyId,
  canSync,
  canUpdate,
  canDelete,
  onSync,
  onEdit,
  onToggle,
  onDelete,
}: ColumnActions) {
  return [
    {
      key: 'name',
      header: 'Provider',
      render: (p: AdminPartnerProvider) => (
        <div className="min-w-0">
          <p className="font-medium text-white">{p.name}</p>
          <p className="truncate text-xs text-slate-500">{p.baseUrl}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
            {INTEGRATION_LABELS[p.integrationType] ?? p.integrationType}
            {p.environment ? ` · ${p.environment}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'credentials',
      header: 'Credentials',
      render: (p: AdminPartnerProvider) =>
        isEmbeddedBook(p.integrationType) ? (
          // An embedded sportsbook has NO API key/secret. What it has is a
          // PUBLIC embed key plus two SERVER-ONLY secrets, both shown as
          // set/unset — never in plaintext.
          <div className="text-xs">
            <p className="truncate text-slate-300" title={p.domain ?? undefined}>
              Domain: {p.domain ?? <span className="text-slate-500">not configured</span>}
            </p>
            <p className="truncate text-slate-300" title={p.walletBaseUrl ?? undefined}>
              Wallet base: {p.walletBaseUrl ?? <span className="text-slate-500">not configured</span>}
            </p>
            <p className="truncate text-slate-300" title={p.embedKey ?? undefined}>
              Embed key: {p.embedKey ?? <span className="text-slate-500">not set</span>}
            </p>
            <p className="text-slate-300">
              Wallet API key:{' '}
              {p.walletApiKeySet ? (
                <span className="text-teal-300">•••••••• (set)</span>
              ) : (
                <span className="text-slate-500">not set</span>
              )}
            </p>
            <p className="text-slate-300">
              Callback token:{' '}
              {p.callbackTokenSet ? (
                <span className="text-teal-300">•••••••• (set)</span>
              ) : (
                <span className="text-slate-500">not set</span>
              )}
            </p>
          </div>
        ) : (
          <div className="text-xs">
            <p className="text-slate-300">
              API key:{' '}
              {p.apiKeySet ? (
                <span className="text-teal-300">•••••••• (set)</span>
              ) : (
                <span className="text-slate-500">not set</span>
              )}
            </p>
            <p className="text-slate-300">
              Secret:{' '}
              {p.apiSecretSet ? (
                <span className="text-teal-300">•••••••• (set)</span>
              ) : (
                <span className="text-slate-500">not set</span>
              )}
            </p>
            <p className="text-slate-500">Auth mode: {p.authMode ?? '—'}</p>
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p: AdminPartnerProvider) => <AdminStatusBadge value={p.status} />,
    },
    {
      key: 'sync',
      header: 'Sync',
      render: (p: AdminPartnerProvider) =>
        isEmbeddedBook(p.integrationType) ? (
          // Nothing to sync: the provider serves its own book and TANVION never
          // caches its odds, matches or results.
          <p className="text-xs text-slate-500">Provider-hosted book (no sync)</p>
        ) : isCasinoAggregator(p.integrationType) ? (
          // BigBang has no sports feed; its game catalog is synced through the
          // EXISTING casino catalog sync (Admin → Casino), never here.
          <p className="text-xs text-slate-500">Catalog sync: Admin → Casino</p>
        ) : (
          <div className="text-xs">
            <AdminStatusBadge value={p.syncStatus} />
            <p className="mt-1 text-slate-400" title={formatDateTime(p.lastSyncAt)}>
              {formatRelative(p.lastSyncAt)}
            </p>
            {p.lastSyncError && (
              <p className="mt-1 max-w-64 break-words text-red-300" title={p.lastSyncError}>
                {p.lastSyncError}
              </p>
            )}
          </div>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (p: AdminPartnerProvider) => (
        <div className="flex flex-wrap gap-1.5">
          {!isEmbeddedBook(p.integrationType) &&
            !isCasinoAggregator(p.integrationType) &&
            canSync && (
              <Button size="sm" variant="outline" onClick={() => onSync(p)} loading={busyId === p.id}>
                Sync
              </Button>
            )}
          {canUpdate ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => onEdit(p)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onToggle(p)}>
                {p.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-300 hover:bg-red-950/40"
              onClick={() => onDelete(p)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Create / edit form modal
// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

function ProviderFormModal({
  open,
  editTarget,
  form,
  setForm,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  editTarget: AdminPartnerProvider | null;
  form: ProviderFormState;
  setForm: Dispatch<SetStateAction<ProviderFormState>>;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const embedded = isEmbeddedBook(form.integrationType);
  const aggregator = isCasinoAggregator(form.integrationType);
  // The integration shape is chosen when the row is created: an existing row's
  // stored configuration (and BIG SPORT) was built for one shape.
  const integrationLocked = editTarget !== null;

  return (
    <Modal
      open={open}
      title={editTarget ? `Edit provider — ${editTarget.name}` : 'Add partner provider'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving}>
            {editTarget ? 'Save changes' : 'Create provider'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={embedded ? 'e.g. WinHouse Sportsbook' : 'e.g. Partner Sportsbook'}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Integration</span>
          <select
            className={inputClass}
            value={form.integrationType}
            disabled={integrationLocked}
            onChange={(e) => {
              const next = e.target.value as AdminPartnerIntegrationType;
              setForm((prev) => ({
                ...prev,
                integrationType: next,
                // Choosing the BigBang aggregator prefills its verified API
                // base URL so the operator never has to type (or guess) it.
                baseUrl: isCasinoAggregator(next) ? BIGBANG_DEFAULT_BASE_URL : prev.baseUrl,
              }));
            }}
          >
            <option value="SPORTS_API">Sports API (server-side, deep links)</option>
            <option value="SPORTS_IFRAME">Embedded sportsbook (WinHouse iframe)</option>
            <option value="CASINO_AGGREGATOR">Casino Aggregator (BigBang)</option>
            <option value="CASINO_API">Casino API</option>
            <option value="LIVE_CASINO_API">Live casino API</option>
          </select>
          <span className="text-xs text-slate-500">
            An embedded sportsbook is hosted by the provider and rendered inside BIG SPORT; a sports API
            provider is queried server-side and opened by deep link; the casino aggregator (BigBang) is a
            server-to-server casino integration.
          </span>
        </label>
        {embedded ? (
          <>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-semibold text-white">Public configuration</h3>
              <p className="mt-1 text-xs text-slate-500">
                These values are safe to display and correspond to the provider dashboard. The embed key is
                public; it is not wallet authentication.
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span>Product</span>
              <input className={inputClass} value="BIG SPORT" readOnly disabled />
              <span className="text-xs text-slate-500">
                An embedded sportsbook serves the BIG SPORT section only — it is not a casino provider.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Environment</span>
              <select
                className={inputClass}
                value={form.environment}
                onChange={(e) =>
                  setForm({ ...form, environment: e.target.value as 'sandbox' | 'production' })
                }
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
              <span className="text-xs text-slate-500">
                Sandbox and production are never mixed: only the row matching the API&apos;s environment is
                used.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>Embed key (public)</span>
              <input
                className={inputClass}
                value={form.embedKey}
                onChange={(e) => setForm({ ...form, embedKey: e.target.value.trim() })}
                placeholder="ifr_0123456789abcdef0123456789abcdef01234567"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-xs text-slate-500">
                The provider&apos;s PUBLIC iframe key (it selects the book&apos;s skin). It is not a secret and
                NOT the wallet API key — never paste a wallet credential here.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>Embed URL (book origin)</span>
              <input
                className={inputClass}
                value={form.embedBaseUrl}
                onChange={(e) => setForm({ ...form, embedBaseUrl: e.target.value.trim() })}
                placeholder={WINHOUSE_DEFAULT_EMBED_URL}
                autoComplete="off"
                inputMode="url"
              />
              <span className="text-xs text-slate-500">
                Origin the loader/iframe is served from. The book plays in the wallet&apos;s currency, so no
                per-event deep-link template is required.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>Domain (exact frontend origin)</span>
              <input
                className={inputClass}
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value.trim() })}
                placeholder={TANVION_PRODUCTION_ORIGIN}
                autoComplete="off"
                inputMode="url"
              />
              <span className="text-xs text-slate-500">
                Add this exact origin to WinHouse → Domain. Do not add a wildcard or a www/non-www variant
                unless that exact origin is separately deployed and verified.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>Seamless wallet base URL</span>
              <input
                className={inputClass}
                value={form.walletBaseUrl}
                onChange={(e) => setForm({ ...form, walletBaseUrl: e.target.value.trim() })}
                placeholder={TANVION_WINHOUSE_WALLET_BASE_URL}
                autoComplete="off"
                inputMode="url"
              />
              <span className="text-xs text-slate-500">
                WinHouse appends <code>/user-data</code> and <code>/balance-change</code>. Do not include
                either callback path here.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>Server IP (optional)</span>
              <input
                className={inputClass}
                value={form.serverIp}
                onChange={(e) => setForm({ ...form, serverIp: e.target.value.trim() })}
                placeholder="Leave blank unless a verified outbound allowlist is required"
                autoComplete="off"
                inputMode="text"
              />
              <span className="text-xs text-slate-500">
                The official server-to-server <code>POST /tenant/session</code> mode checks this exact public
                address. Enter only a verified dedicated Render outbound IP; CIDR ranges, localhost, private
                ranges, and documentation examples are not accepted. The current <code>embed.js</code> data-launch
                flow does not use this endpoint.
              </span>
            </label>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-semibold text-white">Secret configuration</h3>
              <p className="mt-1 text-xs text-slate-500">
                Values are encrypted server-side and are never returned after saving. Leave a blank field
                unchanged; use its remove checkbox only when intentional rotation requires clearing it.
              </p>
            </div>
            <SecretField
              label="Wallet API key"
              keepHint={Boolean(editTarget && editTarget.walletApiKeySet)}
              value={form.walletApiKey}
              onChange={(v) => setForm({ ...form, walletApiKey: v })}
              clearChecked={form.clearWalletApiKey}
              onClearChange={(c) => setForm({ ...form, clearWalletApiKey: c })}
              hint="HMAC-SHA256 signing key for the callback signatures and launch tokens. Server-side only — never sent to the browser, never returned by the API."
            />
            <SecretField
              label="Callback token"
              keepHint={Boolean(editTarget && editTarget.callbackTokenSet)}
              value={form.callbackToken}
              onChange={(v) => setForm({ ...form, callbackToken: v })}
              clearChecked={form.clearCallbackToken}
              onClearChange={(c) => setForm({ ...form, clearCallbackToken: c })}
              hint="Authenticates the provider's wallet callbacks (?token=). Server-side only."
            />
          </>
        ) : aggregator ? (
          <>
        <label className="flex flex-col gap-1 text-sm">
          <span>Environment</span>
          <select
            className={inputClass}
            value={form.environment}
            onChange={(e) =>
              setForm({ ...form, environment: e.target.value as 'sandbox' | 'production' })
            }
          >
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
          <span className="text-xs text-slate-500">
            Sandbox and production use SEPARATE provider rows — only the row matching the API&apos;s
            environment is ever used, and their credentials are never mixed.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span>Base URL</span>
          <input
            className={inputClass}
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder={BIGBANG_DEFAULT_BASE_URL}
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
          />
          <span className="text-xs text-slate-500">
            The verified BigBang API base URL. The backend rejects any other host or path, so this
            value only ever needs confirming — never editing.
          </span>
        </label>
        <div className="sm:col-span-2">
          <h3 className="text-sm font-semibold text-white">BigBang credentials</h3>
          <p className="mt-1 text-xs text-slate-500">
            The API key is ONE server-only secret (it is also the key BigBang signs its seamless-wallet
            callbacks with). It is encrypted at rest, never displayed again after saving and never sent
            to the browser. Leave the field blank to keep the stored key.
          </p>
        </div>
          </>
        ) : (
          <>
        <label className="flex flex-col gap-1 text-sm">
          <span>Base URL (allowlisted origin)</span>
          <input
            className={inputClass}
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://partner.example"
            autoComplete="off"
            inputMode="url"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span>Deep-link template</span>
          <input
            className={inputClass}
            value={form.deepLinkTemplate}
            onChange={(e) => setForm({ ...form, deepLinkTemplate: e.target.value })}
            placeholder="/sport/{sportSlug}/event/{externalEventId}"
            autoComplete="off"
          />
          <span className="text-xs text-slate-500">
            Resolved server-side with the provider&apos;s exact event id — the client can never influence the destination.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Auth mode</span>
          <input
            className={inputClass}
            value={form.authMode}
            onChange={(e) => setForm({ ...form, authMode: e.target.value })}
            placeholder="api-key | basic | none"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>API version</span>
          <input
            className={inputClass}
            value={form.apiVersion}
            onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
            placeholder="v1"
            autoComplete="off"
          />
        </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span>Status</span>
          <select
            className={inputClass}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
          <span className="text-xs text-slate-500">
            {embedded
              ? 'Only an ACTIVE row in the matching environment is ever used for the book.'
              : aggregator
                ? 'Only the ACTIVE row in the matching environment is ever used for casino traffic.'
                : 'An INACTIVE provider is skipped by the sync.'}
          </span>
        </label>
        <div />
        {!embedded && (
          <>
            <SecretField
              label="API key"
              keepHint={Boolean(editTarget && editTarget.apiKeySet)}
              value={form.apiKey}
              onChange={(v) => setForm({ ...form, apiKey: v })}
              clearChecked={form.clearApiKey}
              onClearChange={(c) => setForm({ ...form, clearApiKey: c })}
              hint={
                aggregator
                  ? 'Server-only BigBang credential (X-API-Key) — also the callback HMAC signing key. Never displayed after saving.'
                  : undefined
              }
            />
            {!aggregator && (
              <SecretField
                label="API secret"
                keepHint={Boolean(editTarget && editTarget.apiSecretSet)}
                value={form.apiSecret}
                onChange={(v) => setForm({ ...form, apiSecret: v })}
                clearChecked={form.clearApiSecret}
                onClearChange={(c) => setForm({ ...form, clearApiSecret: c })}
              />
            )}
          </>
        )}
        <p className="text-xs text-slate-500 sm:col-span-2">
          Credentials are encrypted server-side (AES-256-GCM) and never displayed, logged or stored in the browser.
          {embedded &&
            ' The embed key is public by the provider\u2019s design; the wallet API key and the callback token are the two secrets and must never be swapped.'}
        </p>
      </div>
    </Modal>
  );
}

function SecretField({
  label,
  keepHint,
  value,
  onChange,
  clearChecked,
  onClearChange,
  hint,
}: {
  label: string;
  keepHint: boolean;
  value: string;
  onChange: (value: string) => void;
  clearChecked: boolean;
  onClearChange: (checked: boolean) => void;
  /** Explains WHAT the secret is (and what it must never be confused with). */
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>
        {label} {keepHint && <span className="text-xs text-slate-500">(leave blank to keep)</span>}
      </span>
      <input
        className={inputClass}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={keepHint ? 'Leave blank to keep the stored value' : 'Enter new secret'}
        autoComplete="new-password"
        disabled={clearChecked}
      />
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
      {keepHint && (
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={clearChecked} onChange={(e) => onClearChange(e.target.checked)} />
          Remove stored value
        </span>
      )}
    </label>
  );
}

/**
 * One label/value pair of the embedded-sportsbook status panel.
 *
 * Every value rendered through this component is already secret-free: the
 * wallet API key and the callback token are reduced to set/unset on the
 * server, so the browser can never receive them.
 */
/**
 * Renders one callback diagnostic for an operator. Refusal codes are the
 * provider-facing contract, so they are shown verbatim; nothing here is a
 * credential.
 */
function describeCallback(
  entry: AdminWinHouseCallbackDiagnostic | null,
  errorsOnly = false,
): string {
  if (!entry) return errorsOnly ? 'none' : 'no callback yet';
  const when = formatRelative(entry.at);
  if (entry.outcome === 'ok') {
    return errorsOnly ? 'none' : `ok (HTTP ${entry.status}) — ${when}`;
  }
  return `refused ${entry.code ?? 'unknown'} (HTTP ${entry.status}) — ${when}`;
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200" title={value}>
        {value}
      </dd>
    </div>
  );
}
