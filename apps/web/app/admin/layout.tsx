import type { Metadata } from 'next';
import { AdminLayoutClient } from '@/components/admin/admin-shell';

export const metadata: Metadata = {
  title: 'TANVIONROYALE Admin',
  description: 'TANVIONROYALE administration panel.',
  // Never index the admin panel.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
