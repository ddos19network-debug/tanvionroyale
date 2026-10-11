'use client';
import Link from 'next/link';
import { Skeleton } from '@tanvion-royale/ui';

export function EmptyState({ title, hint, actionHref, actionLabel }: { title: string; hint?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-600 bg-ink-900 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {actionHref ? (
        <Link href={actionHref} className="mt-3 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {actionLabel ?? 'Explore'}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-red-500/40 px-3 py-1 text-xs font-medium hover:bg-red-500/20">
        Try Again
      </button>
    </div>
  );
}

export function LoadMore({ visible, loading, onLoad }: { visible: boolean; loading: boolean; onLoad: () => void }) {
  if (!visible) return null;
  return (
    <div className="mt-4 text-center">
      <button type="button" onClick={onLoad} disabled={loading} className="rounded-md border border-ink-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 disabled:opacity-60">
        {loading ? 'Loading…' : 'Load More'}
      </button>
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="mt-4 space-y-2">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}

export function SearchBar({ search, onSearch, onApply, label, placeholder }: { search: string; onSearch: (v: string) => void; onApply: () => void; label: string; placeholder: string }) {
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <input
        aria-label={label}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
        placeholder={placeholder}
        className="w-full rounded-md border border-ink-600 px-3 py-2 text-sm"
      />
      <button type="button" onClick={onApply} className="shrink-0 rounded-md border border-ink-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">
        Search
      </button>
    </div>
  );
}
