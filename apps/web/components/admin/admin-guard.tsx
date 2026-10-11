'use client';

/**
 * Admin route guard (Phase 3).
 *
 * Rendered by the /admin layout BEFORE any admin page content. Behavior:
 *  - unauthenticated  → redirect to the dedicated /admin/login page with a
 *                       validated `next` return path (no admin API calls);
 *                       /admin/login itself sits OUTSIDE this gate so there is
 *                       no redirect loop;
 *  - authenticated non-admin (403 from /api/v1/admin/access) → dedicated
 *                       403 page; admin data is never fetched or rendered;
 *  - admin            → render children inside the admin shell.
 *
 * The frontend guard is convenience only — the backend remains the final
 * authorization authority for every admin API call.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@tanvion-royale/ui';
import { sanitizeNextPath } from '@tanvion-royale/validation';
import { resolveAdminAccess, type AdminAccessState } from '@/lib/auth/admin-access';

/** Verified admin user + authoritative roles, shared with the shell via context (no refetch). */
const AdminUserContext = createContext<{
  username: string;
  label: string;
  roles: string[];
  permissions: string[];
  isMasterAdmin: boolean;
} | null>(null);

export function useVerifiedAdmin(): {
  username: string;
  label: string;
  roles: string[];
  permissions: string[];
  isMasterAdmin: boolean;
} | null {
  return useContext(AdminUserContext);
}

export function useAdminPermission(permission: string): boolean {
  const admin = useVerifiedAdmin();
  return !!admin && (admin.isMasterAdmin || admin.permissions.includes(permission));
}

export function useAdminAccess(): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    resolveAdminAccess()
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', message: 'Failed to verify your session. Please try again.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function AdminForbidden() {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <Card className="w-full max-w-md border-ink-600 bg-ink-900">
        <CardHeader>
          <CardTitle className="text-center text-red-300">403 — Access denied</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-slate-300">
            Your account does not have permission to view the TANVIONROYALE admin panel. If you believe
            this is a mistake, contact a SUPER_ADMIN.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push('/dashboard')}>
              Go to dashboard
            </Button>
            <Button variant="secondary" onClick={() => router.push('/')}>
              Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminAccessError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <Card className="w-full max-w-md border-ink-600 bg-ink-900">
        <CardHeader>
          <CardTitle className="text-center">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-slate-300" role="alert">
            {message}
          </p>
          <Button className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950" role="status" aria-label="Verifying access">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" aria-hidden />
        <p className="text-sm text-slate-400">Verifying your access…</p>
      </div>
    </div>
  );
}

/**
 * Resolves access once and renders children only for verified admins.
 */
export function AdminGate({
  children,
}: {
  children: (user: {
    username: string;
    label: string;
    roles: string[];
    permissions: string[];
    isMasterAdmin: boolean;
  }) => ReactNode;
}) {
  const state = useAdminAccess();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'unauthenticated') {
      const next = sanitizeNextPath(pathname, '/admin');
      router.replace(`/admin/login?next=${encodeURIComponent(next)}`);
    }
  }, [state.status, pathname, router]);

  if (state.status === 'loading' || state.status === 'unauthenticated') return <AdminLoading />;
  if (state.status === 'forbidden') return <AdminForbidden />;
  if (state.status === 'error') {
    return <AdminAccessError message={state.message} onRetry={() => window.location.reload()} />;
  }

  const user = state.user;
  const info = {
    username: user.username,
    label: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
    roles: state.roles,
    permissions: state.permissions,
    isMasterAdmin: state.isMasterAdmin,
  };
  return <AdminUserContext.Provider value={info}>{children(info)}</AdminUserContext.Provider>;
}
