'use client';

/**
 * My problem reports (/support/reports).
 *
 * Lists every "Report a Problem" case the authenticated user has submitted
 * (GET /support/reports), newest first, with its status and a "New reply" badge
 * when support has answered (ticket.userUnreadCount > 0). Opening a row goes to
 * /support/reports/:id — the case thread where the admin feedback is read.
 *
 * The server scopes the list to the JWT user, so this page can only ever show
 * the caller's own reports.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  listMyReports,
  type SupportReportListItem,
  type SupportReportStatusFilter,
} from '@/lib/api/support';
import { ApiClientError } from '@/lib/api/client';
import { useAuth } from '@/src/lib/auth';
import {
  ReportStatusChip,
  formatReportDate,
  statusLabel,
} from '@/components/support/support-report-ui';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: SupportReportStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_FOR_USER', label: 'Waiting for you' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

function preview(item: SupportReportListItem): string {
  const body = item.firstMessage?.body?.replace(/\s+/g, ' ').trim();
  if (!body) return 'No description';
  return body.length > 140 ? `${body.slice(0, 140)}…` : body;
}

export default function MyReportsPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  const [items, setItems] = useState<SupportReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<SupportReportStatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (filter: SupportReportStatusFilter, nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listMyReports({
          status: filter,
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setItems((prev) =>
          nextPage === 0 ? result.items : [...prev, ...result.items],
        );
        setTotal(result.total);
        setPage(nextPage);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Your reports are temporarily unavailable. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    void load(statusFilter, 0);
  }, [ready, isAuthenticated, statusFilter, load, router]);

  const hasMore = items.length < total;

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Support
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              My problem reports
            </h1>
            <Link
              href="/support/report"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
            >
              Report a Problem
            </Link>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Every problem you reported, with its status and any reply from the
            support team.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                statusFilter === option.value
                  ? 'bg-brand text-ink-950'
                  : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500">
            {total} report{total === 1 ? '' : 's'}
          </span>
        </div>

        {error ? (
          <div
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-300"
            role="alert"
          >
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load(statusFilter, 0)}
              className="rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-1.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <p
            className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center text-sm text-slate-400"
            role="status"
          >
            Loading your reports…
          </p>
        ) : null}

        {!loading && items.length === 0 && !error ? (
          <div className="rounded-2xl border border-white/10 bg-ink-800 p-8 text-center">
            <p className="text-sm font-semibold text-slate-200">
              You haven&apos;t reported any problems yet.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Found something broken? Send us the details and a screenshot.
            </p>
            <Link
              href="/support/report"
              className="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
            >
              Report a Problem
            </Link>
          </div>
        ) : null}

        {items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/support/reports/${item.id}`}
                  className="block rounded-2xl border border-white/10 bg-ink-800 p-4 transition hover:border-brand/40 hover:bg-ink-700/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ReportStatusChip status={item.status} />
                    {item.category ? (
                      <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold text-teal-300">
                        {item.category}
                      </span>
                    ) : null}
                    {item.userUnreadCount > 0 ? (
                      <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-300">
                        New reply
                      </span>
                    ) : null}
                    {item.firstMessage?.attachmentDataUrl ? (
                      <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        Screenshot
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-slate-500">
                      {formatReportDate(item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">{preview(item)}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Opened {formatReportDate(item.createdAt)} ·{' '}
                    {statusLabel(item.status)} · report {item.id.slice(0, 8)}
                    {item.category ? ` · ${item.category}` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {hasMore ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(statusFilter, page + 1)}
            className="mt-4 w-full rounded-xl border border-ink-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more reports'}
          </button>
        ) : null}
      </div>
    </main>
  );
}
