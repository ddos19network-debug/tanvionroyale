'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import {
  listFreePlayResults,
  sendFreePlayAction,
  startFreePlaySession,
  type FreePlayResultView,
} from '@/lib/api/games';
import { ApiClientError } from '@/lib/api/client';
import { FreePlayBanner, FreePlayInbox, FreePlayResults } from './free-play-elements';

const GAME_SLUG = 'lightning-dice';

type Target = 'OVER_7' | 'UNDER_7' | 'EXACT_7';

interface DiceSnapshot {
  target: Target;
  phase: 'READY' | 'ROLLED';
  dice: [number, number] | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

const TARGET_LABELS: Record<Target, string> = {
  OVER_7: 'Over 7',
  UNDER_7: 'Under 7',
  EXACT_7: 'Exactly 7',
};

export function LightningDiceGame() {
  const [target, setTarget] = useState<Target>('OVER_7');
  const [snapshot, setSnapshot] = useState<DiceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FreePlayResultView[] | null>(null);

  const loadResults = useCallback(() => {
    listFreePlayResults(GAME_SLUG)
      .then(setResults)
      .catch(() => setResults([]));
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  function handleError(err: unknown) {
    if (err instanceof ApiClientError) {
      setError(
        err.status === 401
          ? 'Please sign in to play free — your practice scores are saved to your account.'
          : err.message,
      );
    } else {
      setError('Something went wrong. Please try again.');
    }
  }

  /** Each roll starts a fresh server session and immediately ROLLS the dice. */
  async function handleRoll() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const session = await startFreePlaySession(GAME_SLUG, { target });
      const res = await sendFreePlayAction(GAME_SLUG, session.id, { type: 'ROLL' });
      setSnapshot(res.session.state as unknown as DiceSnapshot);
      setScore(res.result?.score ?? 0);
      setMessage(res.result?.message ?? null);
      loadResults();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  const dice = snapshot?.dice ?? null;
  const total = dice ? dice[0] + dice[1] : null;

  const targetButtons = useMemo(
    () =>
      (['OVER_7', 'UNDER_7', 'EXACT_7'] as Target[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => {
            setTarget(t);
            setSnapshot(null);
            setMessage(null);
          }}
          aria-pressed={target === t}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            target === t
              ? 'bg-brand text-ink-950'
              : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
          }`}
        >
          {TARGET_LABELS[t]}
        </button>
      )),
    [target],
  );

  return (
    <div className="space-y-4">
      <FreePlayBanner />

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Lightning Dice — free dice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pick your target">
            <span className="text-sm text-slate-400">Target:</span>
            {targetButtons}
          </div>

          {snapshot && message ? <FreePlayInbox message={message} score={score} /> : null}

          <div className="flex items-center justify-center gap-4 py-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-4xl font-black text-white">
              {dice?.[0] ?? '—'}
            </div>
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-4xl font-black text-white">
              {dice?.[1] ?? '—'}
            </div>
          </div>

          <p className="text-center text-sm text-slate-400">
            {total !== null
              ? `Total ${total}`
              : `Pick a target and roll two fair dice. Perfect 7 pays 250 pts, over/under pays 100 pts.`}
          </p>

          <div className="flex justify-center">
            <Button loading={busy} onClick={handleRoll} className="min-w-40">
              🎲 Roll dice
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Your free-play results</CardTitle>
        </CardHeader>
        <CardContent>
          <FreePlayResults results={results} />
        </CardContent>
      </Card>
    </div>
  );
}