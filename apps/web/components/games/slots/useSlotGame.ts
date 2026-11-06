'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSlotConfig, postSlotSpin } from '@/lib/api/slots';
import { getFreePlayPoints } from '@/lib/api/games';
import type {
  SlotConfigView,
  SlotSpinResponse,
  SlotCascadeStep,
  SlotFreeSpinEntry,
} from '@tanvion-royale/types';

export interface UseSlotGameReturn {
  config: SlotConfigView | null;
  balance: number | null;
  stake: number;
  setStake: (s: number) => void;
  grid: string[][] | null;
  isSpinning: boolean;
  activeMultiplier: number;
  lastWin: number;
  totalRoundWin: number;
  freeSpinsRemaining: number;
  inFreeSpins: boolean;
  message: string;
  error: string | null;
  turbo: boolean;
  setTurbo: (t: boolean | ((prev: boolean) => boolean)) => void;
  spin: () => Promise<void>;
  autoPlayCount: number;
  startAutoPlay: (count: number) => void;
  stopAutoPlay: () => void;
  showPaytable: boolean;
  setShowPaytable: (s: boolean) => void;
  showRules: boolean;
  setShowRules: (s: boolean) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useSlotGame(slug: string): UseSlotGameReturn {
  const [config, setConfig] = useState<SlotConfigView | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [stake, setStake] = useState<number>(100);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [activeMultiplier, setActiveMultiplier] = useState(1);
  const [lastWin, setLastWin] = useState(0);
  const [totalRoundWin, setTotalRoundWin] = useState(0);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [inFreeSpins, setInFreeSpins] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turbo, setTurbo] = useState(false);
  const [autoPlayCount, setAutoPlayCount] = useState(0);
  const [showPaytable, setShowPaytable] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const autoPlayRef = useRef(autoPlayCount);
  autoPlayRef.current = autoPlayCount;
  const isSpinningRef = useRef(isSpinning);
  isSpinningRef.current = isSpinning;

  // Initial load: config and balance
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const [cfg, fp] = await Promise.all([
          getSlotConfig(slug),
          getFreePlayPoints().catch(() => null),
        ]);
        if (!mounted) return;
        setConfig(cfg);
        if (cfg.stakeLevels.length > 0) {
          setStake(cfg.stakeLevels[0]);
        }
        if (fp && typeof fp.points === 'number') {
          setBalance(fp.points);
        }
        // Initialize blank grid with glyphs
        const initialGrid = Array.from({ length: cfg.rows }, () =>
          Array.from({ length: cfg.reels }, () => cfg.symbols[0]?.id ?? 'wild'),
        );
        setGrid(initialGrid);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load game config');
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, [slug]);

  // Sequential animation playback helper
  const animateSteps = useCallback(
    async (steps: SlotCascadeStep[], isTurbo: boolean) => {
      const stepDelay = isTurbo ? 100 : 350;
      for (const step of steps) {
        setGrid(step.gridAfter);
        setActiveMultiplier(Math.round((step.multiplierBp / 10000) * 10) / 10);
        if (step.stepPayBp > 0) {
          const stepWin = Math.floor((stake * step.stepPayBp) / 10000);
          setLastWin(stepWin);
        }
        await sleep(stepDelay);
      }
    },
    [stake],
  );

  const spin = useCallback(async () => {
    if (isSpinningRef.current || !config) return;
    if (balance !== null && balance < stake) {
      setError('Insufficient points for this stake');
      setAutoPlayCount(0);
      return;
    }

    setIsSpinning(true);
    setError(null);
    setMessage('');
    setLastWin(0);
    setTotalRoundWin(0);
    setActiveMultiplier(1);

    const clientRequestId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const resp: SlotSpinResponse = await postSlotSpin(slug, {
        stake,
        clientRequestId,
      });

      // 1. Initial base grid drop
      setGrid(resp.baseGrid);
      await sleep(turbo ? 80 : 250);

      // 2. Play base cascade steps
      if (resp.steps && resp.steps.length > 0) {
        await animateSteps(resp.steps, turbo);
      }

      // 3. Play free spins if triggered
      if (resp.freeSpins?.triggered && resp.freeSpins.spins?.length > 0) {
        setInFreeSpins(true);
        const totalAwarded = resp.freeSpins.awarded;
        for (let i = 0; i < resp.freeSpins.spins.length; i++) {
          const fs: SlotFreeSpinEntry = resp.freeSpins.spins[i];
          setFreeSpinsRemaining(totalAwarded - (i + 1));
          setGrid(fs.baseGrid);
          await sleep(turbo ? 100 : 300);
          if (fs.steps && fs.steps.length > 0) {
            await animateSteps(fs.steps, turbo);
          }
        }
        setInFreeSpins(false);
      }

      // 4. Update balance strictly from server response
      setBalance(resp.balanceAfter);
      setTotalRoundWin(resp.payout);
      setMessage(resp.message);

      // Autoplay rules: stop on big win (>= 20x) or feature trigger
      if (autoPlayRef.current > 0) {
        const isBigWin = resp.payout >= stake * 20;
        const triggeredFs = resp.freeSpins?.triggered;
        if (isBigWin || triggeredFs) {
          setAutoPlayCount(0);
        } else {
          setAutoPlayCount((c) => Math.max(0, c - 1));
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Spin failed. Balance unchanged.');
      setAutoPlayCount(0);
    } finally {
      setIsSpinning(false);
    }
  }, [config, balance, stake, slug, turbo, animateSteps]);

  // Autoplay loop
  useEffect(() => {
    if (autoPlayCount > 0 && !isSpinning && !error) {
      const timer = setTimeout(() => {
        spin();
      }, turbo ? 200 : 600);
      return () => clearTimeout(timer);
    }
  }, [autoPlayCount, isSpinning, error, turbo, spin]);

  const startAutoPlay = useCallback((count: number) => {
    setAutoPlayCount(count);
  }, []);

  const stopAutoPlay = useCallback(() => {
    setAutoPlayCount(0);
  }, []);

  return {
    config,
    balance,
    stake,
    setStake,
    grid,
    isSpinning,
    activeMultiplier,
    lastWin,
    totalRoundWin,
    freeSpinsRemaining,
    inFreeSpins,
    message,
    error,
    turbo,
    setTurbo,
    spin,
    autoPlayCount,
    startAutoPlay,
    stopAutoPlay,
    showPaytable,
    setShowPaytable,
    showRules,
    setShowRules,
  };
}
