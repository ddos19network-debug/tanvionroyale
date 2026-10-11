'use client';

/**
 * Audit logs (read-only). The AuditLog table is append-only in the backend —
 * this view only reads it (filter + paginate). Nothing is ever edited or
 * deleted from the log.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@tanvion-royale/ui';
import { listAdminAuditLogs, type AdminAuditLogItem } from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import { AdminPageHeader, formatDateTime } from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminPagination,
} from '@/components/admin/data-table';

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

export default function AdminAuditLogsPage() {
  const [data, setData] = useState<{ items: AdminAuditLogItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminAuditLogs({
        action: action.trim() || undefined,
        actorId: actorId.trim() || undefined,
        entityType: entityType.trim() || undefined,
        page,
        limit: pageSize,
      });
      setData({ items: result.items, total: result.total });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [action, actorId, entityType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <AdminPageHeader
        title="Audit logs"
        description="Immutable record of sensitive actions. Read-only."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Audit logs' }]}
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Action contains</span>
          <input
            className={inputClass}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. WALLET_ADJUSTMENT"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Actor ID (UUID)</span>
          <input
            className={inputClass}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="Filter by actor"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Entity type</span>
          <input
            className={inputClass}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. PartnerProvider"
          />
        </label>
        <Button type="submit" loading={loading}>
          Apply
        </Button>
      </form>

      {loading && !data ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : data && data.items.length === 0 ? (
        <AdminEmptyState title="No audit entries match your filters" />
      ) : (
        data && (
          <>
            <AdminTable
              columns={[
                {
                  key: 'createdAt',
                  header: 'Time',
                  render: (row) => <span className="text-xs text-slate-400">{formatDateTime(row.createdAt)}</span>,
                },
                { key: 'action', header: 'Action', render: (row) => <span className="font-medium text-teal-300">{row.action}</span> },
                {
                  key: 'actor',
                  header: 'Actor',
                  render: (row) => (
                    <div className="text-xs">
                      <p className="text-slate-300">{row.actorType}</p>
                      <p className="font-mono text-slate-500">{row.actorId ? `${row.actorId.slice(0, 8)}…` : 'system'}</p>
                    </div>
                  ),
                },
                {
                  key: 'entity',
                  header: 'Entity',
                  render: (row) => (
                    <div className="text-xs">
                      <p className="text-slate-300">{row.entityType ?? '—'}</p>
                      <p className="font-mono text-slate-500">{row.entityId ? `${row.entityId.slice(0, 8)}…` : ''}</p>
                    </div>
                  ),
                },
                { key: 'ip', header: 'IP', render: (row) => <span className="font-mono text-xs text-slate-500">{row.ip ?? '—'}</span> },
              ]}
              rows={data.items}
              rowKey={(row) => row.id}
            />
            <AdminPagination page={page} limit={pageSize} total={data.total} onPageChange={setPage} />
          </>
        )
      )}
    </div>
  );
}
