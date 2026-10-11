'use client';

/**
 * Admin users (Part B). Search + status filter, full detail, and account
 * moderation: profile edit, password reset, suspend/unsuspend, ban/unban
 * (ADMIN + SUPER_ADMIN) and soft delete (SUPER_ADMIN only). Every mutating
 * action requires a reason, is audited server-side, and revokes the target's
 * sessions. The backend remains the authority — an ADMIN calling a
 * SUPER_ADMIN-only route sees the server 403, never faked data.
 *
 * Account-domain separation: this page is the CUSTOMER directory — the API
 * (GET /admin/users) already excludes STAFF accounts at the query level, and
 * staff ids on the detail route 404. STAFF rows live on /admin/admins.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminUsers,
  getAdminUser,
  updateAdminUserProfile,
  resetAdminUserPassword,
  suspendAdminUser,
  unsuspendAdminUser,
  banAdminUser,
  unbanAdminUser,
  softDeleteAdminUser,
  type AdminUserListItem,
  type AdminUserDetail,
  type AdminUpdateUserProfileInput,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
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
  AdminPagination,
} from '@/components/admin/data-table';
import { Modal } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission, useVerifiedAdmin } from '@/components/admin/admin-guard';

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED', 'LOCKED', 'CLOSED'] as const;

type ModerationAction =
  | 'edit-profile'
  | 'reset-password'
  | 'suspend'
  | 'unsuspend'
  | 'ban'
  | 'unban'
  | 'soft-delete';

/** Editable identity fields of the moderation profile dialog. */
type ProfileForm = {
  email: string;
  phone: string;
  username: string;
  firstName: string;
  lastName: string;
};

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [data, setData] = useState<{ items: AdminUserListItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  /**
   * True only while the dialog is showing a one-time SUCCESS result that must
   * be acknowledged (a generated temporary password — Part 16). The footer
   * then swaps Confirm for Close so the action can never be re-submitted.
   */
  const [actionDone, setActionDone] = useState(false);
  const [reason, setReason] = useState('');
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    email: '',
    phone: '',
    username: '',
    firstName: '',
    lastName: '',
  });
  const [newPassword, setNewPassword] = useState('');
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminUsers({
        q: q.trim() || undefined,
        status: status || undefined,
        page,
        limit: pageSize,
      });
      setData({ items: result.items, total: result.total });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(user: AdminUserListItem) {
    setDetailLoading(true);
    setDetailError(null);
    // Optimistic placeholder from the row, then replaced by the full detail.
    setDetail({
      ...user,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      verifications: [],
      wallets: [],
      activeSessions: 0,
      totalBets: 0,
    });
    try {
      const full = await getAdminUser(user.id);
      setDetail(full);
    } catch (err) {
      setDetailError(err instanceof ApiClientError ? err.message : 'Failed to load user details.');
    } finally {
      setDetailLoading(false);
    }
  }

  /** Opens a moderation dialog, pre-filling from the loaded detail.
   *  Stale state from ANY previous action/user is cleared first (Part 18). */
  function openAction(next: ModerationAction) {
    if (!detail) return;
    setAction(next);
    setActionError(null);
    setActionNotice(null);
    setActionDone(false);
    setReason('');
    setNewPassword('');
    setProfileForm({
      email: detail.email ?? '',
      phone: detail.phone ?? '',
      username: detail.username ?? '',
      firstName: detail.firstName ?? '',
      lastName: detail.lastName ?? '',
    });
  }

  function closeAction() {
    if (actionBusy) return;
    setAction(null);
    setActionError(null);
    setActionNotice(null);
    setActionDone(false);
    setReason('');
    setNewPassword('');
  }

  /**
   * Submits the active moderation action against `detail`.
   *
   * SUCCESS state machine (Part 8):
   *   API resolves → close ONLY the action dialog (the parent detail modal
   *   stays open) → refresh list + detail → toast the result → updated state
   *   is visible immediately. Exception (Part 16): a GENERATED temporary
   *   password is never sent to an auto-dismissing toast — the dialog stays
   *   open on a dedicated one-time success notice until the operator clicks
   *   Close (actionDone), then all state is cleared.
   *
   * FAILURE state machine (Part 9): the dialog stays open, the error renders
   * under the form, entered values are preserved, and `finally` re-enables
   * the button for a retry. No setTimeout() anywhere — closure is driven
   * purely by the API result.
   */
  async function submitAction() {
    // Busy guard = double-submit protection at the state-machine level, on top
    // of the disabled/loading submit button (Part 19).
    if (actionBusy || !detail || !action) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      setActionError('A reason of at least 5 characters is required — it is stored in the audit log.');
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setActionNotice(null);
    setActionDone(false);
    let successMessage = 'Action completed.';
    let oneTimeNotice: string | null = null;
    try {
      const id = detail.id;
      switch (action) {
        case 'edit-profile': {
          const payload: AdminUpdateUserProfileInput = { reason: trimmedReason };
          if (profileForm.email.trim() !== (detail.email ?? '')) payload.email = profileForm.email.trim();
          if (profileForm.phone.trim() !== (detail.phone ?? '')) payload.phone = profileForm.phone.trim();
          if (profileForm.username.trim() !== (detail.username ?? ''))
            payload.username = profileForm.username.trim();
          if (profileForm.firstName.trim() !== (detail.firstName ?? ''))
            payload.firstName = profileForm.firstName.trim();
          if (profileForm.lastName.trim() !== (detail.lastName ?? ''))
            payload.lastName = profileForm.lastName.trim();
          if (Object.keys(payload).length === 1) {
            setActionError('Change at least one profile field before saving.');
            return;
          }
          setDetail(await updateAdminUserProfile(id, payload));
          successMessage = 'Profile updated successfully.';
          break;
        }
        case 'reset-password': {
          const result = await resetAdminUserPassword(id, {
            reason: trimmedReason,
            newPassword: newPassword.trim() ? newPassword : undefined,
          });
          if (result.temporaryPassword) {
            // One-time display (Part 16): the temp password must not be lost
            // to a toast auto-dismiss — keep THIS dialog open on the notice
            // until acknowledged. Never logged, never persisted client-side.
            oneTimeNotice = `Password reset. Temporary password (shown once): ${result.temporaryPassword} — ${result.sessionsRevoked} session(s) revoked.`;
          }
          // Best-effort detail refresh: a failed refresh must not mask the
          // successful reset (the list refresh below still runs).
          setDetail((await getAdminUser(id).catch(() => detail)) ?? detail);
          successMessage = 'Password reset successfully.';
          break;
        }
        case 'suspend':
          setDetail(await suspendAdminUser(id, trimmedReason));
          successMessage = 'Account suspended — all active sessions were revoked.';
          break;
        case 'unsuspend':
          setDetail(await unsuspendAdminUser(id, trimmedReason));
          successMessage = 'Account reactivated. The user signs in again.';
          break;
        case 'ban':
          setDetail(await banAdminUser(id, trimmedReason));
          successMessage = 'Account banned — all active sessions were revoked.';
          break;
        case 'unban':
          setDetail(await unbanAdminUser(id, trimmedReason));
          successMessage = 'Ban lifted. The user signs in again.';
          break;
        case 'soft-delete': {
          await softDeleteAdminUser(id, trimmedReason);
          setDetail((await getAdminUser(id).catch(() => detail)) ?? detail);
          successMessage =
            'Account soft-deleted: status is CLOSED, identity anonymized and sessions revoked. Bets and wallet history are retained.';
          break;
        }
      }
      // API succeeded → close ONLY the action dialog first (Parts 8/12), then
      // refresh the underlying list, then surface the result — the updated
      // state is visible immediately and the table never shows stale rows.
      if (oneTimeNotice) {
        setActionNotice(oneTimeNotice);
        setActionDone(true);
      } else {
        // The parent detail modal (if any) stays open and already shows the
        // detail refreshed inside the switch above.
        setAction(null);
        setActionError(null);
        setActionNotice(null);
        setActionDone(false);
        setReason('');
        setNewPassword('');
      }
      await load();
      toast(successMessage, 'success');
    } catch (err) {
      // API failed → the dialog stays open with the error visible for retry.
      setActionError(err instanceof ApiClientError ? err.message : 'Moderation action failed.');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description="Search accounts and review status, verification and roles. Suspend, ban, reset passwords and edit profiles — every action needs a reason and is audited."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Users' }]}
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Search (email, username, phone, name)</span>
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users…"
            type="search"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">Status</span>
          <select
            className={inputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" loading={loading}>
          Search
        </Button>
      </form>

      {loading && !data ? (
        <AdminTableSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : data && data.items.length === 0 ? (
        <AdminEmptyState title="No users match your filters" hint="Try a different search term or status." />
      ) : (
        data && (
          <>
            <AdminTable
              columns={USER_COLUMNS((u) => void openDetail(u))}
              rows={data.items}
              rowKey={(u) => u.id}
            />
            <AdminPagination page={page} limit={pageSize} total={data.total} onPageChange={setPage} />
          </>
        )
      )}

      <UserDetailModal
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetail(null)}
        onModerate={openAction}
      />
      <ModerationDialog
        action={action}
        detail={detail}
        actionBusy={actionBusy}
        actionDone={actionDone}
        actionNotice={actionNotice}
        actionError={actionError}
        reason={reason}
        setReason={setReason}
        profileForm={profileForm}
        setProfileForm={setProfileForm}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        closeAction={closeAction}
        submitAction={submitAction}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns + detail modal
// ---------------------------------------------------------------------------

function USER_COLUMNS(onView: (u: AdminUserListItem) => void) {
  return [
    {
      key: 'user',
      header: 'User',
      render: (u: AdminUserListItem) => (
        <div>
          <p className="font-medium text-white">{u.username}</p>
          <p className="text-xs text-slate-500">{u.email || u.phone || '—'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u: AdminUserListItem) => <AdminStatusBadge value={u.status} />,
    },
    {
      key: 'verification',
      header: 'Verification',
      render: (u: AdminUserListItem) => (
        <div className="flex flex-wrap gap-1 text-xs">
          <AdminStatusBadge value={u.phoneVerified ? 'VERIFIED' : 'NOT_STARTED'} />
          <AdminStatusBadge value={u.emailVerified ? 'VERIFIED' : 'NOT_STARTED'} />
          <AdminStatusBadge value={u.kycStatus} />
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u: AdminUserListItem) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.length === 0 ? (
            <span className="text-xs text-slate-500">—</span>
          ) : (
            u.roles.map((r) => <AdminStatusBadge key={r} value={r} />)
          )}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Registered',
      render: (u: AdminUserListItem) => <span className="text-xs text-slate-400">{formatDateTime(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (u: AdminUserListItem) => (
        <Button size="sm" variant="outline" onClick={() => onView(u)}>
          View
        </Button>
      ),
    },
  ];
}

function UserDetailModal({
  detail,
  loading,
  error,
  onClose,
  onModerate,
}: {
  detail: AdminUserDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onModerate: (action: ModerationAction) => void;
}) {
  const canUpdate = useAdminPermission(ADMIN_PERMISSIONS.USERS_UPDATE);
  const canResetPassword = useAdminPermission(ADMIN_PERMISSIONS.USERS_RESET_PASSWORD);
  const canSuspend = useAdminPermission(ADMIN_PERMISSIONS.USERS_SUSPEND);
  const canUnban = useAdminPermission(ADMIN_PERMISSIONS.USERS_UNBAN);
  const canBan = useAdminPermission(ADMIN_PERMISSIONS.USERS_BAN);
  const isMasterAdmin = useVerifiedAdmin()?.isMasterAdmin ?? false;
  const canDeletePermission = useAdminPermission(ADMIN_PERMISSIONS.USERS_DELETE);
  const canDelete = isMasterAdmin && canDeletePermission;

  return (
    <Modal
      open={detail !== null}
      title={detail ? `User — ${detail.username}` : 'User'}
      onClose={onClose}
      wide
    >
      {detail && (
        <div className="space-y-4" aria-busy={loading}>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoRow label="Email" value={detail.email || '—'} />
            <InfoRow label="Phone" value={detail.phone ?? '—'} />
            <InfoRow label="Status" value={<AdminStatusBadge value={detail.status} />} />
            <InfoRow label="KYC" value={<AdminStatusBadge value={detail.kycStatus} />} />
            <InfoRow label="Registered" value={formatDateTime(detail.createdAt)} />
            <InfoRow label="Last login" value={formatDateTime(detail.lastLoginAt)} />
            <InfoRow label="Roles" value={detail.roles.join(', ') || 'USER (none assigned)'} />
            <InfoRow label="Active sessions" value={String(detail.activeSessions)} />
          </div>

          <section aria-label="Account moderation">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Account moderation
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Every action requires a reason (audited) and revokes the account&apos;s sessions.
              Soft delete keeps bets and wallet history.
            </p>
            <div className="flex flex-wrap gap-2">
              {canUpdate ? (
                <Button variant="outline" size="sm" onClick={() => onModerate('edit-profile')}>
                  Edit profile
                </Button>
              ) : null}
              {canResetPassword ? (
                <Button variant="outline" size="sm" onClick={() => onModerate('reset-password')}>
                  Reset password
                </Button>
              ) : null}
              {detail.status === 'SUSPENDED' ? (
                canUnban ? (
                  <Button variant="outline" size="sm" onClick={() => onModerate('unsuspend')}>
                    Unsuspend
                  </Button>
                ) : null
              ) : canSuspend ? (
                <Button variant="outline" size="sm" onClick={() => onModerate('suspend')}>
                  Suspend
                </Button>
              ) : null}
              {detail.status === 'BANNED' ? (
                canUnban ? (
                  <Button variant="outline" size="sm" onClick={() => onModerate('unban')}>
                    Unban
                  </Button>
                ) : null
              ) : canBan ? (
                <Button variant="outline" size="sm" onClick={() => onModerate('ban')}>
                  Ban
                </Button>
              ) : null}
              {canDelete ? (
                <Button variant="danger" size="sm" onClick={() => onModerate('soft-delete')}>
                  Soft delete
                </Button>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Verification</h3>
            {detail.verifications.length === 0 ? (
              <p className="text-xs text-slate-500">No verification records.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.verifications.map((v) => (
                  <span
                    key={v.type}
                    className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs"
                  >
                    <span className="text-slate-300">{v.type}</span>
                    <AdminStatusBadge value={v.status} />
                    <span className="text-slate-500">{v.verifiedAt ? formatDateTime(v.verifiedAt) : ''}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Status only — sensitive verification data and biometrics are never exposed.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Wallets</h3>
            {detail.wallets.length === 0 ? (
              <p className="text-xs text-slate-500">No wallets.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.wallets.map((w) => (
                  <span
                    key={w.id}
                    className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs"
                  >
                    <span className="font-medium text-slate-200">{formatMinor(w.availableBalance, w.currency)}</span>
                    <span className="text-slate-500">({formatMinor(w.lockedBalance, w.currency)} locked)</span>
                    <AdminStatusBadge value={w.status} />
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Total bets: {detail.totalBets} · Manage wallets from the Wallets section.
            </p>
          </section>

          {error && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}
          {loading && <p className="text-xs text-slate-500">Refreshing full details…</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * Moderation dialog for the selected account. Presentational only: state and
 * the API calls stay in AdminUsersPage, so the reason-required + audit +
 * session-revocation guarantees are enforced by the backend, never re-faked
 * in the UI.
 */
function ModerationDialog({
  action,
  detail,
  actionBusy,
  actionDone,
  actionNotice,
  actionError,
  reason,
  setReason,
  profileForm,
  setProfileForm,
  newPassword,
  setNewPassword,
  closeAction,
  submitAction,
}: {
  action: ModerationAction | null;
  detail: AdminUserDetail | null;
  actionBusy: boolean;
  actionDone: boolean;
  actionNotice: string | null;
  actionError: string | null;
  reason: string;
  setReason: (value: string) => void;
  profileForm: ProfileForm;
  setProfileForm: (value: ProfileForm) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  closeAction: () => void;
  submitAction: () => Promise<void>;
}) {
  return (
    <Modal
      open={action !== null && detail !== null}
      title={
        action === 'edit-profile'
          ? `Edit profile — ${detail?.username ?? ''}`
          : action === 'reset-password'
            ? `Reset password — ${detail?.username ?? ''}`
            : action === 'soft-delete'
              ? `Soft delete — ${detail?.username ?? ''}`
              : `${action === 'unsuspend' ? 'Unsuspend' : action === 'unban' ? 'Unban' : action === 'suspend' ? 'Suspend' : 'Ban'} — ${detail?.username ?? ''}`
      }
      onClose={closeAction}
      footer={
        actionDone ? (
          // One-time success result (generated temporary password): the ONLY
          // actionable control is Close — the action cannot be re-submitted.
          <Button onClick={closeAction}>Close</Button>
        ) : (
          <>
            <Button variant="outline" onClick={closeAction} disabled={actionBusy}>
              Cancel
            </Button>
            <Button
              variant={action === 'soft-delete' || action === 'ban' ? 'danger' : 'primary'}
              onClick={() => void submitAction()}
              loading={actionBusy}
            >
              {action === 'edit-profile'
                ? 'Save profile'
                : action === 'reset-password'
                  ? 'Reset password'
                  : action === 'soft-delete'
                    ? 'Soft delete account'
                    : action === 'unsuspend' || action === 'unban'
                      ? 'Confirm'
                      : 'Confirm'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {action === 'edit-profile' && (
          <div className="grid gap-2">
            {(
              [
                ['email', 'Email'],
                ['phone', 'Phone (E.164, e.g. +447911123456)'],
                ['username', 'Username'],
                ['firstName', 'First name'],
                ['lastName', 'Last name'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} htmlFor={`moderate-${key}`} className="flex flex-col gap-1 text-sm font-medium">
                {label}
                <input
                  id={`moderate-${key}`}
                  className={inputClass}
                  value={profileForm[key]}
                  onChange={(e) => setProfileForm({ ...profileForm, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
        {action === 'reset-password' && (
          <label htmlFor="moderate-new-password" className="flex flex-col gap-1 text-sm font-medium">
            New password (optional — leave blank to generate a secure one)
            <input
              id="moderate-new-password"
              type="text"
              autoComplete="new-password"
              className={inputClass}
              placeholder="Min 8 characters, or blank to auto-generate"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
        )}
        {action === 'soft-delete' && (
          <p className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            Soft delete only: the account becomes CLOSED, its identity is anonymized and its
            sessions revoked — bets, wallets and audit history are kept. Permanent data erasure
            must stay a separate legal-reviewed script.
          </p>
        )}
        {(action === 'suspend' || action === 'ban') && (
          <p className="text-xs text-slate-400">
            {action === 'suspend'
              ? 'SUSPENDED is temporary/reviewable — reversible with Unsuspend.'
              : 'BANNED is permanent/severe — reversible only with Unban.'}{' '}
            All active sessions are revoked immediately.
          </p>
        )}
        <label htmlFor="moderate-reason" className="flex flex-col gap-1 text-sm font-medium">
          Reason (required, min 5 characters — stored in the audit log)
          <textarea
            id="moderate-reason"
            className={inputClass}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {actionNotice && (
          <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            {actionNotice}
          </p>
        )}
        {actionError && (
          <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {actionError}
          </p>
        )}
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-ink-600 bg-ink-800/60 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  );
}
