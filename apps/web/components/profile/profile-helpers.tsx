'use client';

export const PAGE_SIZE = 20;
export const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300',
  PROCESSING: 'bg-amber-500/15 text-amber-300',
  ACCEPTED: 'bg-emerald-500/15 text-emerald-300',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  SETTLED: 'bg-ink-700 text-slate-300',
  WIN: 'bg-emerald-500/15 text-emerald-300',
  WON: 'bg-emerald-500/15 text-emerald-300',
  CASHED_OUT: 'bg-emerald-500/15 text-emerald-300',
  LOSS: 'bg-red-500/15 text-red-300',
  LOST: 'bg-red-500/15 text-red-300',
  FAILED: 'bg-red-500/15 text-red-300',
  REJECTED: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-ink-700 text-slate-500',
  VOID: 'bg-ink-700 text-slate-500',
};

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, today)) return `Today, ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function copyText(value: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[value] ?? 'bg-ink-700 text-slate-300'}`}>
      {value}
    </span>
  );
}
