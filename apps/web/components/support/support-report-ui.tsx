import type { SupportTicketStatus } from '@/lib/api/support';

/** Human-readable labels — same wording as Live Chat STATUS_LABELS. */
export function statusLabel(status: SupportTicketStatus | string): string {
  switch (status) {
    case 'OPEN':
      return 'Open';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'WAITING_FOR_USER':
      return 'Waiting for your reply';
    case 'RESOLVED':
      return 'Resolved';
    case 'CLOSED':
      return 'Closed';
    default:
      return String(status).replace(/_/g, ' ').toLowerCase();
  }
}

const CHIP_STYLES: Record<string, string> = {
  OPEN: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  WAITING_FOR_USER: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  RESOLVED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CLOSED: 'bg-ink-700 text-slate-400 border-ink-600',
};

export function ReportStatusChip({ status }: { status: SupportTicketStatus | string }) {
  const style = CHIP_STYLES[String(status)] ?? CHIP_STYLES.CLOSED;
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function formatReportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const today = new Date();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return 'Today';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
