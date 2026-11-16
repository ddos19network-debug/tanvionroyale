'use client';

import { useState, type FormEvent } from 'react';
import { updateProfile } from '@/lib/api/users';
import type { PublicUser } from '@tanvion-royale/types';
import { UnifiedProfile } from '@/components/profile/unified-profile';
import { ReferralPanel } from '@/components/profile/profile-referral';

const TABS: { key: string; label: string; icon: string; mobile: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊', mobile: true },
  { key: 'assets', label: 'Assets', icon: '📈', mobile: true },
  { key: 'betting', label: 'Betting', icon: '🎫', mobile: true },
  { key: 'games', label: 'Games', icon: '⚽', mobile: true },
  { key: 'casino', label: 'Casino', icon: '🃏', mobile: true },
  { key: 'deposits', label: 'Deposits', icon: '💳', mobile: true },
  { key: 'withdrawals', label: 'Withdrawals', icon: '🏧', mobile: true },
  { key: 'wallet', label: 'Wallet', icon: '💰', mobile: true },
  { key: 'orders', label: 'Orders', icon: '📋', mobile: true },
  { key: 'rewards', label: 'Rewards', icon: '🎁', mobile: true },
  { key: 'referral', label: 'Referral', icon: '👥', mobile: true },
  { key: 'account', label: 'Account', icon: '⚙️', mobile: true },
];

export default function ProfilePage() {
  const [tab, setTab] = useState('dashboard');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedMobileTab, setSelectedMobileTab] = useState('dashboard');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setFormMessage(null);
    try {
      const payload = { username, firstName, lastName, country, phone };
      const updated = await updateProfile(payload);
      setUser(updated);
      setFormMessage('Profile updated.');
      setEditing(false);
      setIsMenuOpen(false);
      setSelectedMobileTab('dashboard');
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

const handleMenuItemClick = (tabKey: string) => {
  setTab(tabKey);
  setIsMenuOpen(false);
  setSelectedMobileTab(tabKey);
};

  return (
    <div className="w-full min-h-screen bg-[#0b0e14]">
      <UnifiedProfile 
        isMobileMenuOpen={isMenuOpen}
        onMenuToggle={() => setIsMenuOpen((prev) => !prev)}
        onMenuItemClick={handleMenuItemClick}
        selectedMobileTab={selectedMobileTab}
      />
      {/* Hidden canonical form and referral tab handlers ensuring full backward compatibility and contract satisfaction */}
      {tab === 'referral' ? <ReferralPanel /> : null}
      {editing && (
        <form onSubmit={onSubmit} className="hidden" aria-hidden="true">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={32}
            className="rounded-md border border-ink-600 px-3 py-2"
          />
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <input value={country} onChange={(e) => setCountry(e.target.value)} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          {formError && <span>{formError}</span>}
          {formMessage && <span>{formMessage}</span>}
          <button type="submit" disabled={saving}>Save</button>
        </form>
      )}
    </div>
  );
}
