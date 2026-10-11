'use client';

/**
 * Betting administration (Phase 9).
 *
 * Reads bets/events from the new admin read endpoints and settles through
 * the EXISTING idempotent settlement endpoints (POST /admin/betting/bets/:id/
 * settle, POST /admin/betting/events/:id/settle). Settlement results always
 * come from the backend — never invented; duplicate settlement is impossible
 * (backend rejects/reports alreadySettled instead of paying twice).
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminBets,
  listAdminEvents,
  updateAdminEventStatus,
  settleAdminBet,
  type AdminBetListItem,
  type AdminEventListItem,
  type AdminBetStatus,
  type AdminEventStatus,
  type SettleResult,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import { AdminPageHeader, AdminStatusBadge, formatDateTime, formatMinor } from '@/components/admin/ui';
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

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

const BET_STATUSES: Array<AdminBetStatus | ''> = ['', 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SETTLED', 'VOID'];
const EVENT_STATUSES: Array<AdminEventStatus | ''> = ['', 'SCHEDULED', 'LIVE', 'SUSPENDED', 'FINISHED', 'CANCELLED'];
const SETTLE_RESULTS: SettleResult[] = ['WIN', 'LOSS', 'VOID', 'PUSH'];

type Tab = 'bets' | 'events';

export default function AdminBettingPage() {
  const { toast } = useToast();
  const canSettle = useAdminPermission(ADMIN_PERMISSIONS.BETTING_SETTLE);
  const canManageEvents = useAdminPermission(ADMIN_PERMISSIONS.SPORTS_MANAGE);
  const [tab, setTab] = useState<Tab>('bets');

  const [bets, setBets] = useState<{ items: AdminBetListItem[]; total: number } | null>(null);
  const [betsLoading, setBetsLoading] = useState(true);
  const [betsError, setBetsError] = useState<string | null>(null);
  const [betQuery, setBetQuery] = useState('');
  const [betStatus, setBetStatus] = useState('');
  const [betUserId, setBetUserId] = useState('');
  const [betsPage, setBetsPage] = useState(1);
  const [detailBet, setDetailBet] = useState<AdminBetListItem | null>(null);
  const [settleTarget, setSettleTarget] = useState<AdminBetListItem | null>(null);
  const [settleResult, setSettleResult] = useState<SettleResult>('WIN');
  const [settling, setSettling] = useState(false);

  const [events, setEvents] = useState<{ items: AdminEventListItem[]; total: number } | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventQuery, setEventQuery] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [eventsPage, setEventsPage] = useState(1);
  const [statusTarget, setStatusTarget] = useState<AdminEventListItem | null>(null);
  const [newStatus, setNewStatus] = useState<AdminEventStatus>('FINISHED');
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const pageSize = 20;

  const loadBets = useCallback(async () => {
    setBetsLoading(true);
    setBetsError(null);
    try {
      const result = await listAdminBets({
        q: betQuery.trim() || undefined,
        status: betStatus || undefined,
        userId: betUserId.trim() || undefined,
        page: betsPage,
        limit: pageSize,
      });
      setBets({ items: result.items, total: result.total });
    } catch (err) {
      setBetsError(err instanceof ApiClientError ? err.message : 'Failed to load bets.');
    } finally {
      setBetsLoading(false);
    }
  }, [betQuery, betStatus, betUserId, betsPage]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const result = await listAdminEvents({
        q: eventQuery.trim() || undefined,
        status: eventStatus || undefined,
        page: eventsPage,
        limit: pageSize,
      });
      setEvents({ items: result.items, total: result.total });
    } catch (err) {
      setEventsError(err instanceof ApiClientError ? err.message : 'Failed to load events.');
    } finally {
      setEventsLoading(false);
    }
  }, [eventQuery, eventStatus, eventsPage]);

  useEffect(() => {
    void loadBets();
  }, [loadBets]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function onSettle() {
    if (!settleTarget) return;
    // Double-submit guard (Part 35).
    if (settling) return;
    setSettling(true);
    try {
      const results = settleTarget.selections.map((s) => ({ selectionId: s.selectionId, result: settleResult }));
      const res = await settleAdminBet(settleTarget.id, results);
      // Part 37: close → refresh → THEN show the result.
      setSettleTarget(null);
      await loadBets();
      toast(
        res.alreadySettled
          ? 'Bet was already settled (idempotent) — no changes made.'
          : `Bet settled: ${res.result}, payout ${formatMinor(res.payout, settleTarget.currency)}.`,
        'success',
      );
    } catch (err) {
      // FAILURE: settle dialog stays open, error toast, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Settlement failed.', 'error');
    } finally {
      setSettling(false);
    }
  }

  async function onEventStatusChange() {
    if (!statusTarget) return;
    // Double-submit guard (Part 35).
    if (statusSaving) return;
    if (statusReason.trim().length < 3) {
      toast('A reason (min 3 characters) is required and recorded in the audit log.', 'error');
      return;
    }
    setStatusSaving(true);
    try {
      await updateAdminEventStatus(statusTarget.id, newStatus, statusReason.trim());
      // Part 37: close → refresh → THEN show the result.
      setStatusTarget(null);
      setStatusReason('');
      await loadEvents();
      toast(`Event status changed to ${newStatus}.`, 'success');
    } catch (err) {
      // FAILURE: dialog stays open with the reason intact, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Failed to change event status.', 'error');
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Betting"
        description="Bets, settlement and event status. Settlement is idempotent backend-side; results are never invented."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Betting' }]}
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-ink-600 bg-ink-900 p-1 text-sm" role="tablist" aria-label="Betting sections">
        {(['bets', 'events'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 capitalize transition ${
              tab === t ? 'bg-teal-500/15 text-teal-300' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'bets' ? (
        <BetsTab
          data={bets}
          loading={betsLoading}
          error={betsError}
          query={betQuery}
          setQuery={setBetQuery}
          status={betStatus}
          setStatus={(v) => {
            setBetStatus(v);
            setBetsPage(1);
          }}
          userId={betUserId}
          setUserId={setBetUserId}
          page={betsPage}
          setPage={setBetsPage}
          pageSize={pageSize}
          reload={() => void loadBets()}
          onDetail={setDetailBet}
          onSettle={canSettle ? setSettleTarget : undefined}
        />
      ) : (
        <EventsTab
          data={events}
          loading={eventsLoading}
          error={eventsError}
          query={eventQuery}
          setQuery={setEventQuery}
          status={eventStatus}
          setStatus={(v) => {
            setEventStatus(v);
            setEventsPage(1);
          }}
          page={eventsPage}
          setPage={setEventsPage}
          pageSize={pageSize}
          reload={() => void loadEvents()}
          onStatusChange={canManageEvents ? (e) => {
            setStatusTarget(e);
            setNewStatus(e.status === 'LIVE' ? 'FINISHED' : 'LIVE');
          } : undefined}
        />
      )}

      {/* Bet detail */}
      <Modal
        open={detailBet !== null}
        title={detailBet ? `Bet ${detailBet.id.slice(0, 8)}…` : 'Bet'}
        onClose={() => setDetailBet(null)}
        wide
      >
        {detailBet && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <span>User: <span className="text-slate-200">{detailBet.username}</span></span>
              <span>· Status: <AdminStatusBadge value={detailBet.status} /></span>
              <span>· Stake: <span className="text-slate-200">{formatMinor(detailBet.stake, detailBet.currency)}</span></span>
              <span>· Potential payout: <span className="text-slate-200">{formatMinor(detailBet.potentialPayout, detailBet.currency)}</span></span>
              <span>· Placed: {formatDateTime(detailBet.createdAt)}</span>
              {detailBet.settledAt && <span>· Settled: {formatDateTime(detailBet.settledAt)} ({detailBet.result})</span>}
              {detailBet.payout !== null && <span>· Paid out: {formatMinor(detailBet.payout, detailBet.currency)}</span>}
            </div>
            <AdminTable
              columns={SELECTION_COLUMNS}
              rows={detailBet.selections}
              rowKey={(s) => s.id}
            />
          </div>
        )}
      </Modal>

      {/* Settle confirmation */}
      <ConfirmDialog
        open={settleTarget !== null}
        title="Settle bet"
        message={
          settleTarget ? (
            <div className="space-y-3">
              <p>
                Settle bet <span className="font-medium text-white">{settleTarget.id.slice(0, 8)}…</span> for{' '}
                <span className="font-medium text-white">{settleTarget.username}</span>? The payout is computed and
                credited by the backend ledger. The operation is idempotent.
              </p>
              <label className="flex flex-col gap-1 text-sm">
                <span>Result</span>
                <select
                  className={inputClass}
                  value={settleResult}
                  onChange={(e) => setSettleResult(e.target.value as SettleResult)}
                >
                  {SETTLE_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel="Settle"
        loading={settling}
        onConfirm={() => void onSettle()}
        onCancel={() => setSettleTarget(null)}
      />

      {/* Event status change */}
      <Modal
        open={statusTarget !== null}
        title="Change event status"
        onClose={() => setStatusTarget(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusTarget(null)} disabled={statusSaving}>
              Cancel
            </Button>
            <Button onClick={() => void onEventStatusChange()} loading={statusSaving}>
              Update status
            </Button>
          </>
        }
      >
        {statusTarget && (
          <div className="space-y-3">
            <p>
              <span className="text-slate-400">Event:</span>{' '}
              <span className="font-medium text-white">{statusTarget.name}</span>{' '}
              <AdminStatusBadge value={statusTarget.status} />
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span>New status</span>
              <select
                className={inputClass}
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as AdminEventStatus)}
              >
                {EVENT_STATUSES.filter((s) => s !== '').map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Reason (recorded in the audit log)</span>
              <textarea
                className={inputClass}
                rows={3}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="e.g. Match postponed by the league"
                maxLength={500}
              />
            </label>
            <p className="text-xs text-slate-500">
              Bets and settlements are never modified by a status change — settlement is a separate, idempotent
              operation.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

interface ListState<T> {
  items: T[];
  total: number;
}

interface TabProps<T> {
  data: ListState<T> | null;
  loading: boolean;
  error: string | null;
  query: string;
  setQuery: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  pageSize: number;
  reload: () => void;
}

const filterSelect =
  'rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none';

function BetsTab({
  data,
  loading,
  error,
  query,
  setQuery,
  status,
  setStatus,
  userId,
  setUserId,
  page,
  setPage,
  pageSize,
  reload,
  onDetail,
  onSettle,
}: TabProps<AdminBetListItem> & {
  userId: string;
  setUserId: (v: string) => void;
  onDetail: (b: AdminBetListItem) => void;
  onSettle?: (b: AdminBetListItem) => void;
}) {
  return (
    <div>
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          reload();
        }}
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Search (bet id, username, event name)</span>
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Search bets…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Status</span>
          <select className={filterSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
            {BET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">User ID</span>
          <input
            className={`${inputClass} w-64`}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Filter by user UUID"
          />
        </label>
        <Button type="submit" loading={loading}>
          Apply
        </Button>
      </form>

      {loading && !data ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={reload} />
      ) : data && data.items.length === 0 ? (
        <AdminEmptyState title="No bets match your filters" />
      ) : (
        data && (
          <>
            <AdminTable
              columns={[
                {
                  key: 'bet',
                  header: 'Bet',
                  render: (b) => (
                    <div>
                      <p className="font-mono text-xs text-slate-300">{b.id.slice(0, 8)}…</p>
                      <p className="text-xs text-slate-500">{b.username}</p>
                    </div>
                  ),
                },
                {
                  key: 'event',
                  header: 'Selection',
                  render: (b) => (
                    <div className="max-w-64">
                      <p className="truncate text-slate-200">{b.selections[0]?.eventName ?? '—'}</p>
                      <p className="truncate text-xs text-slate-500">{b.selections[0]?.selectionName ?? ''}</p>
                    </div>
                  ),
                },
                { key: 'stake', header: 'Stake', render: (b) => formatMinor(b.stake, b.currency) },
                {
                  key: 'status',
                  header: 'Status',
                  render: (b) => (
                    <div className="space-y-1">
                      <AdminStatusBadge value={b.status} />
                      {b.result && <AdminStatusBadge value={b.result} />}
                    </div>
                  ),
                },
                {
                  key: 'placed',
                  header: 'Placed',
                  render: (b) => <span className="text-xs text-slate-400">{formatDateTime(b.createdAt)}</span>,
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (b) => (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => onDetail(b)}>
                        Details
                      </Button>
                      {onSettle && (b.status === 'ACCEPTED' || b.status === 'PENDING') && (
                        <Button size="sm" onClick={() => onSettle(b)}>
                          Settle
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              rows={data.items}
              rowKey={(b) => b.id}
            />
            <AdminPagination page={page} limit={pageSize} total={data.total} onPageChange={setPage} />
          </>
        )
      )}
    </div>
  );
}

function EventsTab({
  data,
  loading,
  error,
  query,
  setQuery,
  status,
  setStatus,
  page,
  setPage,
  pageSize,
  reload,
  onStatusChange,
}: TabProps<AdminEventListItem> & {
  onStatusChange?: (e: AdminEventListItem) => void;
}) {
  return (
    <div>
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          reload();
        }}
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Search (event / team name)</span>
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Search events…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Status</span>
          <select className={filterSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" loading={loading}>
          Apply
        </Button>
      </form>

      {loading && !data ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={reload} />
      ) : data && data.items.length === 0 ? (
        <AdminEmptyState
          title="No events match your filters"
          hint="Events are imported from the configured sports partner — run a sync under Partner providers."
        />
      ) : (
        data && (
          <>
            <AdminTable
              columns={[
                {
                  key: 'event',
                  header: 'Event',
                  render: (e) => (
                    <div className="max-w-72">
                      <p className="truncate font-medium text-white">{e.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[e.competition?.name, e.sport?.name].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'mode',
                  header: 'Betting mode',
                  render: (e) => (
                    <div className="text-xs">
                      <AdminStatusBadge value={e.bettingMode} />
                      {e.partnerProvider && <p className="mt-1 text-slate-500">via {e.partnerProvider.name}</p>}
                    </div>
                  ),
                },
                {
                  key: 'startTime',
                  header: 'Starts',
                  render: (e) => (
                    <div className="text-xs">
                      <p className="text-slate-300">{formatDateTime(e.startTime)}</p>
                      {e.live && <AdminStatusBadge value="LIVE" />}
                    </div>
                  ),
                },
                { key: 'status', header: 'Status', render: (e) => <AdminStatusBadge value={e.status} /> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (e) =>
                    onStatusChange ? (
                      <Button size="sm" variant="outline" onClick={() => onStatusChange(e)}>
                        Change status
                      </Button>
                    ) : null,
                },
              ]}
              rows={data.items}
              rowKey={(e) => e.id}
            />
            <AdminPagination page={page} limit={pageSize} total={data.total} onPageChange={setPage} />
          </>
        )
      )}
    </div>
  );
}

const SELECTION_COLUMNS = [
  { key: 'event', header: 'Event', render: (s: AdminBetListItem['selections'][number]) => s.eventName },
  { key: 'market', header: 'Market', render: (s: AdminBetListItem['selections'][number]) => s.marketName },
  { key: 'selection', header: 'Selection', render: (s: AdminBetListItem['selections'][number]) => s.selectionName },
  { key: 'odds', header: 'Odds (frozen)', render: (s: AdminBetListItem['selections'][number]) => s.priceAtPlacement },
  {
    key: 'result',
    header: 'Result',
    render: (s: AdminBetListItem['selections'][number]) => <AdminStatusBadge value={s.result} />,
  },
];
