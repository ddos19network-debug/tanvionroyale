'use client';

/**
 * Sports administration (Phase 5).
 *
 * - Catalog: full admin list (including INACTIVE) via GET /api/v1/admin/sports;
 *   create/edit/enable-disable via the EXISTING POST/PATCH /admin/sports
 *   endpoints (same RBAC, same audit trail).
 * - Detail: competitions/leagues and games per sport (all statuses) with their
 *   gambling availability and provider mapping (view).
 * - Events: real synchronized events with audited status management.
 *
 * NO demo sports are ever created or seeded here — every row comes from the
 * database (synced from the configured partner provider or created by an admin).
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminSports,
  getAdminSport,
  createAdminSport,
  updateAdminSport,
  listAdminEvents,
  updateAdminEventStatus,
  type AdminSportItem,
  type AdminSportDetail,
  type AdminEventListItem,
  type AdminEventStatus,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import { AdminPageHeader, AdminStatusBadge, formatDateTime } from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminPagination,
} from '@/components/admin/data-table';
import { Modal } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

const EVENT_STATUSES: Array<AdminEventStatus | ''> = ['', 'SCHEDULED', 'LIVE', 'SUSPENDED', 'FINISHED', 'CANCELLED'];

interface SportFormState {
  name: string;
  slug: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: string;
}

const EMPTY_SPORT_FORM: SportFormState = {
  name: '',
  slug: '',
  description: '',
  status: 'ACTIVE',
  sortOrder: '0',
};

export default function AdminSportsPage() {
  const { toast } = useToast();
  const canManage = useAdminPermission(ADMIN_PERMISSIONS.SPORTS_MANAGE);

  const [sports, setSports] = useState<AdminSportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminSportItem | null>(null);
  const [form, setForm] = useState<SportFormState>(EMPTY_SPORT_FORM);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<AdminSportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [events, setEvents] = useState<{ items: AdminEventListItem[]; total: number } | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventSport, setEventSport] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [eventsPage, setEventsPage] = useState(1);
  const [statusTarget, setStatusTarget] = useState<AdminEventListItem | null>(null);
  const [newStatus, setNewStatus] = useState<AdminEventStatus>('FINISHED');
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAdminSports();
      setSports(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load the sports catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const result = await listAdminEvents({
        sport: eventSport || undefined,
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
  }, [eventSport, eventStatus, eventsPage]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function openCreate() {
    setForm(EMPTY_SPORT_FORM);
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(sport: AdminSportItem) {
    setForm({
      name: sport.name,
      slug: sport.slug,
      description: sport.description ?? '',
      status: sport.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      sortOrder: String(sport.sortOrder),
    });
    setEditTarget(sport);
    setFormOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || !form.slug.trim()) {
      toast('Name and slug are required.', 'error');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) {
      toast('Slug may only contain lowercase letters, numbers and hyphens.', 'error');
      return;
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    // Double-submit guard (Part 35).
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() || undefined,
        status: form.status,
        sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      };
      const wasEdit = Boolean(editTarget);
      if (editTarget) {
        await updateAdminSport(editTarget.id, payload);
      } else {
        await createAdminSport(payload);
      }
      // Part 37: close → refresh → THEN show the result.
      setFormOpen(false);
      setEditTarget(null);
      await load();
      toast(
        wasEdit ? `Sport "${payload.name}" updated.` : `Sport "${payload.name}" created.`,
        'success',
      );
    } catch (err) {
      // FAILURE: modal stays open, error toast, values intact, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Failed to save the sport.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus(sport: AdminSportItem) {
    // Double-submit guard (Part 35) for this row.
    if (busyId === sport.id) return;
    setBusyId(sport.id);
    try {
      await updateAdminSport(sport.id, {
        status: sport.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      // Part 37: refresh list + open detail → THEN show the result.
      await load();
      if (detail?.id === sport.id) {
        setDetail(await getAdminSport(sport.id));
      }
      toast(`Sport "${sport.name}" ${sport.status === 'ACTIVE' ? 'disabled' : 'enabled'}.`, 'success');
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Failed to change sport status.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function openDetail(sport: AdminSportItem) {
    setDetailLoading(true);
    try {
      setDetail(await getAdminSport(sport.id));
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Failed to load sport details.', 'error');
    } finally {
      setDetailLoading(false);
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
        title="Sports"
        description="Full catalog (including inactive). Create/edit sports, enable/disable them, and review competitions, games and synchronized events."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Sports' }]}
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              Add sport
            </Button>
          ) : undefined
        }
      />

      {loading && !sports ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : sports && sports.length === 0 ? (
        <AdminEmptyState
          title="No sports in the catalog"
          hint="Configure a partner provider and run a sync, or create a sport manually."
        />
      ) : (
        sports && (
          <AdminTable
            columns={[
              {
                key: 'name',
                header: 'Sport',
                render: (s) => (
                  <div>
                    <p className="font-medium text-white">{s.name}</p>
                    <p className="text-xs text-slate-500">/{s.slug}</p>
                  </div>
                ),
              },
              { key: 'status', header: 'Status', render: (s) => <AdminStatusBadge value={s.status} /> },
              {
                key: 'counts',
                header: 'Competitions / Games',
                render: (s) => (
                  <span className="text-xs text-slate-400">
                    {s.competitionsCount} / {s.gamesCount}
                  </span>
                ),
              },
              { key: 'sortOrder', header: 'Order', render: (s) => <span className="text-xs text-slate-400">{s.sortOrder}</span> },
              {
                key: 'actions',
                header: 'Actions',
                render: (s) => (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => void openDetail(s)} loading={detailLoading && detail?.id === s.id}>
                      Details
                    </Button>
                    {canManage ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void onToggleStatus(s)} loading={busyId === s.id}>
                          {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={sports}
            rowKey={(s) => s.id}
          />
        )
      )}

      {/* Events management */}
      <section className="mt-10" aria-labelledby="events-heading">
        <h2 id="events-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Events
        </h2>
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEventsPage(1);
            void loadEvents();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Sport</span>
            <select
              className={inputClass}
              value={eventSport}
              onChange={(e) => {
                setEventSport(e.target.value);
                setEventsPage(1);
              }}
            >
              <option value="">All sports</option>
              {(sports ?? []).map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Status</span>
            <select
              className={inputClass}
              value={eventStatus}
              onChange={(e) => {
                setEventStatus(e.target.value);
                setEventsPage(1);
              }}
            >
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === '' ? 'All statuses' : s}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" loading={eventsLoading}>
            Apply
          </Button>
        </form>

        {eventsLoading && !events ? (
          <AdminTableSkeleton />
        ) : eventsError ? (
          <AdminErrorState message={eventsError} onRetry={() => void loadEvents()} />
        ) : events && events.items.length === 0 ? (
          <AdminEmptyState
            title="No events match your filters"
            hint="Events are synchronized from the configured partner provider."
          />
        ) : (
          events && (
            <>
              <AdminTable
                columns={EVENT_COLUMNS((e) => {
                  setStatusTarget(e);
                  setNewStatus(e.status === 'LIVE' ? 'FINISHED' : 'LIVE');
                }, canManage)}
                rows={events.items}
                rowKey={(e) => e.id}
              />
              <AdminPagination
                page={eventsPage}
                limit={pageSize}
                total={events.total}
                onPageChange={setEventsPage}
              />
            </>
          )
        )}
      </section>

      {/* Sport create/edit */}
      <Modal
        open={formOpen}
        title={editTarget ? `Edit sport — ${editTarget.name}` : 'Add sport'}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setFormOpen(false);
                setEditTarget(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void onSave()} loading={saving}>
              {editTarget ? 'Save changes' : 'Create sport'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Slug (lowercase, hyphenated)</span>
            <input
              className={inputClass}
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="football"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>Description</span>
            <textarea
              className={inputClass}
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={1000}
            />
          </label>
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
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Sort order</span>
            <input
              className={inputClass}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              inputMode="numeric"
            />
          </label>
        </div>
      </Modal>

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
                maxLength={500}
                placeholder="e.g. Match postponed by the league"
              />
            </label>
          </div>
        )}
      </Modal>

      {/* Sport detail */}
      <Modal open={detail !== null} title={detail ? `Sport — ${detail.name}` : 'Sport'} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <AdminStatusBadge value={detail.status} />
              <span>
                {detail.competitionsCount} competitions · {detail.gamesCount} games
              </span>
            </div>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Competitions / leagues
              </h3>
              {detail.competitions.length === 0 ? (
                <p className="text-xs text-slate-500">No competitions configured.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.competitions.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-600 bg-ink-800/60 px-3 py-2 text-xs"
                    >
                      <span className="text-slate-200">
                        {c.name} <span className="text-slate-500">/{c.slug}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-500">{c.eventsCount} events</span>
                        <AdminStatusBadge value={c.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Games</h3>
              {detail.games.length === 0 ? (
                <p className="text-xs text-slate-500">No games configured.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.games.map((g) => (
                    <li
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-600 bg-ink-800/60 px-3 py-2 text-xs"
                    >
                      <span className="text-slate-200">
                        {g.name} <span className="text-slate-500">/{g.slug}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={g.gamblingEnabled ? 'text-teal-300' : 'text-slate-500'}>
                          gambling {g.gamblingEnabled ? 'enabled' : 'disabled'}
                        </span>
                        {g.providerMapping && (
                          <span className="text-slate-500">
                            provider: {g.providerMapping.providerName} ({g.providerMapping.status})
                          </span>
                        )}
                        <AdminStatusBadge value={g.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EVENT_COLUMNS(
  onStatusChange: (e: AdminEventListItem) => void,
  canManage: boolean,
) {
  return [
    {
      key: 'event',
      header: 'Event',
      render: (e: AdminEventListItem) => (
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
      header: 'Mode',
      render: (e: AdminEventListItem) => (
        <div className="text-xs">
          <AdminStatusBadge value={e.bettingMode} />
          {e.partnerProvider && <p className="mt-1 text-slate-500">via {e.partnerProvider.name}</p>}
        </div>
      ),
    },
    {
      key: 'startTime',
      header: 'Starts',
      render: (e: AdminEventListItem) => (
        <div className="text-xs">
          <p className="text-slate-300">{formatDateTime(e.startTime)}</p>
          {e.live && <AdminStatusBadge value="LIVE" />}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (e: AdminEventListItem) => <AdminStatusBadge value={e.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (e: AdminEventListItem) =>
        canManage ? (
          <Button size="sm" variant="outline" onClick={() => onStatusChange(e)}>
            Change status
          </Button>
        ) : null,
    },
  ];
}
