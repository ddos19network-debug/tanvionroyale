'use client';

/**
 * Admin — Manual withdrawals management.
 *
 * Real endpoints:
 *   GET  /admin/manual-withdrawals
 *   GET  /admin/manual-withdrawals/:id
 *   POST /admin/manual-withdrawals/:id/review  (approve/reject)
 *   POST /admin/manual-withdrawals/:id/complete
 *
 * Approve never deducts again (funds are already reserved). Reject releases
 * the reserved funds. Complete settles the reservation after an off-platform
 * payout. All actions are server-side, idempotent and audited.
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminManualWithdrawals,
  getAdminManualWithdrawal,
  reviewAdminManualWithdrawal,
  completeAdminManualWithdrawal,
  type AdminManualWithdrawal,
} from '@/lib/api/admin';
import {
  AdminPageHeader,
  AdminStatusBadge,
  formatDateTime,
  formatMinor,
} from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  type AdminColumn,
} from '@/components/admin/data-table';
import { Modal } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

export default function ManualWithdrawalsPage() {
  const { toast } = useToast();
  const canReview = useAdminPermission(ADMIN_PERMISSIONS.WITHDRAWALS_REVIEW);
  const canComplete = useAdminPermission(ADMIN_PERMISSIONS.WITHDRAWALS_COMPLETE);
  const [rows, setRows] = useState<AdminManualWithdrawal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selected, setSelected] = useState<AdminManualWithdrawal | null>(null);
  const [detail, setDetail] = useState<AdminManualWithdrawal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [providerReference, setProviderReference] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listAdminManualWithdrawals({ status: statusFilter || undefined });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load manual withdrawals.');
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(w: AdminManualWithdrawal) {
    setSelected(w);
    setDetail(null);
    try {
      const full = await getAdminManualWithdrawal(w.id);
      setDetail(full);
    } catch (err) {
      setDetail(w);
      toast(err instanceof Error ? err.message : 'Unable to load the withdrawal details.', 'error');
    }
  }

  async function handleReview(w: AdminManualWithdrawal, action: 'APPROVE' | 'REJECT', reason?: string) {
    // Double-submit guard (Part 35).
    if (busyId === w.id) return;
    setBusyId(w.id);
    try {
      await reviewAdminManualWithdrawal(w.id, action, reason);
      // Part 37: close → refresh → THEN show the result.
      setSelected(null);
      await load();
      toast(action === 'APPROVE' ? 'Withdrawal approved. Funds stay reserved until completed.' : 'Withdrawal rejected. Reserved funds released.', 'success');
    } catch (err) {
      // FAILURE: detail stays open, error toast, retry possible.
      toast(err instanceof Error ? err.message : 'Operation failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleComplete() {
    if (!selected) return;
    // Double-submit guard (Part 35).
    if (busyId === selected.id) return;
    setBusyId(selected.id);
    try {
      await completeAdminManualWithdrawal(selected.id, providerReference);
      // Part 37: close → refresh → THEN show the result.
      setCompleteOpen(false);
      setSelected(null);
      setProviderReference('');
      await load();
      toast('Withdrawal completed.', 'success');
    } catch (err) {
      // FAILURE: complete dialog stays open with the reference intact.
      toast(err instanceof Error ? err.message : 'Operation failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }
  const columns: Array<AdminColumn<AdminManualWithdrawal>> = [
    {
      key: 'id',
      header: 'Request',
      render: (w) => (
        <div>
          <p className="font-mono text-xs text-slate-400">{w.id.slice(0, 8)}</p>
          <p className="text-xs text-slate-500">{formatDateTime(w.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'User',
      render: (w) => <span className="font-mono text-xs text-slate-300">{w.userId.slice(0, 8)}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      render: (w) => (
        <div>
          <p className="text-sm text-slate-200">{w.methodName || w.methodCode}</p>
          <p className="text-xs text-slate-500">{w.destinationAccount || '—'}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (w) => <span className="tabular-nums text-slate-100">{formatMinor(w.amount, w.currency)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (w) => <AdminStatusBadge value={w.status} />,
    },
    {
      key: 'reviewed',
      header: 'Reviewed',
      render: (w) => (
        <span className="text-xs text-slate-400">{w.reviewedAt ? formatDateTime(w.reviewedAt) : '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (w) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => openDetail(w)}>View</Button>
          {canReview && w.status === 'PENDING' && (
            <>
              <Button variant="outline" size="sm" disabled={busyId === w.id} onClick={() => handleReview(w, 'APPROVE')}>Approve</Button>
              <Button variant="danger" size="sm" disabled={busyId === w.id} onClick={() => handleReview(w, 'REJECT', 'Rejected by admin')}>Reject</Button>
            </>
          )}
          {canComplete && w.status === 'APPROVED' && (
            <Button variant="primary" size="sm" disabled={busyId === w.id} onClick={() => { setSelected(w); setProviderReference(''); setCompleteOpen(true); }}>Complete</Button>
          )}
        </div>
      ),
    },
  ];

  const display = detail ?? selected;
  return (
    <>
      <AdminPageHeader
        title="Manual withdrawals"
        description="Review pending manual withdrawals. Approval keeps funds reserved; completion settles them; rejection releases them."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Manual withdrawals' }]}
        actions={
          <select
            aria-label="Filter by status"
            className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-slate-300"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        }
      />

      {error && <AdminErrorState message={error} onRetry={load} />}
      {!rows && !error && <AdminTableSkeleton rows={5} />}
      {rows && (
        <AdminTable
          columns={columns}
          rows={rows}
          rowKey={(w) => w.id}
          emptyState={<AdminEmptyState title={statusFilter ? `No ${statusFilter.toLowerCase()} withdrawals` : 'No manual withdrawals yet'} hint="User-submitted manual withdrawals appear here." />}
        />
      )}

      {/* Detail modal */}
      <Modal open={Boolean(display)} title="Withdrawal details" onClose={() => setSelected(null)} wide>
        {display && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-lg font-semibold text-slate-100">{formatMinor(display.amount, display.currency)}</p>
              <AdminStatusBadge value={display.status} />
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <DetailItem label="Method" value={`${display.methodName || display.methodCode} (${display.methodType})`} />
              <DetailItem label="User" value={display.userId} mono />
              <DetailItem label="Destination" value={display.destinationAccount || '—'} />
              <DetailItem label="Account name" value={display.destinationName || '—'} />
              <DetailItem label="Bank" value={display.bankName || '—'} />
              <DetailItem label="Branch" value={display.branch || '—'} />
              <DetailItem label="Routing" value={display.routingNumber || '—'} />
              <DetailItem label="Idempotency key" value={display.idempotencyKey} mono />
              <DetailItem label="Wallet transaction" value={display.walletTransactionId || '—'} mono />
              <DetailItem label="Provider reference" value={display.providerReference || '—'} mono />
              <DetailItem label="Rejection reason" value={display.rejectionReason || '—'} />
              <DetailItem label="Submitted" value={formatDateTime(display.createdAt)} />
            </dl>
  {canReview && display.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2 border-t border-ink-700 pt-3">
                <Button size="sm" disabled={busyId === display.id} onClick={() => handleReview(display, 'APPROVE')}>Approve</Button>
                <Button size="sm" variant="danger" disabled={busyId === display.id} onClick={() => handleReview(display, 'REJECT', 'Rejected by admin')}>Reject</Button>
              </div>
            )}
            {canComplete && display.status === 'APPROVED' && (
              <div className="border-t border-ink-700 pt-3">
                <Button size="sm" disabled={busyId === display.id} onClick={() => { setProviderReference(''); setCompleteOpen(true); }}>Complete payout</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Complete modal */}
      <Modal
        open={completeOpen}
        title="Complete payout"
        onClose={() => setCompleteOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busyId === selected?.id}>Cancel</Button>
            <Button onClick={handleComplete} loading={busyId === selected?.id}>Mark completed</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-300">
          Confirm the payout for {selected ? formatMinor(selected.amount, selected.currency) : ''} has been executed off-platform.
          The reservation will be settled and cannot be undone.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">External payout reference (optional)</span>
          <input
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100"
            value={providerReference}
            onChange={(e) => setProviderReference(e.target.value)}
            placeholder="external-payout-123"
          />
        </label>
      </Modal>
    </>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-xs' : ''} text-slate-200`}>{value}</dd>
    </>
  );
}