'use client';

/**
 * Admin management (SUPER_ADMIN only).
 *
 * Two sections:
 *  - Staff accounts: the STAFF directory (GET /admin/admins) with
 *    account creation (POST /admin/users), role editing
 *    (PUT /admin/users/:userId/roles) and full account lifecycle management â€”
 *    profile edit (PATCH /admin/users/:userId/admin-profile), password reset
 *    (POST .../admin-password-reset) and deactivation (DELETE /admin/admins/:id).
 *    The API returns only STAFF rows for this table (never customers) â€” the
 *    backend enforces the population, this page just renders it.
 *  - Roles & permissions: per-role permission sets, editable via
 *    PUT /admin/roles/:roleId/permissions (GET /admin/roles/list +
 *    GET /admin/permissions/list).
 *
 * SUPER_ADMIN itself is never grantable or editable here â€” the API rejects it
 * (the only supported path is the promote-admin script) and the UI hides it
 * from every selectable list. Nav visibility and this page's gate are
 * convenience only: the backend 403s any non-SUPER_ADMIN caller, so an ADMIN
 * opening /admin/admins directly sees an access-denied state, never data.
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSION_GROUPS, ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  createAdminRole,
  createAdminUser,
  deactivateStaff,
  deleteAdminRole,
  listAdminPermissions,
  listAdminRoles,
  listAdminStaff,
  resetStaffPassword,
  updateAdminRole,
  updateAdminRolePermissions,
  updateAdminUserPermissions,
  updateAdminUserRoles,
  updateStaffProfile,
  type AdminPermissionItem,
  type AdminRoleItem,
  type AdminUserListItem,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import { AdminPageHeader, AdminStatusBadge, formatDateTime } from '@/components/admin/ui';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminPagination,
  AdminTable,
  AdminTableSkeleton,
} from '@/components/admin/data-table';
import { Modal } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission, useVerifiedAdmin } from '@/components/admin/admin-guard';

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-slate-400';

const PAGE_SIZE = 20;

const emptyForm = { email: '', username: '', password: '', firstName: '', lastName: '' };

/** Staff account lifecycle actions (SUPER_ADMIN only) â€” Part C. */
type StaffAction = 'edit-profile' | 'reset-password' | 'deactivate';

export default function AdminAdminsPage() {
  const { toast } = useToast();
  const admin = useVerifiedAdmin();
  const isSuperAdmin = admin?.isMasterAdmin ?? false;
  const hasCreateAdminPermission = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_CREATE);
  const hasUpdateAdminPermission = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_UPDATE);
  const hasDeactivateAdminPermission = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_DEACTIVATE);
  const hasResetAdminPasswordPermission = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_RESET_PASSWORD);
  const hasManageRolesPermission = useAdminPermission(ADMIN_PERMISSIONS.ROLES_ASSIGN);
  const hasManageDirectPermissionsPermission = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_ROLES_MANAGE);
  const hasCreateRolePermission = useAdminPermission(ADMIN_PERMISSIONS.ROLES_CREATE);
  const hasUpdateRolePermission = useAdminPermission(ADMIN_PERMISSIONS.ROLES_UPDATE);
  const hasDeleteRolePermission = useAdminPermission(ADMIN_PERMISSIONS.ROLES_DELETE);
  const canReadAdmins = useAdminPermission(ADMIN_PERMISSIONS.ADMINS_READ);

  // The backend keeps all staff lifecycle/role mutations SUPER_ADMIN-only.
  // Apply the same boundary in the UI so a stale or mis-provisioned direct
  // permission cannot expose controls to an ordinary staff session.
  const canCreateAdmin = isSuperAdmin && hasCreateAdminPermission;
  const canUpdateAdmin = isSuperAdmin && hasUpdateAdminPermission;
  const canDeactivateAdmin = isSuperAdmin && hasDeactivateAdminPermission;
  const canResetAdminPassword = isSuperAdmin && hasResetAdminPasswordPermission;
  const canManageRoles = isSuperAdmin && hasManageRolesPermission;
  const canManageDirectPermissions = isSuperAdmin && hasManageDirectPermissionsPermission;
  const canCreateRole = isSuperAdmin && hasCreateRolePermission;
  const canUpdateRole = isSuperAdmin && hasUpdateRolePermission;
  const canDeleteRole = isSuperAdmin && hasDeleteRolePermission;

  // Staff accounts (users tab)
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<{ items: AdminUserListItem[]; total: number } | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Roles & permissions catalog (roles tab)
  const [roles, setRoles] = useState<AdminRoleItem[] | null>(null);
  const [permissions, setPermissions] = useState<AdminPermissionItem[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [roleCreateOpen, setRoleCreateOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [roleFormError, setRoleFormError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleEditTarget, setRoleEditTarget] = useState<AdminRoleItem | null>(null);
  const [roleEditForm, setRoleEditForm] = useState({ name: '', description: '' });
  const [roleEditBusy, setRoleEditBusy] = useState(false);
  const [roleEditError, setRoleEditError] = useState<string | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<AdminUserListItem | null>(null);
  const [permissionGrants, setPermissionGrants] = useState<string[]>([]);
  const [permissionDenies, setPermissionDenies] = useState<string[]>([]);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Create-admin modal
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit-roles modal
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null);
  const [editSelection, setEditSelection] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Staff account lifecycle (SUPER_ADMIN only): profile edit / password reset /
  // deactivation. Every action carries a mandatory reason and is audited by the
  // backend; the server remains the authority (it 403s SUPER_ADMIN targets and
  // the UI mirrors that by hiding the actions for protected rows).
  const [staffAction, setStaffAction] = useState<StaffAction | null>(null);
  const [staffTarget, setStaffTarget] = useState<AdminUserListItem | null>(null);
  const [staffForm, setStaffForm] = useState({ email: '', username: '', firstName: '', lastName: '' });
  const [staffNewPassword, setStaffNewPassword] = useState('');
  const [staffReason, setStaffReason] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffNotice, setStaffNotice] = useState<string | null>(null);
  /**
   * True only while the staff dialog shows a one-time SUCCESS result that must
   * be acknowledged (a generated temporary password â€” Part 16). The footer
   * then swaps the action button for Close so it can never be re-submitted.
   */
  const [staffDone, setStaffDone] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const result = await listAdminStaff({ q: q.trim() || undefined, page, limit: PAGE_SIZE });
      setUsers({ items: result.items, total: result.total });
    } catch (err) {
      setUsersError(err instanceof ApiClientError ? err.message : 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, [q, page]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [roleRows, permissionRows] = await Promise.all([
        listAdminRoles(),
        listAdminPermissions(),
      ]);
      setRoles(roleRows);
      setPermissions(permissionRows);
      setDrafts(
        Object.fromEntries(roleRows.map((r) => [r.id, r.permissions.map((p) => p.permission.id)])),
      );
      setDirty({});
    } catch (err) {
      setCatalogError(
        err instanceof ApiClientError ? err.message : 'Failed to load roles and permissions.',
      );
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canReadAdmins || isSuperAdmin) void loadUsers();
  }, [loadUsers, canReadAdmins, isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin) void loadCatalog();
  }, [loadCatalog, isSuperAdmin]);

  function toggleRole(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((r) => r !== name) : [...list, name];
  }

  function togglePermission(roleId: string, permissionId: string) {
    setDrafts((prev) => {
      const current = prev[roleId] ?? [];
      const next = current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId];
      return { ...prev, [roleId]: next };
    });
    setDirty((prev) => ({ ...prev, [roleId]: true }));
  }

  function toggleDirectGrant(name: string) {
    setPermissionGrants((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
    setPermissionDenies((current) => current.filter((item) => item !== name));
  }

  function toggleDirectDeny(name: string) {
    setPermissionDenies((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
    setPermissionGrants((current) => current.filter((item) => item !== name));
  }

  function openPermissionEditor(user: AdminUserListItem) {
    if (!canManageDirectPermissions || user.roles.includes('SUPER_ADMIN')) return;
    setPermissionTarget(user);
    setPermissionGrants(user.directPermissionNames ?? []);
    setPermissionDenies(user.deniedPermissionNames ?? []);
    setPermissionError(null);
  }

  function closePermissionEditor() {
    if (permissionBusy) return;
    setPermissionTarget(null);
    setPermissionError(null);
  }

  async function submitPermissions() {
    if (!permissionTarget || permissionBusy || !canManageDirectPermissions) return;
    setPermissionBusy(true);
    setPermissionError(null);
    try {
      await updateAdminUserPermissions(permissionTarget.id, {
        grantPermissionNames: permissionGrants,
        denyPermissionNames: permissionDenies,
      });
      setPermissionTarget(null);
      await loadUsers();
      toast(`Direct permissions updated for ${permissionTarget.username}.`, 'success');
    } catch (err) {
      setPermissionError(err instanceof ApiClientError ? err.message : 'Failed to update permissions.');
    } finally {
      setPermissionBusy(false);
    }
  }

  function openRoleCreate() {
    if (!canCreateRole) return;
    setRoleForm({ name: '', description: '' });
    setRoleFormError(null);
    setRoleCreateOpen(true);
  }

  function openRoleEdit(role: AdminRoleItem) {
    if (!canUpdateRole || role.name === 'SUPER_ADMIN') return;
    setRoleEditTarget(role);
    setRoleEditForm({ name: role.name, description: role.description ?? '' });
    setRoleEditError(null);
  }

  async function submitRoleEdit() {
    if (!roleEditTarget || roleEditBusy || !canUpdateRole) return;
    setRoleEditBusy(true);
    setRoleEditError(null);
    try {
      const updated = await updateAdminRole(roleEditTarget.id, {
        name: roleEditForm.name.trim(),
        description: roleEditForm.description.trim() || undefined,
      });
      setRoleEditTarget(null);
      await loadCatalog();
      toast(`${updated.name} updated.`, 'success');
    } catch (err) {
      setRoleEditError(err instanceof ApiClientError ? err.message : 'Failed to update role.');
    } finally {
      setRoleEditBusy(false);
    }
  }

  async function submitRoleDelete() {
    if (!roleEditTarget || roleEditBusy || !canDeleteRole) return;
    setRoleEditBusy(true);
    setRoleEditError(null);
    try {
      await deleteAdminRole(roleEditTarget.id);
      setRoleEditTarget(null);
      await loadCatalog();
      toast('Role deleted.', 'success');
    } catch (err) {
      setRoleEditError(err instanceof ApiClientError ? err.message : 'Failed to delete role.');
    } finally {
      setRoleEditBusy(false);
    }
  }

  async function submitRoleCreate() {
    if (creatingRole || !canCreateRole) return;
    setCreatingRole(true);
    setRoleFormError(null);
    try {
      await createAdminRole({
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        permissionNames: [],
      });
      setRoleCreateOpen(false);
      await loadCatalog();
      toast('Role created. Add its permissions and save when ready.', 'success');
    } catch (err) {
      setRoleFormError(err instanceof ApiClientError ? err.message : 'Failed to create role.');
    } finally {
      setCreatingRole(false);
    }
  }

  async function submitCreate() {
    if (creating) return; // double-submit guard (Part 19)
    setCreating(true);
    setFormError(null);
    try {
      await createAdminUser({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        roleNames: selectedRoles,
      });
      const createdFor = form.email.trim();
      // Success â†’ close the create dialog â†’ refresh the staff list â†’ toast.
      setCreateOpen(false);
      await loadUsers();
      toast(`Admin account created for ${createdFor}.`, 'success');
    } catch (err) {
      // Failure: the create dialog stays open with the error and the entered
      // values, and the button is re-enabled by `finally`.
      setFormError(
        err instanceof ApiClientError ? err.message : 'Failed to create the admin account.',
      );
    } finally {
      setCreating(false);
    }
  }

  function openEditRoles(user: AdminUserListItem) {
    if (!canManageRoles || user.roles.includes('SUPER_ADMIN')) return;
    setEditTarget(user);
    setEditSelection(user.roles.filter((r) => r !== 'SUPER_ADMIN'));
    setEditError(null);
  }

  async function submitEditRoles() {
    if (savingRoles || !editTarget || !canManageRoles) return; // double-submit guard (Part 19)
    setSavingRoles(true);
    setEditError(null);
    try {
      const roleMessage = `Roles updated for ${editTarget.username}.`;
      // The API is the authority: it validates the role set, re-checks the
      // SUPER_ADMIN retention rule and writes the audit entry. Nothing is
      // closed or toasted until this resolves.
      await updateAdminUserRoles(editTarget.id, editSelection);
      // Success â†’ close ONLY the roles dialog â†’ refresh the staff list â†’ toast.
      setEditTarget(null);
      await loadUsers();
      toast(roleMessage, 'success');
    } catch (err) {
      // Failure: dialog stays open, error visible, button re-enabled.
      setEditError(err instanceof ApiClientError ? err.message : 'Failed to update roles.');
    } finally {
      setSavingRoles(false);
    }
  }

  /** Opens a staff-account dialog pre-filled from the directory row.
   *  Stale state from ANY previous action/user is cleared first (Part 18). */
  function openStaffAction(next: StaffAction, user: AdminUserListItem) {
    setStaffAction(next);
    setStaffTarget(user);
    setStaffError(null);
    setStaffNotice(null);
    setStaffDone(false);
    setStaffNewPassword('');
    setStaffReason('');
    setStaffForm({
      email: user.email ?? '',
      username: user.username ?? '',
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
    });
  }

  function closeStaffAction() {
    if (staffBusy) return;
    setStaffAction(null);
    setStaffError(null);
    setStaffNotice(null);
    setStaffDone(false);
    setStaffReason('');
    setStaffNewPassword('');
  }

  /**
   * Submits the active staff action against `staffTarget` (audited server-side).
   *
   * SUCCESS state machine (Parts 8/11): API resolves â†’ close ONLY this staff
   * dialog â†’ refresh the staff list â†’ toast the result. Exception (Part 16):
   * a GENERATED temporary password keeps the dialog open on its dedicated
   * one-time notice (never an auto-dismissing toast) until acknowledged via
   * Close (staffDone).
   *
   * FAILURE (Part 9): dialog stays open, error rendered, entered values
   * preserved, `finally` re-enables the button. No setTimeout() anywhere.
   */
  async function submitStaffAction() {
    // Busy guard = double-submit protection on top of the disabled/loading
    // submit button (Part 19).
    if (staffBusy || !staffTarget || !staffAction) return;
    const trimmedReason = staffReason.trim();
    if (trimmedReason.length < 5) {
      setStaffError('A reason of at least 5 characters is required â€” it is stored in the audit log.');
      return;
    }
    setStaffBusy(true);
    setStaffError(null);
    setStaffNotice(null);
    setStaffDone(false);
    let successMessage = 'Action completed.';
    let oneTimeNotice: string | null = null;
    try {
      const id = staffTarget.id;
      if (staffAction === 'edit-profile') {
        const payload: Parameters<typeof updateStaffProfile>[1] = { reason: trimmedReason };
        if (staffForm.email.trim() !== (staffTarget.email ?? '')) payload.email = staffForm.email.trim();
        if (staffForm.username.trim() !== staffTarget.username) payload.username = staffForm.username.trim();
        if (staffForm.firstName.trim() !== (staffTarget.firstName ?? ''))
          payload.firstName = staffForm.firstName.trim();
        if (staffForm.lastName.trim() !== (staffTarget.lastName ?? ''))
          payload.lastName = staffForm.lastName.trim();
        if (Object.keys(payload).length === 1) {
          setStaffError('Change at least one field before saving.');
          return;
        }
        await updateStaffProfile(id, payload);
        successMessage = 'Admin account updated successfully.';
      } else if (staffAction === 'reset-password') {
        const result = await resetStaffPassword(id, {
          reason: trimmedReason,
          newPassword: staffNewPassword.trim() ? staffNewPassword : undefined,
        });
        if (result.temporaryPassword) {
          // One-time display (Part 16): never sent to a toast that could
          // auto-dismiss before it is read. Not logged, not persisted.
          oneTimeNotice = `Password reset. Temporary password (shown once): ${result.temporaryPassword} â€” ${result.sessionsRevoked} session(s) revoked.`;
        }
        successMessage = 'Password reset successfully.';
      } else {
        const result = await deactivateStaff(id, trimmedReason);
        successMessage = `${staffTarget.username} deactivated — ${result.rolesRemoved.length} role(s) removed, ${result.sessionsRevoked} session(s) revoked.`;
      }
      if (oneTimeNotice) {
        setStaffNotice(oneTimeNotice);
        setStaffDone(true);
      } else {
        // Success â†’ close ONLY this action dialog first, then refresh the staff
        // table beneath it and surface the result (Part 8 ordering).
        setStaffAction(null);
        setStaffError(null);
        setStaffNotice(null);
        setStaffDone(false);
        setStaffReason('');
        setStaffNewPassword('');
      }
      await loadUsers();
      toast(successMessage, 'success');
    } catch (err) {
      // API failed â†’ the dialog stays open with the error visible for retry.
      setStaffError(err instanceof ApiClientError ? err.message : 'The request failed.');
    } finally {
      setStaffBusy(false);
    }
  }

  async function saveRolePermissions(role: AdminRoleItem) {
    if (!canUpdateRole || role.name === 'SUPER_ADMIN') return;
    setSavingRoleId(role.id);
    try {
      const updated = await updateAdminRolePermissions(role.id, drafts[role.id] ?? []);
      setRoles(updated);
      setDrafts((prev) => ({
        ...prev,
        ...Object.fromEntries(updated.map((r) => [r.id, r.permissions.map((p) => p.permission.id)])),
      }));
      setDirty((prev) => ({ ...prev, [role.id]: false }));
      toast(`${role.name} permissions saved.`, 'success');
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Failed to save permissions.', 'error');
    } finally {
      setSavingRoleId(null);
    }
  }

  // The directory is readable by an ordinary staff session with ADMINS_READ.
  // All account/role mutations below are independently SUPER_ADMIN-gated and
  // permission-gated by their handlers; this page is not a client-side security
  // boundary.
  if (!canReadAdmins) {
    return (
      <div>
        <AdminPageHeader
          title="Admins"
          crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Admins' }]}
        />
        <AdminErrorState message="403 — ADMINS_READ is required to view the staff directory." />
      </div>
    );
  }

  const assignableRoles = (roles ?? []).filter(
    (r) => r.name !== 'SUPER_ADMIN' && r.name !== 'USER',
  );

  return (
    <div>
      <AdminPageHeader
        title="Admins"
        description="Create staff accounts, assign roles and control each role's permissions. SUPER_ADMIN itself is fixed â€” grant it only via the promote-admin script."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Admins' }]}
        actions={
          tab === 'users' ? (
            canCreateAdmin ? (
              <Button size="sm" onClick={() => { setForm(emptyForm); setSelectedRoles([]); setFormError(null); setCreateOpen(true); }}>
                + New Admin
              </Button>
            ) : undefined
          ) : (
            <>
              {canCreateRole ? (
                <Button size="sm" onClick={openRoleCreate}>
                  + New Role
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void loadCatalog()} loading={catalogLoading}>
                Refresh
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Admin management sections">
        <Button
          variant={tab === 'users' ? 'primary' : 'outline'}
          size="sm"
          aria-selected={tab === 'users'}
          onClick={() => setTab('users')}
        >
          Staff accounts
        </Button>
        <Button
          variant={tab === 'roles' ? 'primary' : 'outline'}
          size="sm"
          aria-selected={tab === 'roles'}
          onClick={() => setTab('roles')}
          disabled={!isSuperAdmin}
        >
          Roles &amp; permissions
        </Button>
      </div>

      {tab === 'users' ? (
        <section aria-label="Staff accounts">
          <form
            className="mb-4 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              void loadUsers();
            }}
          >
            <input
              className={`${inputClass} max-w-xs`}
              placeholder="Search email or usernameâ€¦"
              aria-label="Search users"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button variant="outline" size="sm" type="submit">
              Search
            </Button>
          </form>

          {usersLoading ? (
            <AdminTableSkeleton rows={5} />
          ) : usersError ? (
            <AdminErrorState message={usersError} onRetry={() => void loadUsers()} />
          ) : users && users.items.length === 0 ? (
            <AdminEmptyState title="No users found" hint="Adjust the search to find staff accounts." />
          ) : users ? (
             <>
              <AdminTable
                columns={[
                  {
                    key: 'user',
                    header: 'User',
                    render: (row) => (
                      <div>
                        <p className="font-medium text-slate-100">{row.username}</p>
                        <p className="text-xs text-slate-500">{row.email || 'â€”'}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row) => <AdminStatusBadge value={row.status} />,
                  },
                  {
                    key: 'roles',
                    header: 'Roles',
                    render: (row) => (
                      <div className="flex flex-wrap gap-1">
                        {row.roles.length === 0 && <span className="text-xs text-slate-500">â€”</span>}
                        {row.roles.map((role) => (
                          <span
                            key={role}
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              role === 'SUPER_ADMIN'
                                ? 'border-teal-500/40 bg-teal-950/50 text-teal-300'
                                : 'border-ink-600 bg-ink-800 text-slate-300'
                            }`}
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: 'permissions',
                    header: 'Effective permissions',
                    render: (row) => (
                      <div className="max-w-[220px] text-xs text-slate-400">
                        {row.effectivePermissions?.length
                          ? row.effectivePermissions.slice(0, 3).join(', ')
                          : 'No capabilities'}
                        {(row.effectivePermissions?.length ?? 0) > 3
                          ? ` +${(row.effectivePermissions?.length ?? 0) - 3} more`
                          : ''}
                      </div>
                    ),
                  },
                  {
                    key: 'created',
                    header: 'Created',
                    render: (row) => formatDateTime(row.createdAt),
                  },
                   {
                    key: 'actions',
                    header: 'Actions',
                    render: (row) => (
                      <div className="flex flex-wrap items-center gap-1">
                        {canManageRoles ? (
                          <Button variant="outline" size="sm" onClick={() => openEditRoles(row)}>
                            Roles
                          </Button>
                        ) : null}
                        {canManageDirectPermissions && !row.roles.includes('SUPER_ADMIN') ? (
                          <Button variant="outline" size="sm" onClick={() => openPermissionEditor(row)}>
                            Permissions
                          </Button>
                        ) : null}
                        {row.roles.includes('SUPER_ADMIN') ? (
                          <span
                            className="self-center text-xs text-slate-500"
                            title="SUPER_ADMIN is managed only via the promote-admin script"
                          >
                            protected
                          </span>
                        ) : (
                          <>
                            {canUpdateAdmin ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openStaffAction('edit-profile', row)}
                              >
                                Edit profile
                              </Button>
                            ) : null}
                            {canResetAdminPassword ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openStaffAction('reset-password', row)}
                              >
                                Reset password
                              </Button>
                            ) : null}
                            {!canDeactivateAdmin ? null : admin?.username === row.username ? (
                              <span className="self-center text-xs text-slate-500" title="You cannot deactivate your own account">
                                you
                              </span>
                            ) : (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => openStaffAction('deactivate', row)}
                              >
                                Deactivate
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
                rows={users.items}
                rowKey={(row) => row.id}
              />
              <AdminPagination page={page} limit={PAGE_SIZE} total={users.total} onPageChange={setPage} />
            </>
          ) : null}
        </section>
      ) : (
        <section aria-label="Roles and permissions">
          {catalogLoading ? (
            <AdminTableSkeleton rows={6} />
          ) : catalogError ? (
            <AdminErrorState message={catalogError} onRetry={() => void loadCatalog()} />
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Tick the permissions each role should hold, then Save. Changes apply to every user
                holding the role. SUPER_ADMIN always holds every permission and is never editable.
              </p>
              {roles?.map((role) => {
                const locked = role.name === 'SUPER_ADMIN';
                const selected = locked
                  ? role.permissions.map((p) => p.permission.id)
                  : (drafts[role.id] ?? []);
                return (
                  <div key={role.id} className="rounded-lg border border-ink-600 bg-ink-900 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{role.name}</h3>
                        {locked && (
                          <span className="rounded-full border border-teal-500/40 bg-teal-950/50 px-2 py-0.5 text-xs text-teal-300">
                            fixed
                          </span>
                        )}
                        <span className="text-xs text-slate-500">{selected.length} permission(s)</span>
                      </div>
                      {!locked && canUpdateRole ? (
                         <>
                           <Button variant="outline" size="sm" onClick={() => openRoleEdit(role)}>
                             Edit details
                           </Button>
                        <Button
                          size="sm"
                          disabled={!dirty[role.id]}
                          loading={savingRoleId === role.id}
                          onClick={() => void saveRolePermissions(role)}
                        >
                          Save
                        </Button>
                         </>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {permissions?.map((p) => (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200 ${
                            locked ? 'opacity-60' : 'cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-teal-500"
                            disabled={locked || !canUpdateRole}
                            checked={selected.includes(p.id)}
                            onChange={() => togglePermission(role.id, p.id)}
                          />
                          <span className="font-mono text-xs">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <Modal
        open={roleEditTarget !== null}
        title={`Edit role — ${roleEditTarget?.name ?? ''}`}
        onClose={() => !roleEditBusy && setRoleEditTarget(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setRoleEditTarget(null)} disabled={roleEditBusy}>
              Cancel
            </Button>
            {canUpdateRole ? (
              <Button onClick={() => void submitRoleEdit()} loading={roleEditBusy}>
                Save role
              </Button>
            ) : null}
            {canDeleteRole ? (
              <Button variant="danger" onClick={() => void submitRoleDelete()} disabled={roleEditBusy}>
                Delete role
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1" htmlFor="edit-role-name">
            <span className={labelClass}>Role name</span>
            <input
              id="edit-role-name"
              className={inputClass}
              value={roleEditForm.name}
              onChange={(event) => setRoleEditForm({ ...roleEditForm, name: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1" htmlFor="edit-role-description">
            <span className={labelClass}>Description</span>
            <textarea
              id="edit-role-description"
              className={inputClass}
              rows={3}
              value={roleEditForm.description}
              onChange={(event) => setRoleEditForm({ ...roleEditForm, description: event.target.value })}
            />
          </label>
          <p className="text-xs text-slate-500">Permission changes are made on the role card.</p>
          {roleEditError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {roleEditError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={roleCreateOpen}
        title="Create staff role"
        onClose={() => !creatingRole && setRoleCreateOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setRoleCreateOpen(false)} disabled={creatingRole}>
              Cancel
            </Button>
            {canCreateRole ? (
              <Button onClick={() => void submitRoleCreate()} loading={creatingRole}>
                Create role
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1" htmlFor="role-name">
            <span className={labelClass}>Role name</span>
            <input
              id="role-name"
              className={inputClass}
              value={roleForm.name}
              onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })}
              placeholder="Support Agent"
            />
          </label>
          <label className="flex flex-col gap-1" htmlFor="role-description">
            <span className={labelClass}>Description</span>
            <textarea
              id="role-description"
              className={inputClass}
              rows={3}
              value={roleForm.description}
              onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })}
              placeholder="What this role may do"
            />
          </label>
          <p className="text-xs text-slate-500">
            The role is created with no permissions. Tick its capabilities in Roles &amp; permissions,
            then save. SUPER_ADMIN and USER remain reserved.
          </p>
          {roleFormError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {roleFormError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={permissionTarget !== null}
        title={`Direct permissions — ${permissionTarget?.username ?? ''}`}
        onClose={closePermissionEditor}
        footer={
          <>
            <Button variant="outline" onClick={closePermissionEditor} disabled={permissionBusy}>
              Cancel
            </Button>
              {canManageDirectPermissions ? (
                <Button onClick={() => void submitPermissions()} loading={permissionBusy}>
                  Save permissions
                </Button>
              ) : null}
          </>
        }
      >
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-xs text-slate-400">
            Role permissions are inherited. A direct grant adds one capability; a direct deny always
            wins over a role grant. The server recalculates the effective set on the next request.
          </p>
          {ADMIN_PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.module} className="rounded-md border border-ink-600 bg-ink-800 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                {group.module}
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {group.permissions.map((permission) => (
                  <div key={permission.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-300">{permission.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <label className="flex items-center gap-1 text-emerald-300">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-teal-500"
                          checked={permissionGrants.includes(permission.name)}
                          onChange={() => toggleDirectGrant(permission.name)}
                        />
                        Grant
                      </label>
                      <label className="flex items-center gap-1 text-red-300">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-red-500"
                          checked={permissionDenies.includes(permission.name)}
                          onChange={() => toggleDirectDeny(permission.name)}
                        />
                        Deny
                      </label>
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          {permissionError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {permissionError}
            </p>
          )}
        </div>
      </Modal>


      <Modal
        open={createOpen}
        title="New admin account"
        onClose={() => setCreateOpen(false)}
        footer={
            <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            {canCreateAdmin ? (
              <Button onClick={() => void submitCreate()} loading={creating}>
                Create account
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="admin-email" className={labelClass}>
              Email
            </label>
            <input
              id="admin-email"
              className={inputClass}
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="admin-username" className={labelClass}>
              Username
            </label>
            <input
              id="admin-username"
              className={inputClass}
              autoComplete="off"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="admin-password" className={labelClass}>
              Password (min 8 characters)
            </label>
            <input
              id="admin-password"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-first-name" className={labelClass}>
                First name
              </label>
              <input
                id="admin-first-name"
                className={inputClass}
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="admin-last-name" className={labelClass}>
                Last name
              </label>
              <input
                id="admin-last-name"
                className={inputClass}
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <span className={labelClass}>Roles</span>
            <div className="mt-1">
              <RoleCheckboxList
                options={assignableRoles}
                selected={selectedRoles}
                onToggle={(name) => setSelectedRoles((prev) => toggleRole(prev, name))}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              SUPER_ADMIN is not selectable â€” grant it only with the promote-admin script.
            </p>
          </div>
          {formError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {formError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        title={`Roles â€” ${editTarget?.username ?? ''}`}
        onClose={() => setEditTarget(null)}
        footer={
            <>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingRoles}>
              Cancel
            </Button>
            {canManageRoles ? (
              <Button onClick={() => void submitEditRoles()} loading={savingRoles}>
                Save roles
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          {editTarget?.roles.includes('SUPER_ADMIN') && (
            <p className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              This account holds SUPER_ADMIN â€” it is always kept and cannot be removed here.
            </p>
          )}
          <RoleCheckboxList
            options={assignableRoles}
            selected={editSelection}
            onToggle={(name) => setEditSelection((prev) => toggleRole(prev, name))}
          />
          <p className="text-xs text-slate-500">
            Saving replaces all other roles with the selection above (full replacement).
          </p>
          {editError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {editError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={staffAction !== null}
        title={
          staffAction === 'edit-profile'
            ? `Edit profile â€” ${staffTarget?.username ?? ''}`
            : staffAction === 'reset-password'
              ? `Reset password â€” ${staffTarget?.username ?? ''}`
              : `Deactivate â€” ${staffTarget?.username ?? ''}`
        }
        onClose={closeStaffAction}
        footer={
          staffDone ? (
            // One-time success result (generated temporary password): the ONLY
            // actionable control is Close â€” the action cannot be re-submitted.
            <Button onClick={closeStaffAction}>Close</Button>
          ) : (
             <>
              <Button variant="outline" onClick={closeStaffAction} disabled={staffBusy}>
                Close
              </Button>
              <Button
                variant={staffAction === 'deactivate' ? 'danger' : 'primary'}
                onClick={() => void submitStaffAction()}
                loading={staffBusy}
              >
                {staffAction === 'edit-profile'
                  ? 'Save changes'
                  : staffAction === 'reset-password'
                    ? 'Reset password'
                    : 'Deactivate'}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-3">
          {staffAction === 'edit-profile' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="staff-email" className="flex flex-col gap-1">
                <span className={labelClass}>Email</span>
                <input
                  id="staff-email"
                  className={inputClass}
                  type="email"
                  autoComplete="off"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                />
              </label>
              <label htmlFor="staff-username" className="flex flex-col gap-1">
                <span className={labelClass}>Username</span>
                <input
                  id="staff-username"
                  className={inputClass}
                  autoComplete="off"
                  value={staffForm.username}
                  onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                />
              </label>
              <label htmlFor="staff-first-name" className="flex flex-col gap-1">
                <span className={labelClass}>First name</span>
                <input
                  id="staff-first-name"
                  className={inputClass}
                  value={staffForm.firstName}
                  onChange={(e) => setStaffForm({ ...staffForm, firstName: e.target.value })}
                />
              </label>
              <label htmlFor="staff-last-name" className="flex flex-col gap-1">
                <span className={labelClass}>Last name</span>
                <input
                  id="staff-last-name"
                  className={inputClass}
                  value={staffForm.lastName}
                  onChange={(e) => setStaffForm({ ...staffForm, lastName: e.target.value })}
                />
              </label>
            </div>
          )}

          {staffAction === 'reset-password' && (
            <label htmlFor="staff-new-password" className="flex flex-col gap-1">
              <span className={labelClass}>New password (optional)</span>
              <input
                id="staff-new-password"
                className={inputClass}
                type="text"
                autoComplete="new-password"
                placeholder="Blank = generate a secure one, shown once"
                value={staffNewPassword}
                onChange={(e) => setStaffNewPassword(e.target.value)}
              />
              <span className="text-xs text-slate-500">
                Min 8 characters. Every active session of the account is revoked either way.
              </span>
            </label>
          )}

          {staffAction === 'deactivate' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              Soft deactivation: all roles (ADMIN included) are stripped, the identity is anonymized
              and every session is revoked â€” financial and audit history are kept. The account can
              no longer sign in, neither as staff nor as a customer.
            </p>
          )}

          <label htmlFor="staff-reason" className="flex flex-col gap-1">
            <span className={labelClass}>Reason (required, min 5 characters â€” audited)</span>
            <textarea
              id="staff-reason"
              className={inputClass}
              rows={3}
              value={staffReason}
              disabled={staffBusy}
              onChange={(e) => setStaffReason(e.target.value)}
            />
          </label>

          {staffNotice && (
            <p
              role="status"
              className="break-words rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200"
            >
              {staffNotice}
            </p>
          )}
          {staffError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {staffError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function RoleCheckboxList({
  options,
  selected,
  onToggle,
}: {
  options: AdminRoleItem[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  if (options.length === 0) {
    return <p className="text-xs text-slate-500">No roles available yet.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((role) => (
        <label
          key={role.id}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200"
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-teal-500"
            checked={selected.includes(role.name)}
            onChange={() => onToggle(role.name)}
          />
          {role.name}
        </label>
      ))}
    </div>
  );
}




