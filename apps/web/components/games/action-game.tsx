'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import {
  getActiveFreePlaySession,
  listFreePlayResults,
  sendFreePlayAction,
  startFreePlaySession,
  type FreePlayResultView,
} from '@/lib/api/games';
import { ApiClientError } from '@/lib/api/client';
import { FreePlayBanner, FreePlayInbox, FreePlayResults } from './free-play-elements';

export interface ActionGameField {
  key: string;
  label: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface ActionGameConfig {
  slug: string;
  title: string;
  intro: string;
  /**
   * Multi-attempt games keep ONE session until the round finishes (e.g. Number
   * Guess accumulates attempts against the same secret). The frontend resumes
   * the active session instead of starting a fresh one on every press.
   */
  multiAttempt?: boolean;
  /** Inputs rendered before starting the session (sent in the session payload). */
  fields: ActionGameField[];
  /** The engine action to send after starting (e.g. ROLL, FLIP, SPIN, DEAL, PLAY). */
  action: { type: string; label: string };
  /** Snapshot keys to display after the round completes. */
  snapshotKeys?: { key: string; label: string }[];
}

const CONFIGS: Record<string, ActionGameConfig> = {
  'coin-flip': {
    slug: 'coin-flip',
    title: 'Coin Flip',
    intro: 'Call heads or tails, then flip. A match wins 100 free-play points.',
    fields: [
      { key: 'pick', label: 'Your call', options: [
        { value: 'HEADS', label: 'Heads' },
        { value: 'TAILS', label: 'Tails' },
      ] },
    ],
    action: { type: 'FLIP', label: 'Flip coin' },
    snapshotKeys: [{ key: 'result', label: 'Coin' }],
  },
  'higher-or-lower': {
    slug: 'higher-or-lower',
    title: 'Higher or Lower',
    intro: 'The server draws a number. Guess whether the next number is higher or lower. Win = 100 pts.',
    fields: [
      { key: 'guess', label: 'Your guess', options: [
        { value: 'GUESS_HIGH', label: 'Higher ↑' },
        { value: 'GUESS_LOW', label: 'Lower ↓' },
      ] },
    ],
    action: { type: 'GUESS', label: 'Play' },
    snapshotKeys: [
      { key: 'current', label: 'Current' },
      { key: 'next', label: 'Drawn' },
    ],
  },
  'rock-paper-scissors': {
    slug: 'rock-paper-scissors',
    title: 'Rock Paper Scissors',
    intro: 'Pick your move and play the computer. Win = 100 pts, draw = 20 pts.',
    fields: [
      { key: 'move', label: 'Your move', options: [
        { value: 'ROCK', label: '✊ Rock' },
        { value: 'PAPER', label: '✋ Paper' },
        { value: 'SCISSORS', label: '✌️ Scissors' },
      ] },
    ],
    action: { type: 'PLAY', label: 'Play' },
    snapshotKeys: [
      { key: 'playerMove', label: 'You' },
      { key: 'cpuMove', label: 'Computer' },
    ],
  },
  'wheel-spin': {
    slug: 'wheel-spin',
    title: 'Wheel Spin',
    intro: 'Spin the fair wheel and land on up to 100 free-play points.',
    fields: [],
    action: { type: 'SPIN', label: 'Spin wheel' },
    snapshotKeys: [{ key: 'prize', label: 'Prize' }],
  },
'dice-roll': {
    slug: 'dice-roll',
    title: 'Dice Roll',
    intro: 'Pick a number 1–6 and roll. A match = 100 free-play points.',
    fields: [{ key: 'pick', label: 'Your number', min: 1, max: 6, placeholder: '1–6' }],
    action: { type: 'ROLL', label: 'Roll dice' },
    snapshotKeys: [{ key: 'dice', label: 'Dice' }],
  },
  'high-card': {
    slug: 'high-card',
    title: 'High Card',
    intro: 'Draw against the dealer — the highest card wins. Win = 100 pts.',
    fields: [],
    action: { type: 'DEAL', label: 'Deal cards' },
    snapshotKeys: [
      { key: 'playerCard', label: 'You' },
      { key: 'dealerCard', label: 'Dealer' },
    ],
  },
  'color-prediction': {
    slug: 'color-prediction',
    title: 'Color Prediction',
    intro: 'Pick a colour and watch the draw. Red/Green = 50 pts, Violet = 100 pts.',
    fields: [
      { key: 'pick', label: 'Your pick', options: [
        { value: 'RED', label: '🔴 Red' },
        { value: 'GREEN', label: '🟢 Green' },
        { value: 'VIOLET', label: '🟣 Violet' },
      ] },
    ],
    action: { type: 'DRAW', label: 'Draw' },
    snapshotKeys: [{ key: 'drawn', label: 'Drawn' }],
  },
  'lucky-number': {
    slug: 'lucky-number',
    title: 'Lucky Number',
    intro: 'Pick a number 1–10 and see if it is drawn. A match = 150 pts.',
    fields: [{ key: 'pick', label: 'Your number', min: 1, max: 10, placeholder: '1–10' }],
    action: { type: 'DRAW', label: 'Draw' },
    snapshotKeys: [{ key: 'drawn', label: 'Drawn' }],
  },
  'number-guess': {
    slug: 'number-guess',
    title: 'Number Guess',
    intro: 'Guess the secret number between 1 and 100. Fewer attempts = more points.',
    // Multi-attempt: the engine keeps the SAME session (and secret) until the
    // player guesses correctly — the frontend must resume it, not restart.
    multiAttempt: true,
    fields: [{ key: 'n', label: 'Your guess', min: 1, max: 100, placeholder: '1–100' }],
    action: { type: 'GUESS', label: 'Guess' },
    snapshotKeys: [
      { key: 'attempts', label: 'Attempts' },
      { key: 'lastGuess', label: 'Last guess' },
      { key: 'hint', label: 'Hint' },
    ],
  },
};

/**
 * Look up the generic action-game config for a free-play engine slug.
 * Returns null for slugs without a config (Sky Rocket / Lightning Dice have
 * their own dedicated components).
 */
export function getActionGameConfig(slug: string): ActionGameConfig | null {
  return CONFIGS[slug] ?? null;
}

function numberValue(values: Record<string, string>, key: string): number | undefined {
  const v = (values[key] ?? '').trim();
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * Generically drives any simple round-based free-play game: start a server
 * session with the chosen input, send the round action, then render the result.
 */
export function ActionGame({ config }: { config: ActionGameConfig }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FreePlayResultView[] | null>(null);
  /** Live session id for multi-attempt games (single-round games ignore it). */
  const [sessionId, setSessionId] = useState<string | null>(null);

  const loadResults = useCallback(() => {
    listFreePlayResults(config.slug)
      .then(setResults)
      .catch(() => setResults([]));
  }, [config.slug]);

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

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const f of config.fields) {
      const v = (values[f.key] ?? '').trim();
      if (f.options && f.options.length) {
        if (v) payload[f.key] = v;
      } else if (f.min !== undefined && f.max !== undefined) {
        const n = numberValue(values, f.key);
        if (n !== undefined) payload[f.key] = n;
      } else if (v) {
        payload[f.key] = v;
      }
    }
    return payload;
  }

  async function play() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setSnapshot(null);
    try {
      // Multi-attempt games resume the existing ACTIVE session so attempts
      // accumulate against the same server-side secret. Single-round games
      // always start a fresh session so the chosen input (pick) applies.
      let sid = sessionId;
      if (config.multiAttempt && !sid) {
        const active = await getActiveFreePlaySession(config.slug).catch(() => null);
        if (active) {
          sid = active.id;
          setSessionId(active.id);
        }
      }
      if (!sid) {
        const session = await startFreePlaySession(config.slug, buildPayload());
        sid = session.id;
        if (config.multiAttempt) setSessionId(session.id);
        // Show the fresh engine state immediately (e.g. the current number in
        // Higher or Lower) before the round action resolves.
        setSnapshot(session.state as Record<string, unknown>);
      }
      const res = await sendFreePlayAction(config.slug, sid, {
        type: config.action.type,
        payload: buildPayload(),
      });
      setSnapshot(res.session.state as Record<string, unknown>);
      if (res.finished) {
        if (config.multiAttempt) setSessionId(null);
      }
      if (res.result) {
        setMessage(res.result.message);
        setScore(res.result.score);
      }
      loadResults();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

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
          <CardTitle className="text-white">{config.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-400">{config.intro}</p>

          {config.fields.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              {config.fields.map((field) =>
                field.options && field.options.length ? (
                  <label key={field.key} className="flex flex-col gap-1 text-sm text-slate-400">
                    {field.label}
                    <select
                      className="rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"
                      value={values[field.key] ?? field.options[0].value}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    >
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={field.key} className="flex flex-col gap-1 text-sm text-slate-400">
                    {field.label}
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="w-28 rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"
                    />
                  </label>
                ),
              )}
            </div>
          )}
          {message && snapshot ? <FreePlayInbox message={message} score={score} /> : null}

          {config.snapshotKeys && snapshot ? (
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
              {config.snapshotKeys.map(({ key, label }) => (
                <span key={key}>
                  <span className="text-slate-500">{label}:</span>{' '}
                  <span className="font-mono font-bold text-white">
                    {String(snapshot[key] ?? '—')}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          {!snapshot ? (
            <p className="text-sm text-slate-500">
              Set your choice (if any) and press the round button to play. The result is
              calculated and stored on the server.
            </p>
          ) : null}

          <div className="flex justify-center">
            <Button loading={busy} onClick={() => void play()}>
              {config.action.label}
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