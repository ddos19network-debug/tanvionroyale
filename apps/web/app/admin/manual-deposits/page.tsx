'use client';

/**
 * Admin — Manual Deposits management.
 *
 * Real endpoints:
 *   GET  /admin/manual-deposits
 *   GET  /admin/manual-deposits/:id
 *   POST /admin/manual-deposits/:id/review
 *
 * Approval is idempotent on the backend — approving an already-APPROVED
 * deposit never credits the wallet twice.
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminManualDeposits,
  getAdminManualDeposit,
  reviewAdminManualDeposit,
  type AdminManualDepositDetail,
  type AdminManualDepositListItem,
} from '@/lib/api/admin';
import {
  AdminPageHeader,
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
import { Modal, ConfirmDialog } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

function statusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'UNDER_REVIEW':
      return 'Under review';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-red-500/15 text-red-300';
    case 'UNDER_REVIEW':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
}
export default function AdminManualDepositsPage() {
  const { toast } = useToast();
  const canReview = useAdminPermission(ADMIN_PERMISSIONS.DEPOSITS_REVIEW);

  const [deposits, setDeposits] = useState<AdminManualDepositListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const [detail, setDetail] = useState<AdminManualDepositDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<AdminManualDepositListItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = (
        ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
      ).find((s) => s === status);
      setDeposits(await listAdminManualDeposits(statusParam ? { status: statusParam } : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load manual deposits.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(statusFilter);
  }, [statusFilter, load]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await getAdminManualDeposit(id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load deposit details.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function approve(deposit: AdminManualDepositListItem) {
    // Double-submit guard (Part 35) — row + detail buttons share this state.
    if (reviewing) return;
    setReviewing(true);
    try {
      await reviewAdminManualDeposit(deposit.id, 'APPROVE');
      // Part 37: close → refresh → THEN show the result.
      setDetailOpen(false);
      setDetail(null);
      await load(statusFilter);
      toast(`Deposit ${formatMinor(deposit.amount, deposit.currency)} approved.`, 'success');
    } catch (err) {
      // FAILURE: detail stays open, error toast, retry possible.
      toast(err instanceof Error ? err.message : 'Could not approve deposit.', 'error');
    } finally {
      setReviewing(false);
    }
  }

  async function reject() {
    if (!rejectTarget) return;
    if (reviewing) return;
    setReviewing(true);
    try {
      await reviewAdminManualDeposit(rejectTarget.id, 'REJECT', rejectReason);
      // Part 37: close → refresh → THEN show the result.
      setRejectTarget(null);
      setRejectReason('');
      setDetailOpen(false);
      setDetail(null);
      await load(statusFilter);
      toast('Deposit rejected.', 'success');
    } catch (err) {
      // FAILURE: reject dialog stays open with the entered reason intact.
      toast(err instanceof Error ? err.message : 'Could not reject deposit.', 'error');
    } finally {
      setReviewing(false);
    }
  }
const columns: Array<AdminColumn<AdminManualDepositListItem>> = [
    {
      key: 'id',
      header: 'Deposit',
      render: (d) => (
        <button
          type="button"
          onClick={() => void openDetail(d.id)}
          className="text-left font-medium text-teal-300 hover:underline"
        >
          {d.id.slice(0, 8)}
        </button>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      render: (d) => (
        <span className="text-xs text-slate-300">
          {d.method?.displayName ?? d.methodId.slice(0, 8) ?? '—'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (d) => (
        <span className="font-medium text-white">{formatMinor(d.amount, d.currency)}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (d) => (
        <span
          className="block max-w-[10rem] truncate text-xs text-slate-400"
          title={d.referenceId ?? ''}
        >
          {d.referenceId ?? '—'}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Submitted',
      render: (d) => <span className="text-xs text-slate-400">{formatDateTime(d.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(d.status)}`}>
          {statusLabel(d.status)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (d) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void openDetail(d.id)}>
            Review
          </Button>
          {canReview && (d.status === 'PENDING' || d.status === 'UNDER_REVIEW') ? (
            <>
              <Button size="sm" loading={reviewing} onClick={() => void approve(d)}>
                Approve
              </Button>
              <Button size="sm" variant="danger" disabled={reviewing} onClick={() => setRejectTarget(d)}>
                Reject
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];
return (
    <div>
      <AdminPageHeader
        title="Manual Deposits"
        description="Review submitted manual deposits and approve or reject them. Approving is idempotent — the wallet is never credited twice."
        crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Manual deposits' },
        ]}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs text-slate-400">Filter</span>
            <select
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {loading && !deposits ? (
        <AdminTableSkeleton rows={6} />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load(statusFilter)} />
      ) : deposits ? (
        <AdminTable
          columns={columns}
          rows={deposits}
          rowKey={(d) => d.id}
          emptyState={
            <AdminEmptyState
              title="No manual deposits"
              hint={
                statusFilter
                  ? 'No deposits match this status filter.'
                  : 'When users submit a deposit, it appears here.'
              }
            />
          }
        />
      ) : null}
{/* Deposit detail modal */}
      <Modal
        open={detailOpen}
        title="Manual deposit review"
        onClose={() => setDetailOpen(false)}
        wide
        footer={
          canReview &&
          detail &&
          (detail.deposit.status === 'PENDING' || detail.deposit.status === 'UNDER_REVIEW') ? (
            <>
              <Button
                variant="danger"
                onClick={() => setRejectTarget(detail.deposit)}
                disabled={reviewing}
              >
                Reject
              </Button>
              <Button onClick={() => void approve(detail.deposit)} loading={reviewing}>
                Approve
              </Button>
            </>
          ) : undefined
        }
      >
        {detailLoading ? (
          <AdminTableSkeleton rows={4} />
        ) : detailError ? (
          <AdminErrorState
            message={detailError}
            onRetry={() => void openDetail(detail?.deposit.id ?? '')}
          />
        ) : detail ? (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info
                label="User"
                value={`${detail.user.username} (${detail.user.email || detail.user.phone || detail.user.id})`}
              />
              <Info
                label="Amount"
                value={`${formatMinor(detail.deposit.amount, detail.deposit.currency)} ${detail.deposit.currency}`}
              />
              <Info label="Method" value={detail.deposit.method?.displayName ?? detail.deposit.methodId} />
              <Info
                label="Status"
                value={`${statusLabel(detail.deposit.status)}${
                  detail.deposit.reviewedAt ? ` — ${formatDateTime(detail.deposit.reviewedAt)}` : ''
                }`}
              />
              <Info
                label="Transaction ID"
                value={
                  detail.deposit.referenceId ??
                  'Not provided'
                }
              />
              <Info label="Submitted" value={formatDateTime(detail.deposit.createdAt)} />
            </dl>

            {/* Payment screenshot.

                The screenshot travels user upload → POST /wallet/manual-deposits
                → ManualPaymentService → ManualDepositRequest.proofPath → DB →
                GET /admin/manual-deposits/:id (already serialised as
                `proofPath`). The data was never lost by the API — this detail
                view simply never rendered the field it already received. */}
            <div className="rounded-md border border-ink-600 bg-ink-800 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Payment screenshot
              </p>

              <DepositProof
                proof={detail.deposit.proofPath}
              />
            </div>

            {detail.deposit.method && (
              <div className="rounded-md border border-ink-600 bg-ink-800 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Payment instructions
                </p>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {detail.deposit.method.accountNumber && (
                    <Info label="Account" value={detail.deposit.method.accountNumber} />
                  )}
                  {detail.deposit.method.accountName && (
                    <Info label="Account name" value={detail.deposit.method.accountName} />
                  )}
                  {detail.deposit.method.bankName && (
                    <Info label="Bank" value={detail.deposit.method.bankName} />
                  )}
                  {detail.deposit.method.branch && (
                    <Info label="Branch" value={detail.deposit.method.branch} />
                  )}
                  {detail.deposit.method.routingNumber && (
                    <Info label="Routing" value={detail.deposit.method.routingNumber} />
                  )}
                </dl>
                {detail.deposit.method.instructions && (
                  <p className="mt-3 text-sm text-slate-300">
                    {detail.deposit.method.instructions}
                  </p>
                )}
              </div>
            )}

            {detail.deposit.rejectionReason && (
              <div className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-300">
                <p className="text-xs font-semibold uppercase tracking-wide">Rejection reason</p>
                <p className="mt-1">{detail.deposit.rejectionReason}</p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
{/* Reject with reason */}
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Reject manual deposit"
        message={
          <div>
            <p className="mb-3 text-sm text-slate-300">
              Reject {rejectTarget ? formatMinor(rejectTarget.amount, rejectTarget.currency) : ''}?
              A reason is strongly recommended.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. transaction ID could not be verified"
              className="w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
        }
        confirmLabel="Reject deposit"
        danger
        loading={reviewing}
        onCancel={() => {
          setRejectTarget(null);
          setRejectReason('');
        }}
        onConfirm={() => void reject()}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-slate-200">{value}</dd>
    </div>
  );
}

/**
 * Image sources the API is allowed to store for a deposit proof.
 *
 * This is deliberately the SAME allow-list the backend enforces when the
 * screenshot is accepted (ManualPaymentService.isAllowedImageDataUrl), so the
 * admin panel can never be talked into rendering an arbitrary scheme/host.
 * The value is passed to a plain <img src> — no HTML is ever injected, and
 * nothing new is published: the proof only ever reaches this role-guarded
 * admin screen.
 */
const ALLOWED_PROOF_SOURCE =
  /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,/i;

function isAllowedProofSource(value: string): boolean {
  return ALLOWED_PROOF_SOURCE.test(value.trim());
}

/**
 * Renders the submitted payment screenshot, or an explicit "none provided"
 * state (which is expected whenever the user submitted a transaction ID only).
 */
function DepositProof({ proof }: { proof: string | null }) {
  const [broken, setBroken] = useState(false);

  // A new deposit is a new image — clear the error state between them.
  useEffect(() => {
    setBroken(false);
  }, [proof]);

  const source = proof?.trim() ?? '';

  if (!source) {
    return (
      <p className="mt-1 text-sm text-slate-400">
        No payment screenshot provided.
      </p>
    );
  }

  if (broken || !isAllowedProofSource(source)) {
    return (
      <p className="mt-1 text-sm text-amber-300">
        Payment screenshot could not be displayed.
      </p>
    );
  }

  return (
    <div>
      <a
        href={source}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the payment screenshot full size"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 proof
            stored by this system; next/image cannot optimise a data URL */}
        <img
          src={source}
          alt="Payment screenshot"
          onError={() => setBroken(true)}
          className="mt-2 max-h-64 rounded-md border border-white/10 object-contain"
        />
      </a>

      <p className="mt-1 text-[11px] text-slate-500">
        Click the image to open it full size.
      </p>
    </div>
  );
}
