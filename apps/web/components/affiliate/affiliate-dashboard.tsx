'use client';

/**
 * "Affiliate With Us" / the affiliate page.
 *
 * TWO STATES, ONE ROUTE
 *   `GET /me/affiliate/dashboard` decides which one renders, from the
 *   `AffiliateProfile` the server read — never from anything the browser claims:
 *
 *     INACTIVE (or never activated) -> the "Become a TANVIONROYALE Affiliate"
 *       application card. The server returns `referralCode: null`,
 *       `referralLink: null`, `stats: null`, `target: null` and `content: []`,
 *       so there is no link, no code, no statistic and no affiliate content to
 *       render even accidentally. A user with a referral code who has NOT
 *       activated is exactly this case, and their normal referral functionality
 *       elsewhere in the app is untouched.
 *
 *     ACTIVE -> admin-configured content FIRST, then the personal dashboard
 *       LAST. The personal sections (link, code, stats, earnings, referred
 *       users, transactions, monthly target) are not content blocks: no admin
 *       can remove or reorder them away.
 *
 * EXISTING DESIGN SYSTEM ONLY. It reuses the same Card / Button / Skeleton /
 * StatusBadge / typography / spacing vocabulary as the profile referral panel
 * and the rest of the user panel. No new palette, no new component library, and
 * the shared top navigation and left sidebar are untouched.
 *
 * RESPONSIVE BY CONSTRUCTION
 *   The stat grid is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`, the share
 *   row stacks on narrow screens, the activation form is a single column that
 *   widens to two, and the tables live in `overflow-x-auto` wrappers.
 *   Mobile / tablet / desktop all work with no JS measurement and no
 *   horizontal overflow.
 *
 * EVERY NUMBER IS SERVER-SUPPLIED. This component derives no money, invents no
 * referral count and never posts an amount or a status. It only renders what
 * `GET /me/affiliate/*` returned. In particular the monthly target shows
 * "No monthly target set" when the server says `targetValue === null`, so an
 * unconfigured target is never displayed as an intentional zero.
 *
 * PAGINATION: the referred users and the transaction history are fetched
 * SEPARATELY, one page at a time, so the page never loads every row.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import {
  AFFILIATE_PROMOTION_METHODS,
  activateAffiliate,
  deactivateAffiliate,
  formatMinor,
  getAffiliateDashboard,
  getAffiliateReferrals,
  getAffiliateTransactions,
  type AffiliateContentBlock,
  type AffiliateDashboard,
  type AffiliatePromotionMethod,
  type AffiliateReferredUser,
  type AffiliateTransaction,
} from '@/lib/api/affiliate';
import { describeApiError } from '@/lib/api/client';
import { copyText, fmtDate, StatusBadge } from '@/components/profile/profile-helpers';

const inputClass =
  'w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-brand/60 focus:outline-none';
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-slate-400';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-100">{value}</p>
      {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Renders ONE admin-configured content block.
 *
 * SECURITY: `title`/`subtitle`/`body` are rendered as TEXT, and every
 * FAQ/HOW_IT_WORKS item is split on the server. An image or CTA URL is only
 * rendered when the server accepted it (https:// or a site-relative path), so
 * a stored `javascript:`/`data:` value can never reach an href or src.
 */
function ContentBlock({ block }: { block: AffiliateContentBlock }) {
  const items = block.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{block.title ?? ''}</CardTitle>
        {block.subtitle ? (
          <p className="text-sm text-slate-400">{block.subtitle}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {block.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.imageUrl}
            alt={block.title ?? 'Affiliate promotion'}
            className="w-full rounded-lg border border-white/5 object-cover"
            loading="lazy"
          />
        ) : null}

        {block.body
          ? block.body.split('\n').filter(Boolean).map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed text-slate-300">
                {paragraph}
              </p>
            ))
          : null}

        {block.type === 'FAQ'
          ? items.map((item, index) => {
              const [question, answer] = item.split('|');
              return (
                <details key={index} className="rounded-md border border-white/5 bg-ink-800/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-200">
                    {question}
                  </summary>
                  <p className="mt-2 text-sm text-slate-400">{answer ?? ''}</p>
                </details>
              );
            })
          : null}

        {block.type !== 'FAQ' && items.length > 0
          ? items.map((item, index) => {
              // "Heading\nBody" pairs render as a titled step; a bare line as a bullet.
              const [head, ...rest] = item.split('\n');
              return (
                <div key={index} className="rounded-md border border-white/5 bg-ink-800/40 p-3">
                  <p className="text-sm font-semibold text-slate-200">{head}</p>
                  {rest.length > 0 ? (
                    <p className="mt-1 text-sm text-slate-400">{rest.join(' ')}</p>
                  ) : null}
                </div>
              );
            })
          : null}

        {block.ctaText && block.ctaUrl ? (
          <a
            href={block.ctaUrl}
            className="inline-flex w-fit items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-950 hover:opacity-90"
          >
            {block.ctaText}
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The "Become a TANVIONROYALE Affiliate" application card.
 *
 * Shown ONLY when the server reports an inactive affiliate. It deliberately
 * renders no link, no code and no statistic: the payload for this state has
 * none to render.
 *
 * The form collects the marketing details an admin actually needs in order to
 * review an application, prefilled from the existing account so nothing is
 * typed twice. It asks for NO password, NO card information and NO identity
 * document - the platform already has the account, and an activation must
 * never imply a payment.
 */
function AffiliateActivationCard({
  data,
  reload,
}: {
  data: AffiliateDashboard;
  reload: () => Promise<void>;
}) {
  const { activation } = data;
  const [form, setForm] = useState({
    fullName: activation.prefill.fullName ?? '',
    email: activation.prefill.email ?? '',
    phone: activation.prefill.phone ?? '',
    promotionMethod: 'SOCIAL_MEDIA' as AffiliatePromotionMethod,
    promotionUrl: '',
    description: '',
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (form.fullName.trim().length < 2) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!acceptTerms) {
      setFormError('You must accept the affiliate agreement to continue.');
      return;
    }

    setBusy(true);
    try {
      await activateAffiliate({
        fullName: form.fullName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        promotionMethod: form.promotionMethod,
        promotionUrl: form.promotionUrl.trim() || undefined,
        description: form.description.trim() || undefined,
        acceptTerms: true,
      });
      // Re-read the dashboard: the server is the only authority on the new
      // state, and only it knows the code and link that now exist.
      await reload();
    } catch (err) {
      setFormError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Become a TANVIONROYALE Affiliate</CardTitle>
        <p className="text-sm text-slate-400">
          Activate your affiliate account to get your personal affiliate link, track referrals
          and earn rewards.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Full name
              <input
                className={inputClass}
                required
                maxLength={120}
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Your full name"
              />
            </label>
            <label className={labelClass}>
              Email
              <input
                className={inputClass}
                type="email"
                maxLength={160}
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
              />
            </label>
            <label className={labelClass}>
              Phone
              <input
                className={inputClass}
                type="tel"
                maxLength={32}
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <label className={labelClass}>
              Promotion method
              <select
                className={inputClass}
                value={form.promotionMethod}
                onChange={(e) =>
                  setForm({ ...form, promotionMethod: e.target.value as AffiliatePromotionMethod })
                }
              >
                {AFFILIATE_PROMOTION_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={labelClass}>
            Promotion profile / website / channel URL (optional)
            <input
              className={inputClass}
              inputMode="url"
              maxLength={500}
              value={form.promotionUrl}
              onChange={(e) => setForm({ ...form, promotionUrl: e.target.value })}
              placeholder="https://... or /your-page"
            />
          </label>

          <label className={labelClass}>
            How will you promote TANVIONROYALE?
            <textarea
              className={inputClass}
              rows={3}
              maxLength={1000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Tell us about your audience and how you plan to share the platform."
            />
          </label>

          <label className="flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
            />
            <span>
              I accept the TANVIONROYALE affiliate agreement and confirm I will promote the
              platform honestly.
            </span>
          </label>

          {formError ? (
            <p role="alert" className="text-sm text-red-400">
              {formError}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={busy || !data.activation.canActivate}>
              {busy ? 'Activating...' : 'Activate affiliate account'}
            </Button>
          </div>

          {!data.activation.canActivate ? (
            <p className="text-xs text-amber-300">
              The affiliate program is currently closed. Please check back later.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

/** Page size for the two personal tables: one page at a time, never every row. */
const PAGE_SIZE = 10;

export function AffiliateDashboard() {
  const [data, setData] = useState<AffiliateDashboard | null>(null);
  const [referrals, setReferrals] = useState<AffiliateReferredUser[]>([]);
  const [referralTotal, setReferralTotal] = useState(0);
  const [referralPage, setReferralPage] = useState(1);
  const [transactions, setTransactions] = useState<AffiliateTransaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionPage, setTransactionPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAffiliateDashboard());
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The personal tables are fetched INDEPENDENTLY and PAGINATED, and only once
  // the caller is an active affiliate: an inactive user has no personal data to
  // list, so the request is never even made.
  const isActive = data?.affiliateStatus === 'ACTIVE';

  useEffect(() => {
    if (!isActive) return;
    void (async () => {
      try {
        const res = await getAffiliateReferrals(referralPage, PAGE_SIZE);
        setReferrals(res.items);
        setReferralTotal(res.total);
      } catch (err) {
        setError(describeApiError(err));
      }
    })();
  }, [isActive, referralPage]);

  useEffect(() => {
    if (!isActive) return;
    void (async () => {
      try {
        const res = await getAffiliateTransactions(transactionPage, PAGE_SIZE);
        setTransactions(res.items);
        setTransactionTotal(res.total);
      } catch (err) {
        setError(describeApiError(err));
      }
    })();
  }, [isActive, transactionPage]);

  async function copy(value: string, which: 'code' | 'link') {
    await copyText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  async function share(link: string) {
    const text = `${link}\n\nJoin me on TANVIONROYALE.`;
    // Prefer the native share sheet on mobile; fall back to the clipboard.
    const nav = navigator as Navigator & {
      share?: (payload: { title: string; text: string; url: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'TANVIONROYALE', text, url: link });
        return;
      } catch {
        // The user dismissed the sheet - fall through to copying.
      }
    }
    await copy(link, 'link');
  }

  async function onDeactivate() {
    setError(null);
    setBusy(true);
    try {
      await deactivateAffiliate();
      setReferrals([]);
      setTransactions([]);
      setReferralPage(1);
      setTransactionPage(1);
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card>
        <CardContent>
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // -----------------------------------------------------------------------
  // NOT AN AFFILIATE: the activation card only. No link, no code, no stats,
  // no admin content - the payload for this state contains none of those.
  // -----------------------------------------------------------------------
  if (data.affiliateStatus !== 'ACTIVE') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-100">Affiliate With Us</h1>
          <p className="text-sm text-slate-400">
            Promote TANVIONROYALE and earn on every qualified referral.
          </p>
        </header>
        {error ? <ErrorBanner message={error} /> : null}
        <AffiliateActivationCard data={data} reload={load} />
        {data.activation.deactivatedAt ? (
          <p className="text-xs text-slate-500">
            Your affiliate account was deactivated on {fmtDate(data.activation.deactivatedAt)}.
            Activate again to restore it.
          </p>
        ) : null}
      </div>
    );
  }

  const { stats, target, referralLink, referralCode, content } = data;
  const money = (amount: number) => formatMinor(amount, data.currency);
  const referralPages = Math.max(1, Math.ceil(referralTotal / PAGE_SIZE));
  const transactionPages = Math.max(1, Math.ceil(transactionTotal / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Affiliate With Us</h1>
        <p className="text-sm text-slate-400">
          Share your link, bring friends to TANVIONROYALE and earn on every qualified referral.
        </p>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      {/* =================================================================
          1. ADMIN-CONFIGURABLE CONTENT - always FIRST, in the server's order.
          Content only: an admin may add, edit, disable, reorder or remove
          these, and none of that affects the personal data below.

          THE SERVER HAS ALREADY RESOLVED THE SCOPE. `content` is the
          deterministic concatenation of
            (a) the enabled GLOBAL blocks, in their own global order, then
            (b) the enabled INDIVIDUAL blocks belonging ONLY to the signed-in
                affiliate, in their own independent order.
          The browser is never told which affiliate's content it is looking at
          and never chooses: another affiliate's content is unreachable here
          because the server keyed the second query on the authenticated id.
          ================================================================= */}
      {content.map((block) => (
        <ContentBlock key={block.id} block={block} />
      ))}

      {/* =================================================================
          2. PERSONAL AFFILIATE DASHBOARD - always LAST and never removable.
          An admin can hide everything above; these sections are not content
          blocks and always exist for an active affiliate.
          ================================================================= */}
      <h2 className="pt-2 text-lg font-semibold text-slate-200">My affiliate dashboard</h2>

      {/* A. Affiliate link */}
      {referralLink ? (
        <Card>
          <CardHeader>
            <CardTitle>Your affiliate link</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-200">
                {referralLink}
              </code>
              <div className="flex shrink-0 gap-2">
                <Button type="button" onClick={() => copy(referralLink, 'link')}>
                  {copied === 'link' ? 'Copied' : 'Copy link'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void share(referralLink)}>
                  Share
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* B. Affiliate code */}
      {referralCode ? (
        <Card>
          <CardHeader>
            <CardTitle>Your affiliate code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-200">
                {referralCode}
              </code>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => copy(referralCode, 'code')}
              >
                {copied === 'code' ? 'Copied' : 'Copy code'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* C. Summary stats */}
      {stats ? (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="My users" value={String(stats.totalReferredUsers)} />
              <Stat label="Active users" value={String(stats.activeReferredUsers)} />
              <Stat label="Pending users" value={String(stats.pendingReferredUsers)} />
              <Stat label="Total clicks" value={String(stats.totalClicks)} />
              <Stat label="Qualified" value={String(stats.qualifiedReferrals)} />
              <Stat
                label="Conversion"
                value={stats.conversionRate === null ? '-' : `${stats.conversionRate}%`}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* D. Earnings */}
      {stats ? (
        <Card>
          <CardHeader>
            <CardTitle>Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total earned" value={money(stats.totalIncome)} />
              <Stat label="Pending" value={money(stats.pendingIncome)} />
              <Stat label="Paid" value={money(stats.paidIncome)} />
              <Stat label="Rejected" value={money(stats.rejectedIncome)} />
              <Stat label="This month" value={money(stats.currentMonthIncome)} />
              <Stat label="Last month" value={money(stats.previousMonthIncome)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* E. My referred users */}
      <Card>
        <CardHeader>
          <CardTitle>My referred users</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {referrals.length === 0 ? (
            <p className="text-sm text-slate-500">No referred users yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3 font-semibold">User</th>
                      <th className="py-2 pr-3 font-semibold">Joined</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold">Bonus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((row) => (
                      <tr key={row.referralId} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="text-slate-200">{row.username}</span>
                          {row.maskedEmail ? (
                            <span className="ml-2 text-xs text-slate-500">{row.maskedEmail}</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-400">{fmtDate(row.joinedAt)}</td>
                        <td className="py-2 pr-3">
                          <StatusBadge value={row.status} />
                        </td>
                        <td className="py-2 text-slate-200">{money(row.bonusEarned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={referralPage} pages={referralPages} onChange={setReferralPage} />
            </>
          )}
        </CardContent>
      </Card>

      {/* F. Earnings history */}
      <Card>
        <CardHeader>
          <CardTitle>Earnings history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3 font-semibold">User</th>
                      <th className="py-2 pr-3 font-semibold">Type</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 pr-3 font-semibold">Amount</th>
                      <th className="py-2 pr-3 font-semibold">Date</th>
                      <th className="py-2 font-semibold">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((row) => (
                      <tr key={row.id} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-3 text-slate-200">{row.username ?? '-'}</td>
                        <td className="py-2 pr-3 text-xs text-slate-400">
                          {row.recipient === 'REFERRER' ? 'Referrer' : 'New user'}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge value={row.status} />
                        </td>
                        <td className="py-2 pr-3 text-slate-200">{money(row.amount)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-400">{fmtDate(row.createdAt)}</td>
                        <td className="py-2 text-xs text-slate-400">
                          {row.paidAt ? fmtDate(row.paidAt) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={transactionPage}
                pages={transactionPages}
                onChange={setTransactionPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* G. Monthly target */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly target</CardTitle>
        </CardHeader>
        <CardContent>
          {target === null || target.targetValue === null ? (
            <p className="text-sm text-slate-500">No monthly target set</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-slate-300">
                  {target.actual} / {target.targetValue}{' '}
                  <span className="text-xs text-slate-500">
                    ({target.year}-{String(target.month).padStart(2, '0')})
                  </span>
                </span>
                <span className="text-sm font-semibold text-slate-100">
                  {target.percentage === null ? '-' : `${target.percentage}%`}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-ink-800"
                role="progressbar"
                aria-valuenow={target.percentage ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, target.percentage ?? 0)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {target.reached ? 'Target reached.' : `${target.remaining ?? 0} to go.`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void onDeactivate()}
        >
          Deactivate my affiliate account
        </Button>
      </div>
    </div>
  );
}

/** Previous/next controls, styled with the shared Button. */
function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-slate-500">
        Page {page} of {pages}
      </span>
      <Button
        type="button"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

/** The single inline error style used across the page. */
function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {message}
    </p>
  );
}
