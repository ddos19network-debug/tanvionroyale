/**
 * Effective staff permission calculation shared by request authentication and
 * the Admin management read models. Direct grants add to role permissions;
 * explicit direct denies always win. The calculation is intentionally pure so
 * it can be tested without a database and reused by every authorization path.
 */

export interface PermissionRoleRow {
  name: string;
  permissions?: Array<{ permission?: { name: string } | null } | { name: string }>;
}

export interface DirectPermissionRow {
  effect: 'GRANT' | 'DENY' | string;
  permission: { name: string };
}

function permissionName(
  permission: { permission?: { name: string } | null } | { name: string },
): string | null {
  if ('permission' in permission) return permission.permission?.name ?? null;
  return (permission as { name: string }).name;
}

export function calculateEffectivePermissions(
  roles: readonly PermissionRoleRow[] | undefined,
  directPermissions: readonly DirectPermissionRow[] | undefined,
): string[] {
  const granted = new Set<string>();
  const denied = new Set<string>();

  for (const role of roles ?? []) {
    for (const permission of role.permissions ?? []) {
      const name = permissionName(permission);
      if (name) granted.add(name);
    }
  }

  for (const assignment of directPermissions ?? []) {
    const name = assignment.permission?.name;
    if (!name) continue;
    if (String(assignment.effect).toUpperCase() === 'DENY') denied.add(name);
    else granted.add(name);
  }

  for (const name of denied) granted.delete(name);
  return [...granted].sort((a, b) => a.localeCompare(b));
}
