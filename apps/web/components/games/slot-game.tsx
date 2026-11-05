'use client';
import React, { useState } from 'react';
import { startFreePlaySession, sendFreePlayAction } from '@/lib/api/games';

type Theme = { name: string; bg: string; frame: string; accent: string; symbols: { id: string; svg: string }[] };

const THEMES: Record<string, Theme> = {
  'pharaohs-legacy': {
    name: "Pharaoh's Legacy",
    bg: 'bg-gradient-to-b from-amber-900 via-yellow-950 to-black',
    frame: 'border-amber-400',
    accent: 'text-amber-300',
    symbols: [
      { id: 'pharaoh', svg: '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#b8860b"/><text x="32" y="40" text-anchor="middle" font-size="20" fill="#ffd700">Ph</text></svg>' },
      { id: 'ankh', svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="20" r="10" fill="#00ced1"/><rect x="28" y="28" width="8" height="24" fill="#00ced1"/></svg>' },
      { id: 'scarab', svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="32" rx="20" ry="16" fill="#228b22"/></svg>' },
      { id: 'eye', svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="32" rx="24" ry="14" fill="#fff"/><circle cx="32" cy="32" r="8" fill="#000"/></svg>' },
      { id: 'mask', svg: '<svg viewBox="0 0 64 64"><rect x="12" y="8" width="40" height="48" rx="8" fill="#ffd700"/></svg>' },
      { id: 'pyramid', svg: '<svg viewBox="0 0 64 64"><polygon points="32,8 56,56 8,56" fill="#daa520"/></svg>' },
      { id: 'wild', svg: '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#ff4500"/><text x="32" y="40" text-anchor="middle" font-size="14" fill="#fff">WILD</text></svg>' },
      { id: 'scatter', svg: '<svg viewBox="0 0 64 64"><polygon points="32,4 39,24 60,24 43,38 50,58 32,46 14,58 21,38 4,24 25,24" fill="#00ffff"/></svg>' },
    ],
  },
};

const EXTRA: Record<string, Partial<Theme>> = {
  'atlantis-treasure': { bg: 'bg-gradient-to-b from-blue-900 via-cyan-950 to-black', frame: 'border-cyan-400', accent: 'text-cyan-300' },
  'neon-cyber-rush': { bg: 'bg-gradient-to-b from-purple-950 via-fuchsia-950 to-black', frame: 'border-fuchsia-400', accent: 'text-fuchsia-300' },
  'mystic-forest': { bg: 'bg-gradient-to-b from-emerald-950 via-green-950 to-black', frame: 'border-emerald-400', accent: 'text-emerald-300' },
  'samurai-fortune': { bg: 'bg-gradient-to-b from-red-950 via-rose-950 to-black', frame: 'border-rose-400', accent: 'text-rose-300' },
  'cosmic-odyssey': { bg: 'bg-gradient-to-b from-indigo-950 via-purple-950 to-black', frame: 'border-indigo-400', accent: 'text-indigo-300' },
  'dragons-kingdom': { bg: 'bg-gradient-to-b from-red-900 via-orange-950 to-black', frame: 'border-red-500', accent: 'text-red-300' },
  'tropical-paradise': { bg: 'bg-gradient-to-b from-orange-900 via-amber-950 to-black', frame: 'border-orange-400', accent: 'text-orange-300' },
  'steampunk-revolution': { bg: 'bg-gradient-to-b from-amber-950 via-stone-950 to-black', frame: 'border-amber-600', accent: 'text-amber-200' },
  'frozen-empire': { bg: 'bg-gradient-to-b from-sky-950 via-blue-950 to-black', frame: 'border-sky-300', accent: 'text-sky-200' },
};

function getTheme(slug: string): Theme {
  const base = THEMES[slug];
  if (base) return base;
  const e = EXTRA[slug] ?? {};
  const hues = [200, 260, 320, 120, 30, 180, 0, 60];
  return {
    name: slug,
    bg: e.bg ?? 'bg-gradient-to-b from-slate-900 to-black',
    frame: e.frame ?? 'border-slate-400',
    accent: e.accent ?? 'text-white',
    symbols: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, svg: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="hsl(${hues[i]},70%,50%)"/></svg>` })),
  };
}



export function SlotGame({ slug, title }: { slug: string; title: string }) {
  const theme = getTheme(slug);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  async function ensureSession() {
    if (sessionId) return sessionId;
    const s = await startFreePlaySession(slug);
    setSessionId(s.id);
    return s.id;
  }

  async function spin() {
    setLoading(true);
    try {
      const sid = await ensureSession();
      const r = await sendFreePlayAction(slug, sid, { type: 'SPIN' });
      setGrid((r.session.state.grid as string[][]) ?? null);
      setMsg(r.result?.message ?? '');
      if (r.finished) setSessionId(null);
    } catch (e: any) {
      setMsg(e?.message ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  const symMap = Object.fromEntries(theme.symbols.map(s => [s.id, s.svg]));

  return (
    <div className={`min-h-[100dvh] w-full ${theme.bg} text-white p-4`}>
      <h1 className={`text-2xl font-bold mb-4 ${theme.accent}`}>{title}</h1>
      <div className={`border-4 ${theme.frame} rounded-xl p-3 inline-block`}>
        <div className="grid gap-2">
          {grid?.map((row, i) => (
            <div key={i} className="flex gap-2">
              {row.map((s, j) => (
                <div key={j} className="w-16 h-16 rounded bg-black/40 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: symMap[s] ?? s }} />
              ))}
            </div>
          )) ?? <div className="text-slate-400 p-4">Press Spin</div>}
        </div>
      </div>
      <div className="mt-4">
        <button onClick={spin} disabled={loading} className={`px-6 py-3 rounded-lg font-bold ${theme.accent} bg-white/10 border ${theme.frame} disabled:opacity-50`}>
          {loading ? 'Spinning...' : 'Spin'}
        </button>
        <p className="mt-3 text-sm text-slate-300">{msg}</p>
      </div>
    </div>
  );
}

