'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { ApiClientError } from '@/lib/api/client';
import type { AnonymizedLiveBet, CrashHistoryEntry, CrashPlayerHistoryEntry } from '@/lib/api/crash';
import type { CrashSnapshotView, MultiplierUpdateEvent, RoundCrashedEvent } from '@/lib/api/crash';
import { applyRunningUpdate, isOlderSnapshot } from '@/lib/crash-presentation';
import { CrashRocketScene, type RocketPhase } from '@/components/games/crash-rocket';
import {
  cashOutCrashBet,
  createCrashSocket,
  getCrashHistory,
  getCrashLiveBets,
  getCrashMyHistory,
  getCrashSnapshot,
  newRequestId,
  placeCrashBet,
} from '@/lib/api/crash';

/**
 * Sky Rocket — server-authoritative crash game client.
 *
 * The browser ONLY renders the server snapshot and animates BETWEEN server
 * multiplier updates. The server decides: rounds, timing, crash point,
 * bet acceptance, cash-out multiplier, payout, and settlement. On reconnect
 * the authoritative snapshot (GET /games/crash/current) is re-fetched — the
 * client never invents missed events.
 */

const EASE_TIME_MS = 200; // visual response time only; never advances server state

export function SkyRocketGame() {
  const [snapshot, setSnapshot] = useState<CrashSnapshotView | null>(null);
  const [stake, setStake] = useState<number | null>(null);
  const [targetMultiplier, setTargetMultiplier] = useState<number>(1);
  const [displayMultiplier, setDisplayMultiplier] = useState(1);
  const [displayedAt, setDisplayedAt] = useState<number | null>(null);
  const [history, setHistory] = useState<CrashHistoryEntry[]>([]);
  const [liveBets, setLiveBets] = useState<AnonymizedLiveBet[]>([]);
  const [myHistory, setMyHistory] = useState<CrashPlayerHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyBet, setBusyBet] = useState(false);
  const [busyCashout, setBusyCashout] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  const roundIdRef = useRef<string | null>(null);
  // Synchronous event cursor: socket callbacks must not read a stale React render.
  const snapshotRef = useRef<CrashSnapshotView | null>(null);
  const betIdRef = useRef<string | null>(null);
  /** Round whose authoritative multiplier we already snapped to (see below). */
  const syncedRoundRef = useRef<string | null>(null);

  function fmt(amount: number): string {
    return Math.round(amount).toLocaleString('en-US');
  }

  const refreshSnapshot = useCallback(async () => {
    try {
      const snap = await getCrashSnapshot();
      // A delayed REST response must never roll live flight back into betting.
      if (isOlderSnapshot(snapshotRef.current, snap)) return;
      setSnapshot(snap);
      snapshotRef.current = snap;
      setAuthed(true);
      setError(null);
      if (snap.round) {
        const newRound = roundIdRef.current !== snap.round.id;
        roundIdRef.current = snap.round.id;
        if (newRound || snap.round.status === 'CREATED' || snap.round.status === 'BETTING_OPEN') {
          syncedRoundRef.current = null;
          setDisplayMultiplier(1);
          setTargetMultiplier(1);
          setDisplayedAt(null);
        }
        if (snap.round.status === 'RUNNING' && snap.round.currentMultiplier) {
          setTargetMultiplier(snap.round.currentMultiplier);
          setDisplayedAt(Date.now());
          // Reconnect / refresh / tab-wake sync: the FIRST time we see this
          // round running we SNAP to the authoritative multiplier, so the rocket
          // appears at its correct position instead of flying up from 1.00×.
          if (syncedRoundRef.current !== snap.round.id) {
            syncedRoundRef.current = snap.round.id;
            setDisplayMultiplier(snap.round.currentMultiplier);
          }
        }
        if (snap.round.crashMultiplier != null &&
            ['CRASHED', 'SETTLED', 'COMPLETED'].includes(snap.round.status)) {
          setTargetMultiplier(snap.round.crashMultiplier);
          setDisplayMultiplier(snap.round.crashMultiplier);
          setDisplayedAt(null);
        }
      } else {
        roundIdRef.current = null;
        syncedRoundRef.current = null;
        setTargetMultiplier(1);
        setDisplayMultiplier(1);
        setDisplayedAt(null);
      }
      betIdRef.current = snap.myBet?.id ?? null;
      setStake((current) => current ?? snap.config.minStake);
    } catch (err) {
      setAuthed(false);
      setError(
        err instanceof ApiClientError && err.status === 401
          ? 'Please sign in to play — your scores are saved to your account.'
          : err instanceof ApiClientError
            ? err.message
            : 'Could not reach the game server. Retrying…',
      );
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await getCrashHistory(12);
      setHistory(h.history);
    } catch {
      /* public history is best-effort */
    }
    try {
      const m = await getCrashMyHistory(15);
      setMyHistory(m.history);
    } catch {
      /* my-history needs auth */
    }
  }, []);

  const refreshLiveBets = useCallback(async () => {
    const id = roundIdRef.current;
    if (!id) {
      setLiveBets([]);
      return;
    }
    try {
      const live = await getCrashLiveBets(id);
      setLiveBets(live.bets);
    } catch {
      /* non-critical */
    }
  }, []);

  // Initial load: authoritative snapshot + histories.
  useEffect(() => {
    void refreshSnapshot();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket live feed (auto-reconnects; every (re)connect re-snapshots).
  useEffect(() => {
    if (authed === false) return;
    const socket = createCrashSocket();

    socket.on('connect', () => {
      syncedRoundRef.current = null;
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('MULTIPLIER_UPDATE', (event: MultiplierUpdateEvent) => {
      const current = snapshotRef.current;
      const next = applyRunningUpdate(current, event);
      if (next === current || !next?.round) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setTargetMultiplier(next.round.currentMultiplier!);
      setDisplayedAt(Date.now());
    });

    socket.on('ROUND_STARTED', () => {
      void refreshSnapshot();
    });

    socket.on('ROUND_CRASHED', (event: RoundCrashedEvent) => {
      const current = snapshotRef.current;
      const round = current?.round;
      if (current && round?.id === event.roundId &&
          ['CREATED', 'BETTING_OPEN', 'RUNNING'].includes(round.status) &&
          Number.isFinite(event.serverTime) && event.serverTime >= Date.parse(round.serverTime) &&
          event.crashMultiplier != null && Number.isFinite(event.crashMultiplier) &&
          event.crashMultiplier >= 1) {
        const next: CrashSnapshotView = {
          ...current,
          round: {
            ...round,
            status: 'CRASHED',
            bettingOpen: false,
            crashed: true,
            crashMultiplier: event.crashMultiplier,
            currentMultiplier: event.crashMultiplier,
            serverTime: new Date(event.serverTime).toISOString(),
          },
        };
        snapshotRef.current = next;
        setSnapshot(next);
        setTargetMultiplier(event.crashMultiplier);
        setDisplayMultiplier(event.crashMultiplier);
        setDisplayedAt(null);
      }
      void refreshSnapshot();
      void refreshHistory();
    });

    socket.on('ROUND_SETTLED', () => {
      void refreshSnapshot();
      void refreshHistory();
      void refreshLiveBets();
    });

    socket.on('BETTING_OPEN', () => {
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('ROUND_CREATED', () => {
      // Reset only when a snapshot confirms a new round ID. A duplicate or
      // delayed notification must not rewind the current flight.
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('PLAYER_BET_UPDATE', () => {
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('PLAYER_CASHOUT', () => {
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('connect_error', () => {
      /* silent — socket.io retries; the snapshot remains the fallback */
    });

    return () => {
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Tab wake is another authoritative sync, not a locally simulated catch-up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      syncedRoundRef.current = null;
      void refreshSnapshot();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshSnapshot]);

  // One persistent frame clock. New samples update a ref, not the loop's lifetime.
  // Exponential easing is frame-rate independent and cannot exceed the last
  // authoritative sample. A missing sample simply leaves the plane at that target.
  const visualTargetRef = useRef({ multiplier: targetMultiplier, active: displayedAt != null });
  useEffect(() => {
    visualTargetRef.current = { multiplier: targetMultiplier, active: displayedAt != null };
  }, [targetMultiplier, displayedAt]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(64, Math.max(0, now - previous));
      previous = now;
      const target = visualTargetRef.current;
      if (target.active) {
        setDisplayMultiplier((current) => {
          const diff = target.multiplier - current;
          if (Math.abs(diff) < 0.0005) return target.multiplier;
          return current + diff * (1 - Math.exp(-elapsed / EASE_TIME_MS));
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ---------------------------------------------------------------------------
  // Bet & cash-out actions (idempotent — duplicate retries are safe)
  // ---------------------------------------------------------------------------

  const adjustStake = useCallback((delta: number) => {
    const cfg = snapshot?.config;
    if (!cfg || stake == null) return;
    const next = Math.min(cfg.maxStake, Math.max(cfg.minStake, stake + delta));
    setStake(next);
  }, [snapshot, stake]);

  const placeBet = useCallback(async () => {
    if (stake == null || busyBet) return;
    setBusyBet(true);
    setNotice(null);
    try {
      const result = await placeCrashBet(stake, newRequestId());
      betIdRef.current = result.bet.id;
      setNotice('Bet placed — the rocket is climbing. Cash out before it crashes!');
      await refreshSnapshot();
      await refreshLiveBets();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? `${err.message}${err.code ? ` (${err.code})` : ''}`
          : 'Bet failed. Please try again.',
      );
    } finally {
      setBusyBet(false);
    }
  }, [stake, busyBet, refreshSnapshot, refreshLiveBets]);

  const cashOut = useCallback(async () => {
    const betId = betIdRef.current;
    if (!betId || busyCashout) return;
    setBusyCashout(true);
    setNotice(null);
    try {
      await cashOutCrashBet(betId, newRequestId());
      setNotice('Cashed out — your winnings were credited to your points wallet.');
      await refreshSnapshot();
      await refreshHistory();
      await refreshLiveBets();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? `${err.message}${err.code ? ` (${err.code})` : ''}`
          : 'Cash-out failed. Please try again.',
      );
    } finally {
      setBusyCashout(false);
    }
  }, [busyCashout, refreshSnapshot, refreshHistory, refreshLiveBets]);

  const round = snapshot?.round;
  const cfg = snapshot?.config;
  const myBet = snapshot?.myBet;
  const roundRunning = round?.status === 'RUNNING';
  const bettingOpen = Boolean(round?.bettingOpen);
  const currency = cfg?.currency ?? 'FREEPLAY';
  const myBetActive = myBet?.status === 'ACTIVE' && roundRunning;
  const multiplierText = `${displayMultiplier.toFixed(2)}×`;
  const roundCrashed =
    round?.status === 'CRASHED' || round?.status === 'SETTLED' || round?.status === 'COMPLETED';
  const rocketPhase: RocketPhase = roundCrashed
    ? 'CRASHED'
    : myBetActive
      ? 'RUNNING'
      : roundRunning
        ? 'RUNNING'
        : bettingOpen
          ? 'BETTING'
          : 'IDLE';
  return (
    <div className="sr-aviator-shell w-full">
      <div className="sr-game-topbar flex items-center px-3">
        <Link href="/games" className="sr-game-brand" aria-label="Back to games">Sky Rocket</Link>
        <span className="sr-game-balance" aria-label="Game currency">
          {snapshot ? currency : '—'}
        </span>
        <span className="sr-game-menu" aria-hidden>☰</span>
      </div>

      <div className="sr-history-strip flex items-center gap-3 overflow-hidden px-3" aria-label="Recent crashes">
        {history.length === 0 ? (
          <span className="text-xs text-slate-500">—</span>
        ) : history.slice(0, 12).map((entry, index) => (
          <span key={entry.roundId} className="tabular-nums">
            {entry.crashMultiplier.toFixed(2)}×
          </span>
        ))}
        <span className="sr-history-more" aria-hidden>•••</span>
      </div>

      {error ? (
        <p className="sr-game-message sr-game-error" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="sr-game-message sr-game-notice">{notice}</p>
      ) : null}

      <div className="sr-desktop-game-grid">
        <aside className="sr-live-sidebar" aria-label="Live player bets">
          <div className="sr-sidebar-tabs">
            <span className="is-active">All Bets</span>
            <span>Previous</span>
            <span>Top</span>
          </div>
          <div className="sr-live-list">
            {liveBets.length === 0 ? (
              <p className="sr-empty-live">No bets in the current round.</p>
            ) : liveBets.slice(0, 25).map((b, index) => (
              <div className="sr-live-row" key={`${b.player}-${b.stake}-${index}`}>
                <span className="sr-live-avatar" aria-hidden>●</span>
                <span className="sr-live-player">{b.player}</span>
                <span className="sr-live-stake">{fmt(b.stake)} {currency}</span>
                <span className="sr-live-result">
                  {b.cashedOut && b.cashoutMultiplier != null
                    ? `${b.cashoutMultiplier.toFixed(2)}×`
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <main className="sr-main-column">
          <section aria-label="Sky Rocket flight">
            {round ? (
              <CrashRocketScene
                key={round.id}
                displayMultiplier={displayMultiplier}
                targetMultiplier={targetMultiplier}
                crashMultiplier={roundCrashed ? (round.crashMultiplier ?? null) : null}
                roundId={round.id}
                phase={rocketPhase}
                bettingCloseAtMs={round.bettingCloseAt ? Date.parse(round.bettingCloseAt) : null}
                currency={currency}
                history={history}
              />
            ) : (
              <div className="sr-waiting-scene" role="status">Waiting for the game server…</div>
            )}
          </section>

          <div className="sr-bet-slots">
            {myBet && myBetActive ? (
              <Card className="sr-bet-card sr-reference-bet-card">
                <CardContent className="sr-reference-bet-inner">
                  <div className="sr-stake-control">
                    <button type="button" className="sr-circle-btn" disabled>−</button>
                    <strong>{fmt(myBet.stake)}</strong>
                    <button type="button" className="sr-circle-btn" disabled>+</button>
                    <div className="sr-quick-values"><span>1</span><span>2</span><span>5</span><span>10</span></div>
                  </div>
                  <Button loading={busyCashout} onClick={cashOut} className="sr-green-action">
                    Cash out<br />{multiplierText}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="sr-bet-card sr-reference-bet-card">
                <CardContent className="sr-reference-bet-inner">
                  <div className="sr-stake-control">
                    <button type="button" className="sr-circle-btn" onClick={() => adjustStake(-(cfg?.minStake ?? 100))} aria-label="Decrease stake">−</button>
                    <strong>{stake != null ? fmt(stake) : '—'}</strong>
                    <button type="button" className="sr-circle-btn" onClick={() => adjustStake(cfg?.minStake ?? 100)} aria-label="Increase stake">+</button>
                    <div className="sr-quick-values">
                      {[1, 2, 5, 10].map((mult) => (
                        <button key={mult} type="button" onClick={() => setStake((cfg?.minStake ?? 100) * mult)}>{mult}</button>
                      ))}
                    </div>
                  </div>
                  <Button loading={busyBet} onClick={placeBet} className="sr-green-action">
                    Bet<br />{stake != null ? `${fmt(stake)} ${currency}` : currency}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* The backend currently exposes one active bet per user snapshot. Keep the
                second reference slot visual-only rather than creating an unsupported
                second cash-out state. */}
            <div className="sr-reference-secondary-slot" aria-hidden>
              <div className="sr-reference-bet-inner">
                <div className="sr-stake-control">
                  <span className="sr-circle-btn">−</span><strong>{stake != null ? fmt(stake) : '—'}</strong><span className="sr-circle-btn">+</span>
                  <div className="sr-quick-values"><span>1</span><span>2</span><span>5</span><span>10</span></div>
                </div>
                <div className="sr-green-action sr-secondary-action">Bet<br />{stake != null ? `${fmt(stake)} ${currency}` : currency}</div>
              </div>
            </div>
          </div>

          <div className="sr-mobile-live">
            <div className="sr-sidebar-tabs"><span className="is-active">All Bets</span><span>Previous</span><span>Top</span></div>
            {liveBets.slice(0, 10).map((b, index) => (
              <div className="sr-live-row" key={`mobile-${b.player}-${b.stake}-${index}`}>
                <span className="sr-live-avatar" aria-hidden>●</span>
                <span className="sr-live-player">{b.player}</span>
                <span className="sr-live-stake">{fmt(b.stake)} {currency}</span>
                <span className="sr-live-result">{b.cashedOut && b.cashoutMultiplier != null ? `${b.cashoutMultiplier.toFixed(2)}×` : '—'}</span>
              </div>
            ))}
          </div>
        </main>
      </div>

      {myHistory.length > 0 ? (
        <details className="sr-my-history">
          <summary>Your rounds</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {myHistory.slice(0, 15).map((h) => (
                  <tr key={`${h.roundNumber}-${h.createdAt}`}>
                    <td>#{h.roundNumber}</td><td>{fmt(h.stake)} {h.currency}</td>
                    <td>{h.cashoutMultiplier != null ? `${h.cashoutMultiplier.toFixed(2)}×` : '—'}</td>
                    <td>{h.payout != null ? `${fmt(h.payout)} ${h.currency}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}