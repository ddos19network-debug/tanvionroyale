'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { useAppBack } from '@/lib/back-navigation';
import { StatusBadge } from '@/components/profile/profile-helpers';
import { useAuth } from '@/src/lib/auth';
import { getMe, updateProfile, validateUsername } from '@/lib/api/users';
import { getProfileSummary, type ProfileSummary } from '@/lib/api/profile';
import { ApiClientError } from '@/lib/api/client';
import type { PublicUser } from '@tanvion-royale/types';
import { OverviewTab, CasinoTab } from '@/components/profile/profile-overview';
import { BettingTab } from '@/components/profile/profile-betting';
import { BetSlipTab } from '@/components/profile/profile-betslip';
import { GamesTab } from '@/components/profile/profile-games';
import { DepositsTab, WithdrawalsTab } from '@/components/profile/profile-money';
import { WalletTab } from '@/components/profile/profile-wallet';
import { ActivityTab } from '@/components/profile/profile-activity';
import { ReferralPanel } from '@/components/profile/profile-referral';
import { BET_SLIP_ENABLED } from '@/config/features';

type TabKey = 'overview' | 'betslip' | 'betting' | 'games' | 'casino' | 'deposits' | 'withdrawals' | 'wallet' | 'activity' | 'referral';

/**
 * Profile tab list. The "Bet Slip" tab is hidden while the user-facing Bet Slip
 * is temporarily disabled (config/features.ts) so no empty/broken slip panel
 * can be reached. The `'betslip'` tab key, the BetSlipTab component and the
 * backend bet history (the "Betting" tab, /my-bets) all stay intact — flipping
 * BET_SLIP_ENABLED back to true restores the tab exactly as it was.
 */
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  ...(BET_SLIP_ENABLED ? [{ key: 'betslip' as const, label: 'Bet Slip' }] : []),
  { key: 'betting', label: 'Betting' },
  { key: 'games', label: 'Games' },
  { key: 'casino', label: 'Casino' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'activity', label: 'Activity' },
  { key: 'referral', label: 'Referral' },
];

export default function ProfilePage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [editing, setEditingRaw] = useState(false);
  // Opening the editor clears any stale success/error notice from a previous
  // attempt (Part 18) so the form never opens pre-populated with old results.
  const setEditing: ProfileContentProps['setEditing'] = (v) => {
    const next = typeof v === 'function' ? v(editing) : v;
    if (next) {
      setFormMessage(null);
      setFormError(null);
    }
    setEditingRaw(next);
  };
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const me = await getMe();
      setUser(me);
      setUsername(me.username);
      setFirstName(me.firstName ?? '');
      setLastName(me.lastName ?? '');
      setCountry(me.country ?? '');
      setPhone(me.phone ?? '');
    } catch (err) {
      // A DEFINITIVE auth rejection redirects; a transient backend failure
      // (cold start, gateway error) must never bounce an authenticated user
      // back to /login.
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        router.replace('/login');
        return;
      }
      setFormError('Could not load your profile. The server may be starting up — try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [router]);
  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await getProfileSummary());
    } catch (err) {
      setSummaryError(err instanceof ApiClientError ? err.message : 'Unable to load account summary.');
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    void loadProfile();
    void loadSummary();
  }, [ready, isAuthenticated, router, loadProfile, loadSummary]);
  const displayName = useMemo(() => {
    if (!user) return '';
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return full || user.username;
  }, [user]);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Double-submit guard (Part 35).
    if (saving) return;
    setFormMessage(null);
    setFormError(null);
    const tu = username.trim();
    if (user && tu && tu !== user.username) {
      const ve = validateUsername(tu);
      if (ve) {
        setFormError(ve);
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (user && tu && tu !== user.username) payload.username = tu;
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      if (country.trim()) payload.country = country.trim().toUpperCase();
      if (phone.trim()) payload.phone = phone.trim();
      const updated = await updateProfile(payload);
      // SUCCESS: rehydrate ALL editable fields from the server response so the
      // read-only card and any reopened editor can never show stale values.
      setUser(updated);
      setUsername(updated.username);
      setFirstName(updated.firstName ?? '');
      setLastName(updated.lastName ?? '');
      setCountry(updated.country ?? '');
      setPhone(updated.phone ?? '');
      // Close the editor (category: modal/inline action) — the visible success
      // message is rendered OUTSIDE the conditional form so it does not
      // unmount with it (it was previously invisible on success).
      setFormMessage('Profile updated.');
      setEditing(false);
    } catch (err) {
      // FAILURE: editor stays open, error rendered next to the fields, every
      // entered value preserved.
      setFormError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }
  return <ProfileShell user={user} loading={loading} tab={tab} setTab={setTab} displayName={displayName} summary={summary} summaryError={summaryError} loadSummary={loadSummary} editing={editing} setEditing={setEditing} username={username} setUsername={setUsername} firstName={firstName} setFirstName={setFirstName} lastName={lastName} setLastName={setLastName} country={country} setCountry={setCountry} phone={phone} setPhone={setPhone} saving={saving} formMessage={formMessage} formError={formError} onSubmit={onSubmit} />;
}

function ProfileShell(props: ProfileContentProps & { loading: boolean }) {
  const { loading, ...rest } = props;
  const { handleBack } = useAppBack();
  return (
    <>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-28 sm:pb-16">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => handleBack({ fallback: '/dashboard' })} className="rounded-md border border-ink-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/5" aria-label="Go back">
            ← Back
          </button>
          <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span aria-hidden> / </span>
            <span aria-current="page" className="text-slate-300">Profile</span>
          </nav>
        </div>
        {loading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        ) : rest.user ? (
          <ProfileContent {...rest} />
        ) : null}
      </main>
    </>
  );
}

interface ProfileContentProps {
  user: PublicUser | null;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  displayName: string;
  summary: ProfileSummary | null;
  summaryError: string | null;
  loadSummary: () => void;
  editing: boolean;
  setEditing: (v: boolean | ((p: boolean) => boolean)) => void;
  username: string;
  setUsername: (v: string) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  country: string;
  setCountry: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  saving: boolean;
  formMessage: string | null;
  formError: string | null;
  onSubmit: (e: FormEvent) => void;
}

function ProfileContent(props: ProfileContentProps) {
  const { user, tab, setTab, displayName } = props;
  if (!user) return null;
  return (
    <div className="mt-4 space-y-4">
      <section aria-label="Profile header" className="overflow-hidden rounded-xl border border-ink-700 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950">
        <div className="h-20 bg-gradient-to-r from-teal-500/40 via-indigo-500/30 to-teal-500/20" aria-hidden />
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-indigo-500 text-3xl font-extrabold text-white ring-4 ring-ink-900" aria-hidden>
            {(displayName || 'T').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold text-white sm:text-2xl">{displayName}</h1>
            <p className="truncate text-sm text-slate-400">@{user.username}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-medium text-teal-300">{user.status}</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300">KYC: {user.kycStatus}</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => props.setEditing((v: boolean) => !v)} className="w-full border-white/20 text-white hover:bg-white/10 sm:w-auto">
            {props.editing ? 'Close Editor' : 'Edit Profile'}
          </Button>
        </div>
      </section>
      <ProfileInfoCard {...props} user={user} />
      <div role="tablist" aria-label="Profile tabs" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${tab === t.key ? 'bg-ink-900 text-white' : 'bg-ink-700 text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <section role="tabpanel" aria-label={`${tab} panel`}>
        {tab === 'overview' ? <OverviewTab summary={props.summary} error={props.summaryError} onRetry={props.loadSummary} /> : null}
        {BET_SLIP_ENABLED && tab === 'betslip' ? <BetSlipTab /> : null}
        {tab === 'betting' ? <BettingTab /> : null}
        {tab === 'games' ? <GamesTab /> : null}
        {tab === 'casino' ? <CasinoTab /> : null}
        {tab === 'deposits' ? <DepositsTab /> : null}
        {tab === 'withdrawals' ? <WithdrawalsTab /> : null}
        {tab === 'wallet' ? <WalletTab /> : null}
        {tab === 'activity' ? <ActivityTab /> : null}
        {tab === 'referral' ? <ReferralPanel /> : null}
      </section>
    </div>
  );
}

function ProfileInfoCard(props: ProfileContentProps & { user: PublicUser }) {
  const { user } = props;
  return (
    <Card>
      <CardHeader><CardTitle>Profile information</CardTitle></CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Username</dt><dd className="font-medium break-anywhere">@{user.username}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Display name</dt><dd className="font-medium">{props.displayName}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt><dd className="font-medium break-anywhere">{user.email || '—'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Phone</dt><dd className="font-medium">{user.phone || '—'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Country</dt><dd className="font-medium">{user.country || '—'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Account status</dt><dd><StatusBadge value={user.status} /></dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">KYC status</dt><dd><StatusBadge value={user.kycStatus} /></dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-500">Member since</dt><dd className="font-medium">{new Date(user.createdAt).toLocaleString()}</dd></div>
        </dl>
        {/* Success message lives OUTSIDE the conditional editor so it stays
            visible after the form unmounts on success (Part 12 / 42-F). */}
        {props.formMessage && !props.editing && (
          <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300" role="status">
            {props.formMessage}
          </p>
        )}
        {props.editing ? (
          <form onSubmit={props.onSubmit} className="mt-4 grid gap-4 border-t border-white/10 pt-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">Username
              <input value={props.username} onChange={(e) => props.setUsername(e.target.value)} minLength={3} maxLength={32} className="rounded-md border border-ink-600 px-3 py-2" />
              <span className="text-xs text-slate-500">3-32 chars, letters/numbers/underscores, unique.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">First name
              <input value={props.firstName} onChange={(e) => props.setFirstName(e.target.value)} className="rounded-md border border-ink-600 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Last name
              <input value={props.lastName} onChange={(e) => props.setLastName(e.target.value)} className="rounded-md border border-ink-600 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Country
              <input value={props.country} maxLength={2} onChange={(e) => props.setCountry(e.target.value.toUpperCase())} placeholder="GB" className="rounded-md border border-ink-600 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">Phone
              <input value={props.phone} onChange={(e) => props.setPhone(e.target.value)} className="rounded-md border border-ink-600 px-3 py-2" />
            </label>
            <div className="md:col-span-2">
              {props.formError && <p className="text-sm text-red-400" role="alert">{props.formError}</p>}
              <Button type="submit" loading={props.saving} className="mt-2 self-start">Save changes</Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}


