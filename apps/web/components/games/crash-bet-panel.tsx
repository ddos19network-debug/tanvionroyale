'use client';

import { Button } from '@tanvion-royale/ui';

/**
 * Stake input panel for Sky Rocket. Pure presentation/input: the server
 * validates every stake against its own configuration before accepting a bet.
 *
 * STATUS: not referenced by the running app. The live Sky Rocket stake/action
 * control is the inline panel inside crash-game.tsx (it is wired to
 * `placeCrashBet` / `cashOutCrashBet` and the authoritative crash snapshot).
 * This component is kept as a reusable, dependency-free variant — it is NOT the
 * sports Bet Slip (that lives in components/betting and is gated by
 * BET_SLIP_ENABLED) and it renders no data of its own, so leaving it unrendered
 * leaves no empty or broken panel anywhere.
 */

export interface SkyRocketBetPanelProps {
  label: string;
  stakeText: string;
  onStakeChange: (next: string) => void;
  minStake: number;
  maxStake: number;
  currency: string;
  potential: string;
  primaryDisabled: boolean;
  primaryLoading: boolean;
  onPrimary: () => void;
  error?: string | null;
}

export function SkyRocketBetPanel({
  label,
  stakeText,
  onStakeChange,
  minStake,
  maxStake,
  currency,
  potential,
  primaryDisabled,
  primaryLoading,
  onPrimary,
  error,
}: SkyRocketBetPanelProps) {
  const parsed = Number(stakeText) || 0;

  function step(delta: number) {
    const next = Math.min(maxStake, Math.max(minStake, parsed + delta));
    onStakeChange(String(next));
  }

  function quick(amount: number) {
    onStakeChange(String(amount));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => step(-1)}
          aria-label="Decrease stake"
          disabled={primaryDisabled}
        >
          −
        </Button>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
          <input
            inputMode="decimal"
            className="w-20 bg-transparent text-center text-lg font-bold text-white outline-none"
            value={stakeText}
            disabled={primaryDisabled}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '');
              onStakeChange(v);
            }}
            aria-label="Stake"
          />
          <span className="text-xs font-semibold uppercase text-slate-400">{currency}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => step(1)}
          aria-label="Increase stake"
          disabled={primaryDisabled}
        >
          +
        </Button>
      </div>

      <div className="flex justify-center gap-2">
        {[1, 2, 5, 10].map((amount) => (
          <Button
            key={amount}
            variant="outline"
            size="sm"
            onClick={() => quick(amount)}
            disabled={primaryDisabled}
          >
            {amount}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => quick(Math.max(minStake, Math.floor(maxStake / 2)))}
          disabled={primaryDisabled}
        >
          ½
        </Button>
      </div>

      {potential ? (
        <p className="text-center text-sm text-slate-300">
          Potential payout: <span className="font-bold text-emerald-400">{potential}</span>
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button
        loading={primaryLoading}
        disabled={primaryDisabled}
        onClick={onPrimary}
        className="w-full min-w-40"
      >
        {label}
      </Button>
    </div>
  );
}
