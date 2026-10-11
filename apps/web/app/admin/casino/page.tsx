'use client';

/**
 * Casino provider administration (BIG CASINO / BIG LIVE CASINO).
 *
 * Reuses the EXISTING admin shell, components and conventions — no admin
 * redesign. It surfaces, in a secret-free way:
 *
 *   - provider status: configured / environment / reachable / capabilities;
 *   - credential STATE only (configured or not, and whether the value comes
 *     from the environment or the encrypted DB row) — never a secret;
 *   - last successful sync + last sync error;
 *   - catalog management: enable/disable, feature, ordering, per product;
 *   - reconciliation: recent provider sessions and wallet movements.
 *
 * Credentials themselves are still edited in ONE place only:
 * Admin → Partner providers (AES-256-GCM encrypted at rest).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@tanvion-royale/ui';
import { ADMIN_PERMISSIONS,
  AdminCasinoGamePatch,
  AdminCasinoStatus,
  CatalogGame,
  CatalogResponse,
} from '@tanvion-royale/types';
import {
  configureAdminCasinoProvider,
  getAdminCasinoCatalog,
  getAdminCasinoSessions,
  getAdminCasinoStatus,
  getAdminCasinoTransactions,
  patchAdminCasinoGame,
  syncAdminCasinoCatalog,
  type AdminCasinoSessionRow,
  type AdminCasinoTransactionRow,
} from '@/lib/api/casino';
import { ApiClientError } from '@/lib/api/client';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusBadge,
  formatDateTime,
  formatMinor,
  formatRelative,
} from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminNotConfigured,
  AdminPagination,
  type AdminColumn,
} from '@/components/admin/data-table';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const PAGE_SIZE = 15;

type ProductParam = 'casino' | 'live';

/**
 * Turns a recorded provider sync failure into ONE precise, actionable verdict.
 *
 * The backend already classifies every provider failure
 * (`CasinoProviderError.code`) and the message keeps that prefix, so the admin
 * sees the ACTUAL condition — a rejected credential, a wrong endpoint, a
 * connection timeout, a provider outage — instead of a bare "last sync error"
 * that implies the whole casino system is down. The raw text is always shown
 * as well, so nothing is hidden or invented.
 */
type SyncDiagnosis = {
  title: string;
  action: string;
  tone: 'warn' | 'bad';
};

const SYNC_DIAGNOSES: ReadonlyArray<[RegExp, SyncDiagnosis]> = [
  [
    /^UNAUTHORIZED:/i,
    {
      title: 'Authentication failure — the provider rejected the API key',
      action:
        'Re-enter the BigBang API key in Admin → Partner providers. The key is encrypted at rest and is never displayed here.',
      tone: 'bad',
    },
  ],
  [
    /^INVALID_ENDPOINT:/i,
    {
      title: 'Invalid endpoint — the provider does not serve that path',
      action:
        'Check the provider base URL and API version on this page. The path returned 404/405.',
      tone: 'bad',
    },
  ],
  [
    /^UNAVAILABLE:/i,
    {
      title: 'Provider unavailable — DNS, connection or TLS failure',
      action:
        'The provider host could not be reached from the API. Check the host name, then retry; this is usually a provider-side or network outage.',
      tone: 'bad',
    },
  ],
  [
    /^TIMEOUT:/i,
    {
      title: 'Connection timeout — the provider did not answer in time',
      action:
        'The provider accepted the connection but did not reply inside the configured budget. Raise PARTNER_CASINO_CATALOG_TIMEOUT_MS in Render, or retry.',
      tone: 'warn',
    },
  ],
  [
    /^INVALID_RESPONSE:/i,
    {
      title: 'Unexpected response — the provider did not return the documented format',
      action:
        'The provider answered, but the payload did not match its documented contract. Confirm the API version on this page.',
      tone: 'warn',
    },
  ],
  [
    /^NOT_CONFIGURED:/i,
    {
      title: 'Provider not configured for this environment',
      action:
        'Set the environment, base URL and credentials, then retry the sync.',
      tone: 'bad',
    },
  ],
];

function diagnoseSyncError(raw: string): SyncDiagnosis | null {
  for (const [pattern, diagnosis] of SYNC_DIAGNOSES) {
    if (pattern.test(raw.trim())) return diagnosis;
  }
  return null;
}

function ProviderSyncError({
  raw,
  gamesKept,
  canManage,
  onRetry,
  syncing,
}: {
  raw: string;
  gamesKept: number;
  canManage: boolean;
  onRetry: () => void;
  syncing: boolean;
}) {
  const diagnosis = diagnoseSyncError(raw);

  return (
    <div
      role="status"
      className={`mt-3 rounded-lg border px-4 py-3 text-sm ${
        diagnosis?.tone === 'bad'
          ? 'border-red-500/40 bg-red-950/30 text-red-100'
          : 'border-amber-500/30 bg-amber-950/25 text-amber-100'
      }`}
    >
      <p className="font-semibold">
        {diagnosis?.title ?? 'The last catalog sync did not complete'}
      </p>
      {diagnosis ? (
        <p className="mt-1 opacity-90">{diagnosis.action}</p>
      ) : null}
      {/* The provider's own words are always shown — nothing is summarised away. */}
      <p className="mt-2 break-words font-mono text-xs opacity-80">{raw}</p>
      <p className="mt-2 text-xs opacity-80">
        Your existing catalog is untouched — {gamesKept} game(s) from the last
        successful sync are still live.
      </p>
      {canManage ? (
        <div className="mt-3">
          <Button size="sm" variant="outline" loading={syncing} onClick={onRetry}>
            Retry sync
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminCasinoPage() {
  const { toast } = useToast();
  const canManage = useAdminPermission(ADMIN_PERMISSIONS.CASINO_MANAGE);

  const [status, setStatus] = useState<AdminCasinoStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  const [product, setProduct] = useState<ProductParam>('casino');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<AdminCasinoSessionRow[]>([]);
  const [transactions, setTransactions] = useState<AdminCasinoTransactionRow[]>([]);

  const [form, setForm] = useState({
    environment: 'sandbox' as 'sandbox' | 'production',
    apiVersion: 'v1',
    baseUrl: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const report = await getAdminCasinoStatus();
      setStatus(report);
      setForm((current) => ({
        environment: report.providerRow?.environment ?? current.environment,
        apiVersion: report.apiVersion || current.apiVersion,
        baseUrl: report.providerRow?.baseUrl ?? current.baseUrl,
        status: report.providerRow?.status ?? current.status,
      }));
    } catch (error) {
      setStatusError(
        error instanceof ApiClientError ? error.message : 'Failed to load casino status.',
      );
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const data = await getAdminCasinoCatalog({
        product,
        search: search.trim() || undefined,
        includeInactive,
        page,
        pageSize: PAGE_SIZE,
      });
      setCatalog(data);
    } catch (error) {
      setCatalogError(
        error instanceof ApiClientError ? error.message : 'Failed to load the casino catalog.',
      );
    }
  }, [product, search, includeInactive, page]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!status?.configured) return;
    let cancelled = false;
    void Promise.all([getAdminCasinoSessions(25), getAdminCasinoTransactions(25)])
      .then(([sessionRows, transactionRows]) => {
        if (cancelled) return;
        setSessions(sessionRows);
        setTransactions(transactionRows);
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([]);
          setTransactions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status?.configured]);

  async function onSync() {
    // Double-submit guard (Part 35).
    if (syncing) return;
    setSyncing(true);
    try {
      const summary = await syncAdminCasinoCatalog();
      // Part 37: refresh status + catalog → THEN show the result.
      await Promise.all([loadStatus(), loadCatalog()]);
      /*
       * Report what ACTUALLY happened. A sync is a partial success when some
       * providers synced and others failed, and it is an outright failure when
       * none did — both used to be toasted as "undefined game(s) from ... "
       * because the client was typed against fields the endpoint never returns,
       * which silently hid a failed sync behind a success-looking message.
       */
      const failures = summary.errors ?? [];
      if (summary.providersSynced > 0) {
        toast(
          `Sync finished — ${summary.games} game(s) from ${
            summary.provider ?? `${summary.providersSynced} provider(s)`
          }${
            summary.providersFailed > 0
              ? ` (${summary.providersFailed} provider(s) failed)`
              : ''
          }.`,
          failures.length > 0 ? 'error' : 'success',
        );
      }
      // Report every real reason, so a failure is never a bare toast.
      for (const failure of failures) toast(failure, 'error');
      if (summary.providersSynced === 0 && failures.length === 0) {
        toast(
          `No provider could be synced for the ${summary.environment} environment.`,
          'error',
        );
      }
    } catch (error) {
      toast(error instanceof ApiClientError ? error.message : 'Catalog sync failed.', 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function onSaveProvider() {
    if (!status?.providerRow) {
      toast('No partner provider row is selected for the casino product yet.', 'error');
      return;
    }
    // Double-submit guard (Part 35).
    if (savingProvider) return;
    setSavingProvider(true);
    try {
      await configureAdminCasinoProvider(status.providerRow.id, {
        environment: form.environment,
        apiVersion: form.apiVersion.trim() || undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        status: form.status,
      });
      // Part 37: refresh → THEN show the result.
      await loadStatus();
      toast('Casino provider configuration saved.', 'success');
    } catch (error) {
      toast(
        error instanceof ApiClientError ? error.message : 'Failed to save the configuration.',
        'error',
      );
    } finally {
      setSavingProvider(false);
    }
  }

  async function onPatchGame(game: CatalogGame, patch: AdminCasinoGamePatch) {
    // Double-submit guard (Part 35) for this row.
    if (busyGameId === game.id) return;
    setBusyGameId(game.id);
    try {
      await patchAdminCasinoGame(game.id, patch);
      // Part 37: refresh the catalog → THEN show the result.
      await loadCatalog();
      toast(`"${game.name}" updated.`, 'success');
    } catch (error) {
      toast(
        error instanceof ApiClientError ? error.message : 'Failed to update the game.',
        'error',
      );
    } finally {
      setBusyGameId(null);
    }
  }

  const gameColumns: Array<AdminColumn<CatalogGame>> = [
    {
      key: 'game',
      header: 'Game',
      render: (game) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-100">{game.name}</p>
          <p className="truncate text-xs text-slate-500">
            {game.provider} · {game.externalId}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (game) => <span className="text-slate-300">{game.category ?? '—'}</span>,
    },
    {
      key: 'flags',
      header: 'Availability',
      render: (game) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <AdminStatusBadge value={game.status} />
          {game.isFeatured && (
            <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-teal-300">
              FEATURED
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              game.launchAvailable
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            {game.launchAvailable ? 'REAL' : 'NO REAL'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              game.demoAvailable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-700 text-slate-400'
            }`}
          >
            {game.demoAvailable ? 'DEMO' : 'NO DEMO'}
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (game) =>
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={busyGameId === game.id}
              onClick={() =>
                void onPatchGame(game, {
                  status: game.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                })
              }
            >
              {game.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busyGameId === game.id}
              onClick={() => void onPatchGame(game, { featured: !game.isFeatured })}
            >
              {game.isFeatured ? 'Unfeature' : 'Feature'}
            </Button>
          </div>
        ) : null,
    },
  ];

  const sessionColumns: Array<AdminColumn<AdminCasinoSessionRow>> = [
    {
      key: 'session',
      header: 'Session',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-slate-200">{row.id}</p>
          <p className="truncate text-xs text-slate-500">user {row.userId}</p>
        </div>
      ),
    },
    {
      key: 'game',
      header: 'Game / player',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-200">{row.externalGameId}</p>
          <p className="truncate font-mono text-xs text-slate-500">{row.providerPlayerId}</p>
        </div>
      ),
    },
    {
      key: 'env',
      header: 'Environment',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">
            {row.environment.toUpperCase()}
          </span>
          {row.demo && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
              DEMO
            </span>
          )}
          <AdminStatusBadge value={row.status} />
        </div>
      ),
    },
    {
      key: 'launched',
      header: 'Launched',
      render: (row) => (
        <span className="text-xs text-slate-400" title={formatDateTime(row.launchedAt)}>
          {formatRelative(row.launchedAt)}
        </span>
      ),
    },
  ];

  const transactionColumns: Array<AdminColumn<AdminCasinoTransactionRow>> = [
    {
      key: 'txn',
      header: 'Provider transaction',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-slate-200">
            {row.externalTransactionId}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.externalRoundId ? `round ${row.externalRoundId}` : 'no round'}
            {row.referenceTransactionId ? ` · ref ${row.referenceTransactionId}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-teal-300">
            {row.kind}
          </span>
          <AdminStatusBadge value={row.status} />
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span
          className={`tabular-nums ${row.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}
        >
          {formatMinor(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: 'wallet',
      header: 'TANVION ledger',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-slate-400">
            {row.walletTransactionId ?? '—'}
          </p>
          <p className="truncate text-xs text-slate-500">user {row.userId}</p>
        </div>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Casino provider"
        description="BIG CASINO and BIG LIVE CASINO provider configuration, catalog sync and reconciliation. API secrets are never displayed — only whether they are configured."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Casino provider' }]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void loadStatus()}>
              Refresh
            </Button>
            {canManage ? (
              <Button size="sm" onClick={() => void onSync()} loading={syncing}>
                Sync catalog
              </Button>
            ) : null}
          </>
        }
      />

      {statusError && <AdminErrorState message={statusError} onRetry={() => void loadStatus()} />}

      {status && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStatCard
              label="Provider"
              value={status.provider ?? 'Not configured'}
              hint={
                status.configured
                  ? `${status.environment.toUpperCase()} environment`
                  : 'No active casino provider row'
              }
              tone={status.configured ? 'good' : 'warn'}
            />
            <AdminStatCard
              label="Connectivity"
              value={status.reachable ? 'Reachable' : 'Unreachable'}
              hint={status.lastSyncAt ? `Last sync ${formatRelative(status.lastSyncAt)}` : 'Never synced'}
              tone={status.reachable ? 'good' : 'bad'}
            />
            <AdminStatCard
              label="Credentials"
              value={
                status.credentials.merchantConfigured && status.credentials.secretConfigured
                  ? 'Configured'
                  : 'Incomplete'
              }
              hint={`Source: ${status.credentials.source}`}
              tone={
                status.credentials.merchantConfigured && status.credentials.secretConfigured
                  ? 'good'
                  : 'warn'
              }
            />
            <AdminStatCard
              label="Capabilities"
              value={`${status.casino ? 'Casino' : '—'} / ${status.liveCasino ? 'Live' : '—'}`}
              hint={status.demoSupported ? 'Demo supported' : 'No demo reported'}
              tone={status.casino || status.liveCasino ? 'good' : 'warn'}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStatCard label="Games" value={status.counts.games} hint={`${status.counts.casinoGames} casino · ${status.counts.liveCasinoGames} live`} />
            <AdminStatCard label="Categories" value={status.counts.categories} hint={`${status.counts.providers} studios`} />
            <AdminStatCard label="Sessions" value={status.counts.sessions} hint="Launched partner sessions" />
            <AdminStatCard label="Transactions" value={status.counts.transactions} hint="Mapped wallet movements" />
          </div>

          {status.message && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              {status.message}
            </p>
          )}

          {status.lastSyncError && (
            <ProviderSyncError
              raw={status.lastSyncError}
              gamesKept={status.counts.games}
              canManage={canManage}
              onRetry={() => void onSync()}
              syncing={syncing}
            />
          )}

          {!status.configured && (
            <div className="mt-3">
              <AdminNotConfigured
                message={`No casino provider is usable for the ${status.environment.toUpperCase()} environment yet. Configure a partner provider row (base URL, merchant id/secret) and set PARTNER_CASINO_ENV + PARTNER_CASINO_MERCHANT_ID + PARTNER_CASINO_SECRET before syncing. Until then the user catalog honestly reports "unavailable" — no games are invented.`}
              />
            </div>
          )}
        </>
      )}

      {/* Provider row labelling — credentials stay on /admin/partner-providers. */}
      {status?.providerRow && (
        <section
          aria-labelledby="casino-provider-config"
          className="mt-6 rounded-lg border border-ink-600 bg-ink-900 p-4"
        >
          <h2 id="casino-provider-config" className="text-sm font-semibold text-white">
            {status.providerRow.name} — casino product configuration
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Environment and API version must match the credentials issued by the provider. Sandbox and
            production are never mixed.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>Environment</span>
              <select
                value={form.environment}
                onChange={(event) =>
                  setForm({ ...form, environment: event.target.value as 'sandbox' | 'production' })
                }
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>API version</span>
              <input
                value={form.apiVersion}
                onChange={(event) => setForm({ ...form, apiVersion: event.target.value })}
                autoComplete="off"
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
              <span>Base URL (https)</span>
              <input
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://api.partner.example"
                autoComplete="off"
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>Status</span>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as 'ACTIVE' | 'INACTIVE' })
                }
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canManage ? (
              <Button size="sm" loading={savingProvider} onClick={() => void onSaveProvider()}>
                Save configuration
              </Button>
            ) : (
              <span className="text-xs text-amber-300">Read-only: casino.manage is required to change configuration.</span>
            )}
            <span className="text-xs text-slate-500">
              Merchant id/secret are managed in Admin → Partner providers.
            </span>
          </div>
        </section>
      )}

      {/* Catalog management, product-scoped: BIG CASINO vs BIG LIVE CASINO. */}
      <section aria-labelledby="casino-catalog-heading" className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="casino-catalog-heading" className="text-sm font-semibold text-white">
              Synced catalog
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Only real provider-supplied games appear here. Nothing is fabricated.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-ink-600 p-0.5" role="tablist" aria-label="Product">
              {(['casino', 'live'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={product === value}
                  onClick={() => {
                    setProduct(value);
                    setPage(1);
                  }}
                  className={`rounded px-3 py-1 text-xs font-semibold transition ${
                    product === value ? 'bg-teal-500/15 text-teal-300' : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {value === 'casino' ? 'BIG CASINO' : 'BIG LIVE CASINO'}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search games"
              aria-label="Search catalog games"
              autoComplete="off"
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => {
                  setIncludeInactive(event.target.checked);
                  setPage(1);
                }}
              />
              Include inactive
            </label>
          </div>
        </div>

        <div className="mt-3">
          {catalogError ? (
            <AdminErrorState message={catalogError} onRetry={() => void loadCatalog()} />
          ) : catalog === null ? (
            <AdminTableSkeleton rows={6} />
          ) : catalog.games.items.length === 0 ? (
            <AdminEmptyState
              title="No games synced for this product"
              hint={
                catalog.configured
                  ? 'Run "Sync catalog" after the provider credentials are configured.'
                  : 'The partner casino provider is not configured for this environment yet.'
              }
            />
          ) : (
            <>
              <AdminTable
                columns={gameColumns}
                rows={catalog.games.items}
                rowKey={(game) => game.id}
              />
              <AdminPagination
                page={catalog.games.page}
                limit={catalog.games.pageSize}
                total={catalog.games.total}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </section>

      {/* Reconciliation: provider sessions + wallet movements. */}
      {status?.configured && (
        <section aria-labelledby="casino-reconciliation" className="mt-8">
          <h2 id="casino-reconciliation" className="text-sm font-semibold text-white">
            Reconciliation
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Provider session and transaction mappings. Amounts are TANVION wallet movements in minor
            units.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recent sessions
              </h3>
              <AdminTable
                columns={sessionColumns}
                rows={sessions}
                rowKey={(row) => row.id}
                emptyState={<AdminEmptyState title="No casino sessions yet" />}
              />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recent wallet movements
              </h3>
              <AdminTable
                columns={transactionColumns}
                rows={transactions}
                rowKey={(row) => row.id}
                emptyState={<AdminEmptyState title="No provider transactions yet" />}
              />
            </div>
          </div>
        </section>
      )}
    </>
  );
}
