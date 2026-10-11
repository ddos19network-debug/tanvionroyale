'use client';

/** Status badges, page headers with breadcrumbs, stat cards, formatters. */
import Link from 'next/link';
import type { ReactNode } from 'react';

const TONE_CLASSES: Record<string, string> = {
  green: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300',
  red: 'border-red-500/40 bg-red-950/50 text-red-300',
  amber: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
  blue: 'border-sky-500/40 bg-sky-950/50 text-sky-300',
  slate: 'border-ink-600 bg-ink-800 text-slate-300',
  teal: 'border-teal-500/40 bg-teal-950/50 text-teal-300',
};

const STATUS_TONES: Record<string, keyof typeof TONE_CLASSES> = {
  // users
  ACTIVE: 'green',
  PENDING: 'amber',
  SUSPENDED: 'red',
  BANNED: 'red',
  LOCKED: 'red',
  CLOSED: 'slate',
  VERIFIED: 'green',
  NOT_STARTED: 'slate',
  REJECTED: 'red',
  EXPIRED: 'slate',
  MANUAL_REVIEW: 'amber',
  // events
  LIVE: 'red',
  SCHEDULED: 'blue',
  FINISHED: 'slate',
  CANCELLED: 'slate',
  // bets
  ACCEPTED: 'green',
  SETTLED: 'teal',
  VOID: 'slate',
  // wallets/transactions
  COMPLETED: 'green',
  FAILED: 'red',
  PROCESSING: 'amber',
  REVERSED: 'slate',
  // providers/catalog
  INACTIVE: 'slate',
  OK: 'green',
  ERROR: 'red',
  SYNCING: 'amber',
  IDLE: 'slate',
  // results
  WIN: 'green',
  LOSS: 'red',
  PUSH: 'slate',
};

export function AdminStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-slate-500">—</span>;
  const tone = STATUS_TONES[value] ?? 'slate';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function AdminPageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: string;
  crumbs: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>/</span>}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-teal-300 hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-slate-400">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function AdminStatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-red-300'
          : 'text-white';
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Minor units (e.g. poisha for BDT) → "1,234.56 BDT". */
export function formatMinor(amount: number, currency = 'BDT'): string {
  const sign = amount < 0 ? '-' : '';
  const major = Math.abs(amount) / 100;
  return `${sign}${major.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
