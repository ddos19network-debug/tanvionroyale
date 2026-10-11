'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { calculatePotentialReturn } from '@/lib/betting';

/**
 * Client-side bet slip state (Phase 5). This is TEMPORARY state only — the
 * backend revalidates everything (event/market/selection availability, current
 * odds, stake, balance) when a bet is submitted. The frontend is never treated
 * as authoritative.
 *
 * Phase 5 ships SINGLE bets, so the slip holds at most one selection — adding
 * another replaces the current one.
 */

export interface BetSlipSelection {
  selectionId: string;
  eventId: string;
  eventName: string;
  marketId: string;
  marketName: string;
  selectionName: string;
  price: string; // decimal odds string the customer has reviewed
  oddsVersion: number;
}

export interface BetSlipState {
  selection: BetSlipSelection | null;
  stakeMinor: number;
}

export type BetSlipStatus =
  | 'idle'
  | 'placing'
  | 'accepted'
  | 'odds_changed'
  | 'suspended'
  | 'insufficient'
  | 'rejected'
  | 'unavailable'
  | 'error';

export interface BetSlipContextValue extends BetSlipState {
  potentialPayout: number;
  addSelection: (selection: BetSlipSelection) => void;
  removeSelection: () => void;
  clearSlip: () => void;
  setStakeMinor: (minor: number) => void;
  /** Apply a freshly-reviewed odds price after an ODDS_CHANGED response. */
  updatePrice: (price: string, oddsVersion?: number) => void;
  status: BetSlipStatus;
  setStatus: (status: BetSlipStatus) => void;
  placedBetId: string | null;
  setPlacedBetId: (id: string | null) => void;
  message: string | null;
  setMessage: (message: string | null) => void;
}

const STORAGE_KEY = 'ng.betslip';
const DEFAULT_STAKE_MINOR = 100; // 1.00 BDT default

const BetSlipContext = createContext<BetSlipContextValue | null>(null);

function loadInitialState(): BetSlipState {
  if (typeof window === 'undefined') return { selection: null, stakeMinor: DEFAULT_STAKE_MINOR };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BetSlipState;
      if (parsed && typeof parsed.stakeMinor === 'number') {
        return { selection: parsed.selection ?? null, stakeMinor: parsed.stakeMinor };
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return { selection: null, stakeMinor: DEFAULT_STAKE_MINOR };
}

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BetSlipState>(loadInitialState);
  const [status, setStatus] = useState<BetSlipStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [placedBetId, setPlacedBetId] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage write failures
    }
  }, [state]);

  const addSelection = useCallback((selection: BetSlipSelection) => {
    setStatus('idle');
    setMessage(null);
    setPlacedBetId(null);
    setState((prev) => ({ ...prev, selection }));
  }, []);

  const removeSelection = useCallback(() => {
    setStatus('idle');
    setMessage(null);
    setState((prev) => ({ ...prev, selection: null }));
  }, []);

  const clearSlip = useCallback(() => {
    setStatus('idle');
    setMessage(null);
    setPlacedBetId(null);
    setState({ selection: null, stakeMinor: DEFAULT_STAKE_MINOR });
  }, []);

  const setStakeMinor = useCallback((minor: number) => {
    setState((prev) => ({ ...prev, stakeMinor: minor }));
  }, []);

  const updatePrice = useCallback((price: string, oddsVersion?: number) => {
    setState((prev) =>
      prev.selection
        ? {
            ...prev,
            selection: {
              ...prev.selection,
              price,
              oddsVersion: oddsVersion ?? prev.selection.oddsVersion,
            },
          }
        : prev,
    );
  }, []);

  const potentialPayout = useMemo(
    () =>
      state.selection ? calculatePotentialReturn(state.stakeMinor, state.selection.price) : 0,
    [state.selection, state.stakeMinor],
  );

  const value: BetSlipContextValue = {
    ...state,
    potentialPayout,
    addSelection,
    removeSelection,
    clearSlip,
    setStakeMinor,
    updatePrice,
    status,
    setStatus,
    placedBetId,
    setPlacedBetId,
    message,
    setMessage,
  };

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

export function useBetSlip(): BetSlipContextValue {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error('useBetSlip must be used within BetSlipProvider');
  return ctx;
}