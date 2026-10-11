import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/layout/app-header';
import { AppFooter } from '@/components/layout/app-footer';

/**
 * Shared layout and typography for the public legal pages (/privacy, /terms).
 * Purely presentational and server-rendered: no API calls, no authentication,
 * no database access — legal pages must render even if the backend is offline.
 * Reuses the public site chrome (AppHeader / AppFooter) and the existing
 * brand/ink Tailwind palette so the pages match the rest of the platform.
 */

/** Top-level legal section with consistent heading scale and separators. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-white/10 pt-6">
      <h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-300 sm:text-base">{children}</div>
    </section>
  );
}

/** Sub-block inside a section (e.g. one data category on the privacy page). */
export function LegalSub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white sm:text-base">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300 sm:text-base">{children}</div>
    </div>
  );
}

/** Disc list with brand-coloured markers for legal bullet points. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-brand/70">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Internal link styled for legal copy. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}

/** Shared props for the legal page shell and its chrome-free document body. */
export interface LegalPageProps {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
  /** Small uppercase label above the title ('Legal' by default). */
  eyebrow?: string;
}

/**
 * Document body only: the legal card WITHOUT the public header/footer chrome.
 *
 * Used by legal-style pages that live inside the `(user)` route group (e.g.
 * /support), where <AppHeader /> is already rendered once by
 * app/(user)/layout.tsx — rendering the chrome twice would draw a second fixed
 * header and break the top navigation.
 */
export function LegalArticle({
  title,
  updated,
  intro,
  children,
  eyebrow = 'Legal',
}: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:pb-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-ink-900/60 p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">{title}</h1>
        <p className="mt-2 text-xs text-slate-400 sm:text-sm">Last updated: {updated}</p>
        <div className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">{intro}</div>
        {children}
      </article>
    </main>
  );
}

/**
 * Full PUBLIC page shell: public header + document card + public footer.
 *
 * Used only by routes outside the user-panel route group (/privacy, /terms),
 * which have no shared layout providing the top navigation.
 */
export function LegalDocument(props: LegalPageProps) {
  return (
    <>
      <AppHeader />
      <LegalArticle {...props} />
      <AppFooter />
    </>
  );
}