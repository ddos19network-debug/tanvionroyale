'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { CrashHistoryEntry } from '@/lib/api/crash';
import {
  scenePoint,
  curveTangentAt,
  flightPath,
  rocketProgress,
  rocketPosition,
  type ScenePoint,
} from '@/lib/crash-curve';

// Re-export the pure curve helpers so the scene's tests (and any consumer) can
// keep importing them from the scene module — the SINGLE source of truth now
// lives in lib/crash-curve.ts.
export { rocketProgress, rocketPosition };

/**
 * Sky Rocket — animated CARTOON AIRPLANE scene.
 *
 * PURE PRESENTATION. The plane's position is derived from the CURRENT SERVER
 * MULTIPLIER (see `rocketProgress`) and from the server round state. This
 * component NEVER decides when to crash, never runs a crash timer, never
 * consumes a sequence position and never computes an authoritative value — it
 * only visualises what the backend already said (the snapshot/WebSocket wiring
 * and the 40 ms display easing live in crash-game.tsx).
 *
 * The only client-side timers here are:
 *   1. the BETTING_OPEN countdown LABEL (display only — the round state comes
 *      from the server and is never changed by it), and
 *   2. the crash-sequence stage timer, which only decides how long the fly-off
 *      beat plays before the plane is removed from a crashed scene
 *      (presentation only).
 * Neither can influence the round, the multiplier, settlement or the wallet.
 *
 * VEHICLE: OUR OWN inline-SVG cartoon rocket (`./sky-rocket-ship.tsx`) — our own
 * shape and colours, no third-party sprite. It is drawn nose-RIGHT at rest,
 * pitched by a clamped 6–14° along the curve, with a spinning propeller and a
 * tail flame driven by `--sr-ship-thrust`.
 *
 * SCENE (Phase 2 — why it reads as "flying" instead of "static"):
 *   - the multiplier→position mapping follows a deterministic quadratic Bézier
 *     take-off curve (pad → shallow roll → steep climb to the upper right),
 *     re-parametrised by ARC LENGTH so speed is constant along the path;
 *   - a layered DAY sky (deep blue zenith → pale horizon → low warm sun glow →
 *     twelve flat white clouds in three parallax depths) reproduces the
 *     supplied reference art direction; the photographic backdrop and the old
 *     night-sky layers (moon, star field) are gone;
 *   - the sky/dust/clouds parallax-scroll and the runway pad recedes
 *     as the plane climbs (all derived from the server multiplier);
 *   - speed streaks brighten with progress, the flown CURVE lights up behind the
 *     plane, exhaust puffs trail along the real curve, and the plane carries a
 *     motion streak, engine glow, warm-up vibration (betting) and idle bob;
 *   - the flight pitch is measured from the curve tangent in real scene pixels,
 *     clamped to 6–14° (following the tangent fully reads cartoonish at apex);
 *   - the drawn anchor is contained in the measured scene box, so the pitched,
 *     scaled artwork can never clip against the scene on very narrow boards
 *     (~320px) — a no-op on the designed-for viewports (≥430px);
 *   - the scene box is responsive viewport-height based
 *     (`h-[calc(100svh-11rem)]`, clamped) instead of the old `min(62vh,600px)`.
 *
 * CRASH VISUAL — "FLIES AWAY" (no explosion): the moment the backend reports
 * CRASHED a plane this mount watched fly escapes to the upper right over 600ms
 * (`sr-fly-away`; instant removal under reduced motion), the curve and HUD
 * FREEZE at the server's crash value, and the HUD shows "FLEW AWAY!" in red. A
 * mount that arrives already crashed (refresh / reconnect / route change) never
 * plays the beat — no plane, no streaks — so a remount can never fake a crash.
 * A NEW round id resets the visual crash state, so the plane reappears at the
 * launch pad on the next round.
 *
 * Performance: transforms/opacity only (GPU composited, see the `sr-` keyframes
 * in app/globals.css), no per-frame React work of its own, deterministic
 * decoration tables instead of Math.random (no hydration mismatch) and every
 * continuous animation honours `prefers-reduced-motion`. Decorative layers are
 * pointer-events-none so the game controls and navigation stay interactive.
 */

export type RocketPhase = 'IDLE' | 'BETTING' | 'RUNNING' | 'CRASHED' | 'CASHED_OUT';

export interface CrashRocketSceneProps {
  /** Server-authoritative multiplier (eased between server updates). */
  displayMultiplier: number;
  /** Last server target, read-only diagnostics; never drives flight position. */
  targetMultiplier?: number;
  /** Frozen crash multiplier once the backend says CRASHED. */
  crashMultiplier: number | null;
  /** Current round id — used so a NEW crash event replays exactly once. */
  roundId?: string | null;
  phase: RocketPhase;
  /** Server bettingCloseAt (epoch ms) for the betting countdown display. */
  bettingCloseAtMs: number | null;
  /** Server-authoritative display currency; the scene never invents wallet values. */
  currency?: string;
  /** Existing server-provided recent crash history; presentation only. */
  history?: CrashHistoryEntry[];
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Flight geometry now lives in the single source of truth @/lib/crash-curve
// (PAD / APEX / arc-length re-parametrisation / rocketProgress / scenePoint /
// flightPath / curveTangentAt / multiplierToScenePoint). The scene imports
// those helpers above; only the SCENE-LOCAL containment guard (planeWidthPx +
// containAnchor) is defined below, because it needs the measured pixel box.
// ---------------------------------------------------------------------------

/**
 * Rendered airplane width in CSS pixels — mirrors the `.sr-plane` rule
 * `width: clamp(96px, 18vw, 260px)` in app/sky-rocket-phase2.css, so containment
 * maths can run without reading CSS (and identically during SSR).
 */
function planeWidthPx(sceneWidth: number): number {
  return Math.min(260, Math.max(96, 0.18 * sceneWidth));
}

/**
 * Contain the drawn anchor inside the scene box.
 *
 * The curve is expressed in scene percentages, but the artwork has a real pixel
 * size and is pitched (≤14°) and scaled (≤1.16×), so on very narrow boards
 * (~320px) the high-multiplier apex would otherwise clip the nose against the
 * scene's `overflow-hidden`. This is a PRESENTATION-ONLY guard: it never touches
 * the server-derived multiplier or progress and it returns the curve point
 * untouched before the ResizeObserver has measured a box (SSR / first paint), so
 * the exported landmarks (`rocketPosition`) stay exactly on the curve.
 *
 * The half-extents are computed from the CURRENT pitch and scale (the exact
 * axis-aligned box of the rotated, scaled artwork — the trimmed PNG is 494×180),
 * not from a worst case, so the guard is a genuine no-op at the launch pad
 * (pitch 0°, scale 1×) on every viewport, including 320px-wide phones.
 */
const PLANE_ASPECT = 180 / 494;

function containAnchor(
  point: { left: number; top: number },
  box: { width: number; height: number },
  pitchDeg: number,
  scale: number,
): { left: number; top: number } {
  if (!box.width || !box.height) return point;
  // Axis-aligned box of the pitched + scaled artwork, plus the scene's 1px border.
  const w = planeWidthPx(box.width) * scale;
  const h = w * PLANE_ASPECT;
  const rad = (Math.abs(pitchDeg) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfX = (cos * w + sin * h) / 2 + 2;
  const halfY = (sin * w + cos * h) / 2 + 2;
  const minLeft = (halfX / box.width) * 100;
  const minTop = (halfY / box.height) * 100;
  return {
    left: Math.min(100 - minLeft, Math.max(minLeft, point.left)),
    top: Math.min(100 - minTop, Math.max(minTop, point.top)),
  };
}

// ---------------------------------------------------------------------------
// Deterministic decoration tables (no Math.random → no hydration mismatch)
// ---------------------------------------------------------------------------

/** Speed streaks that scroll down as the plane climbs (speed cue). The
    reference draws these as bold YELLOW dashes (see the .sr-streak markup
    colours), so the table stays but the palette moved to amber/yellow. */
const STREAKS = [
  { x: 16, y: 8, h: 22, d: 0 }, { x: 33, y: 26, h: 16, d: 180 }, { x: 52, y: 4, h: 26, d: 60 },
  { x: 68, y: 30, h: 14, d: 300 }, { x: 86, y: 12, h: 20, d: 120 }, { x: 60, y: 58, h: 12, d: 420 },
  { x: 24, y: 62, h: 18, d: 240 }, { x: 78, y: 68, h: 14, d: 360 }, { x: 44, y: 46, h: 12, d: 480 },
];

/** Atmospheric dust motes rising slowly through the scene. */
const DUST = [
  { x: 12, y: 78, s: 2, d: 0, o: 0.35 }, { x: 26, y: 92, s: 3, d: 1600, o: 0.3 },
  { x: 41, y: 70, s: 2, d: 3200, o: 0.28 }, { x: 57, y: 96, s: 2, d: 800, o: 0.32 },
  { x: 68, y: 74, s: 3, d: 2400, o: 0.26 }, { x: 79, y: 90, s: 2, d: 4000, o: 0.3 },
  { x: 88, y: 66, s: 2, d: 2000, o: 0.24 }, { x: 50, y: 84, s: 2, d: 5200, o: 0.28 },
];

/** Exhaust puffs trailing from the tail (all drift down-left, opposite the flight). */
const EXHAUST = [
  { d: 0, s: 9, tx: -20, ty: 20 }, { d: 150, s: 12, tx: -26, ty: 26 },
  { d: 300, s: 10, tx: -18, ty: 24 }, { d: 450, s: 14, tx: -30, ty: 30 },
  { d: 600, s: 11, tx: -22, ty: 22 },
];

/** Smoke puffs left behind on the already-flown part of the path. */
const FLIGHT_TRAIL = [
  { back: 0.015, size: 16, o: 0.55, d: 0, hot: true },
  { back: 0.05, size: 20, o: 0.45, d: 180, hot: true },
  { back: 0.095, size: 25, o: 0.36, d: 360, hot: false },
  { back: 0.15, size: 30, o: 0.28, d: 540, hot: false },
  { back: 0.22, size: 35, o: 0.2, d: 720, hot: false },
  { back: 0.3, size: 40, o: 0.14, d: 900, hot: false },
  { back: 0.4, size: 46, o: 0.1, d: 1080, hot: false },
];

/** Runway edge lights (static; the blink comes from CSS animation delay). */
const RUNWAY_LIGHTS = [true, false, true, true, false, true];

/**
 * Cloud banks — TWELVE flat white clouds in three depth planes, matching the
 * supplied reference: tiny crisps high in the deep-blue zenith (far), mid-sized
 * banks across the middle band (mid) and large soft banks stacked along the pale
 * horizon (near).
 *
 * x = centre as % of scene width; y = the cloud's TOP edge as % of scene height
 * MEASURED FROM THE BOTTOM; w/h = size as % of scene width/height; o = opacity;
 * dur/delay = per-cloud drift speed/phase (seconds) so no two clouds ever move
 * in lockstep. All deterministic — no Math.random → no hydration mismatch.
 */
const CLOUDS_FAR = [
  { x: 10, y: 88, w: 18, h: 5, o: 0.75, dur: 96, delay: 0 },
  { x: 34, y: 94, w: 15, h: 4, o: 0.6, dur: 110, delay: -14 },
  { x: 58, y: 86, w: 20, h: 5, o: 0.7, dur: 102, delay: -38 },
  { x: 80, y: 93, w: 16, h: 4, o: 0.55, dur: 118, delay: -60 },
  { x: 22, y: 79, w: 13, h: 4, o: 0.5, dur: 124, delay: -22 },
  { x: 68, y: 76, w: 14, h: 4, o: 0.45, dur: 130, delay: -76 },
];
/** Cloud banks, mid depth. */
const CLOUDS_MID = [
  { x: 16, y: 60, w: 30, h: 9, o: 0.8, dur: 74, delay: -10 },
  { x: 54, y: 50, w: 26, h: 8, o: 0.72, dur: 82, delay: -44 },
  { x: 86, y: 64, w: 28, h: 8, o: 0.66, dur: 78, delay: -28 },
];
/** Cloud banks, near depth (large, hugging the horizon). */
const CLOUDS_NEAR = [
  { x: 8, y: 22, w: 44, h: 13, o: 0.9, dur: 58, delay: -6 },
  { x: 46, y: 12, w: 38, h: 11, o: 0.85, dur: 64, delay: -34 },
  { x: 84, y: 26, w: 42, h: 12, o: 0.8, dur: 54, delay: -48 },
];

/* NOTE: a crashed scene intentionally shows NO plane — the fly-off beat ends
   with the plane removed entirely (only the frozen curve + HUD remain). */

/**
 * Crash-sequence stage.
 *  - 'none':      normal launch / flight
 *  - 'escaping':  the plane is flying away off the upper right (600ms beat,
 *                 only for a LIVE crash this mount actually watched)
 *  - 'gone':      the plane is removed (also the stage a mount that arrives
 *                 already crashed starts in, so a refresh / reconnect never
 *                 replays the fly-off)
 */
type CrashStage = 'none' | 'escaping' | 'gone';

/** Reduced-motion preference (client only; false during SSR → no mismatch). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  return reduced;
}

/**
 * Real scene box size (CSS pixels), tracked with a ResizeObserver so the
 * curve-based pitch maths uses true pixel deltas on every viewport.
 * Presentation only — it never touches the server-derived position.
 */
function useSceneBox(ref: RefObject<HTMLDivElement>): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (!width || !height) return;
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return box;
}

/**
 * Display pitch (deg) while climbing: the curve tangent measured in REAL scene
 * pixels, compressed into the 6–14° band. Following the tangent fully (up to
 * ≈72° at the apex) reads cartoonish; a fixed diagonal ignores the curve — so
 * the pitch starts shallow and steepens with the slope, clamped. Presentation
 * only — it never touches the server-derived position.
 */
function flightPitchDegrees(progress: number, box: { width: number; height: number }): number {
  if (box.width <= 0 || box.height <= 0) return 8;
  const t = curveTangentAt(progress);
  const dxPx = Math.abs((t.dx / 100) * box.width);
  const dyPx = Math.abs((t.dy / 100) * box.height);
  const slope = (Math.atan2(dyPx, dxPx) * 180) / Math.PI;
  return Math.min(14, Math.max(6, 6 + 8 * Math.min(1, slope / 40)));
}

export function CrashRocketScene(props: CrashRocketSceneProps) {
  return <RoundRocketScene key={props.roundId ?? 'waiting'} {...props} />;
}

function RoundRocketScene({
  displayMultiplier,
  targetMultiplier = displayMultiplier,
  crashMultiplier,
  roundId = null,
  phase,
  bettingCloseAtMs,
  currency = 'FREEPLAY',
  history = [],
}: CrashRocketSceneProps) {
  const crashed = phase === 'CRASHED';
  const flying = phase === 'RUNNING';
  const cashedOut = phase === 'CASHED_OUT';
  const inFlight = flying || cashedOut;
  /** Still climbing (used for the engine/exhaust/speed effects). */
  const thrusting = inFlight && !crashed;

  // Authoritative position: the FROZEN crash multiplier once the server says
  // CRASHED, otherwise the eased server multiplier. Never a client-side guess.
  const shown = crashed && crashMultiplier != null
    ? crashMultiplier
    : inFlight || crashed ? displayMultiplier : 1;
  const progress = rocketProgress(shown);
  const point = scenePoint(progress);
  /** Zero while waiting; follows only the served multiplier during flight. */
  const travel = progress;

  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneBox = useSceneBox(sceneRef);
  const reducedMotion = usePrefersReducedMotion();

  /** Acceleration scale along the climb (presentation only). */
  const planeScale = 1 + 0.16 * travel;
  /**
   * Curve-derived pitch, clamped to the 6–14° band (level while on the pad).
   * Only thrusting matters here: a CRASHED round either shows the 600ms fly-off
   * or no plane at all (`showPlane`), and neither beats need a pitch — so the
   * pitch (and therefore the containment guard) never depends on crash state.
   */
  const pitchDeg = thrusting ? flightPitchDegrees(progress, sceneBox) : 0;

  // Drawn anchor: the curve point, contained in the measured scene box so the
  // pitched, scaled artwork can never clip on a very narrow board (see containAnchor).
  const { left, top } = containAnchor(point, sceneBox, pitchDeg, planeScale);

  const debugTarget = rocketPosition(crashed ? shown : inFlight ? targetMultiplier : 1);
  const debugRef = useRef<HTMLPreElement>(null);

  // Read-only diagnostics updated by the existing render cadence, never a clock.
  const velocityRef = useRef(0);
  const lastSampleRef = useRef<{ p: number; t: number } | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const now = performance.now();
    const last = lastSampleRef.current;
    if (last && now > last.t) {
      velocityRef.current = (progress - last.p) / ((now - last.t) / 1000);
    }
    lastSampleRef.current = { p: progress, t: now };
    if (debugRef.current) debugRef.current.textContent =
      `${phase} | round ${roundId ?? '—'}\nm=${shown.toFixed(3)} p=${progress.toFixed(4)}\n` +
      `target ${debugTarget.left.toFixed(2)},${debugTarget.top.toFixed(2)}%\n` +
      `render ${left.toFixed(2)},${top.toFixed(2)}%\n` +
      `velocity ${inFlight ? velocityRef.current.toFixed(3) : '0.000'} progress/s`;
  }, [progress, shown, phase, roundId, left, top, debugTarget.left, debugTarget.top, inFlight]);

  // Fly-off stage. Mounting while the round is ALREADY crashed starts in
  // 'gone', so refresh / reconnect / React remount never replay the fly-off.
  // The crash identity includes the round id so two consecutive rounds that
  // crash at the SAME multiplier still each play exactly once.
  const [crashStage, setCrashStage] = useState<CrashStage>(crashed ? 'gone' : 'none');
  /** True while this mount has seen the round NOT crashed (i.e. we watched it fly). */
  const sawFlightRef = useRef(inFlight);
  const sawBettingRef = useRef(phase === 'BETTING');
  useEffect(() => {
    if (inFlight) sawFlightRef.current = true;
    if (phase === 'BETTING') sawBettingRef.current = true;
  }, [inFlight, phase]);
  /** Crash instance we already handled (guards against a replay for the same crash). */
  const crashKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!crashed) {
      crashKeyRef.current = null;
      setCrashStage('none');
      return;
    }
    const crashValue = crashMultiplier == null ? 'crashed' : crashMultiplier.toFixed(2);
    const key = `${roundId ?? 'live'}:${crashValue}`;
    if (crashKeyRef.current === key) return;
    crashKeyRef.current = key;
    // Only a crash this mount actually SAW the round fly into plays the
    // 600ms fly-off. Loading (or reconnecting) into an already-crashed round
    // goes straight to 'gone' — never a replayed fly-off, never a plane.
    // Reduced motion removes the plane instantly (no escape beat).
    const watched = sawFlightRef.current && !reducedMotion;
    setCrashStage(watched ? 'escaping' : 'gone');
  }, [crashed, crashMultiplier, roundId, reducedMotion]);

  useEffect(() => {
    if (crashStage !== 'escaping') return;
    const timer = setTimeout(() => setCrashStage('gone'), 600);
    return () => clearTimeout(timer);
  }, [crashStage]);

  // Display-only betting countdown. It ticks a LABEL; the round state itself
  // always comes from the server snapshot / WebSocket events.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== 'BETTING' || bettingCloseAtMs == null) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase, bettingCloseAtMs]);

  const secondsToClose =
    bettingCloseAtMs != null && nowMs != null
      ? Math.max(0, Math.ceil((bettingCloseAtMs - nowMs) / 1000))
      : null;

  const flyingAway = crashStage === 'escaping';
  // During the 600ms fly-off beat the plane stays mounted (animating out);
  // once the stage settles to 'gone' a crashed round renders NO plane at all.
  const showPlane = !crashed || flyingAway;

  // Parallax / recede amounts — plain functions of the SERVER-derived progress.
  const dustShift = travel * 74;
  const cloudShiftFar = travel * 12;
  const cloudShiftMid = travel * 30;
  const cloudShiftNear = travel * 52;
  // The reference's yellow motion lines only exist in flight (the betting screen
  // is a calm sky), and they brighten with the multiplier.
  const streakOpacity = thrusting ? 0.3 + 0.6 * travel : 0;
  const padOpacity = 1 - 0.55 * travel;
  /**
   * Ground recede: the floor SINKS and fades as the plane climbs. A `scale()`
   * recede was used before, but scaling from a bottom-left origin shrank the
   * horizon band to ~73% width and left a hard vertical seam across the lower
   * right of the sky (invisible over the old night haze, obvious over the
   * reference's bright day sky). A translate + fade has no seam at all.
   */
  const padSink = travel * 16;
  const exhaustOpacity = thrusting ? 0.35 + 0.65 * travel : 0;

  const statusText = crashed
    ? `Flew away at ${shown.toFixed(2)}×`
    : cashedOut
      ? 'Cashed out — riding along'
      : flying
        ? 'Round running'
        : phase === 'BETTING'
          ? 'Betting open'
          : 'Waiting for the next round';
  const ariaState = crashed
    ? 'crashed'
    : inFlight
      ? 'flying'
      : phase === 'BETTING'
        ? 'betting open'
        : 'waiting for the next round';

return (
    <div className="relative w-full">
      <div
        ref={sceneRef}
        className="sr-scene relative w-full overflow-hidden rounded-2xl border border-sky-950/10 bg-[#4b93e2]"
        role="img"
        aria-label={`Sky Rocket game — multiplier ${shown.toFixed(2)}×, ${ariaState}`}
      >
        <div className="sr-reference-mode" aria-hidden>FUN MODE</div>
        {/* ---------- 0. Day sky (reference art direction) ----------
            Deep-blue zenith → mid blue → pale horizon, a low warm sun glow in the
            lower right, a soft cloud-deck haze band right above the horizon and
            TWELVE flat white clouds in three parallax depths. Pure CSS — the old
            photographic backdrop and the moon/star night layers are gone. */}
        <div className="sr-synthetic-sky pointer-events-none absolute inset-0 z-0" aria-hidden>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#2b6fd4_0%,#4b93e2_32%,#7fb8ec_58%,#b7d9f4_80%,#e6f4ff_100%)]" />
          {/* Sun: a single warm glow low on the right, behind the near cloud bank. */}
          <div
            data-sr-sun
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_82%_20%,rgba(255,246,205,0.75),rgba(255,238,170,0.28)_34%,transparent_58%)]"
          />
          {/* Horizon haze / cloud deck that the take-off pads sits on. */}
          <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-white/80 via-white/35 to-transparent" />
          {[{ clouds: CLOUDS_FAR, shift: cloudShiftFar, depth: 'far' },
            { clouds: CLOUDS_MID, shift: cloudShiftMid, depth: 'mid' },
            { clouds: CLOUDS_NEAR, shift: cloudShiftNear, depth: 'near' }].map(({ clouds, shift, depth }) => (
            <div key={depth} className="absolute inset-0" data-cloud-depth={depth}
              style={{ transform: `translate3d(${-shift * 0.7}px, ${shift}px, 0)` }}>
              {clouds.map((cloud, i) => (
                <span key={i} className={`sr-cloud sr-cloud-${depth} absolute`}
                  style={{ left: `${cloud.x - cloud.w / 2}%`, bottom: `${cloud.y}%`, width: `${cloud.w}%`,
                    height: `${cloud.h}%`, opacity: cloud.o,
                    animationDuration: `${cloud.dur}s`, animationDelay: `${cloud.delay}s` }} />
              ))}
            </div>
          ))}
        </div>

        {/* ---------- 1. Speed streaks (reference's yellow motion lines) ----------
            Brighten and thicken with the SERVER multiplier; hidden entirely on the
            pad so the betting screen shows only sky + clouds. */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ opacity: streakOpacity }}
          aria-hidden
        >
          {STREAKS.map((streak, i) => (
            <span
              key={`streak-${i}`}
              className="sr-streak absolute block w-[3px] rounded-full"
              style={{
                left: `${streak.x}%`,
                top: `${streak.y}%`,
                height: streak.h + 6,
                background:
                  'linear-gradient(to bottom, rgba(253,224,71,0) 0%, rgba(253,230,138,0.92) 55%, rgba(253,224,71,0) 100%)',
                animationDelay: `${streak.d}ms`,
              }}
            />
          ))}
        </div>

        {/* ---------- 3. Atmospheric dust (parallax) ---------- */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ transform: `translate3d(0, ${dustShift}px, 0)` }}
          aria-hidden
        >
          {DUST.map((mote, i) => (
            <span
              key={`dust-${i}`}
              className="sr-dust absolute rounded-full bg-amber-50/80"
              style={
                {
                  left: `${mote.x}%`,
                  top: `${mote.y}%`,
                  width: mote.s,
                  height: mote.s,
                  animationDelay: `${mote.d}ms`,
                  '--sr-o': mote.o,
                } as CSSProperties
              }
            />
          ))}
        </div>

        {/* ---------- 4. Flight path: the reference's thin warm trail ----------
            Three stacked strokes: wide soft gold glow, yellow mid stroke, bright
            core. The lit part is drawn with an exact partial Bézier whose end point
            IS the plane's anchor, so it always ends exactly at the plane. */}
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="sr-path" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#fde68a" stopOpacity="0" />
              <stop offset="45%" stopColor="#fde68a" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#fff7cc" stopOpacity="0.42" />
            </linearGradient>
          </defs>
          {/* Exact partial Bézier: no dash/arc-length mismatch on stretched viewports. */}
          {[{ color: '#f59e0b', width: 12, opacity: 0.22 },
            { color: '#fde047', width: 4.5, opacity: 0.5 },
            { color: '#fffbeb', width: 1.75, opacity: 0.85 }].map((stroke) => (
            <path key={stroke.color} d={flightPath(progress, { left, top })} fill="none"
              stroke={stroke.color} strokeWidth={stroke.width}
              strokeOpacity={progress === 0 ? 0 : crashed ? stroke.opacity * 0.4 : stroke.opacity}
              strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        {/* ---------- 5. Exhaust puffs left behind on the flown path ----------
            Positions are pure functions of the SERVER multiplier, so the trail
            literally grows behind the plane as the multiplier rises. */}
        {FLIGHT_TRAIL.map((puff, i) => {
          const point = travel - puff.back;
          if (!thrusting || point <= 0.002) return null;
          const spot = scenePoint(point);
          const jitter = ((i % 3) - 1) * 0.25;
          return (
            <span
              key={`flight-puff-${i}`}
              className={`sr-puff pointer-events-none absolute z-10 block rounded-full blur-[4px] ${
                puff.hot ? 'bg-orange-300/60' : 'bg-slate-300/35'
              }`}
              style={
                {
                  left: `${spot.left + jitter}%`,
                  top: `${spot.top - jitter}%`,
                  width: puff.size,
                  height: puff.size,
                  animationDelay: `${puff.d}ms`,
                  '--sr-o': puff.o,
                } as CSSProperties
              }
              aria-hidden
            />
          );
        })}

{/* ---------- 6. Ground + runway pad (recedes as the plane climbs) ---------- */}
        <div
          className="sr-ground pointer-events-none absolute inset-0 z-10"
          style={{
            transform: `translate3d(0, ${padSink}%, 0)`,
            opacity: padOpacity,
          }}
          aria-hidden
        >
          {/* Cloud-deck floor: a soft white haze bank along the bottom edge (the
              reference's sky is cloud-heavy at the horizon) instead of a dark
              night band, so nothing muddy sits under the day sky. */}
          <div className="absolute inset-x-0 bottom-0 h-[22%] bg-gradient-to-t from-white/85 via-white/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-[13%] h-px bg-white/70" />
          {/* Runway strip + edge lights. */}
          <div className="absolute bottom-[12%] left-[4%] h-1.5 w-[15%] rounded-full bg-slate-400/55" />
          <div className="absolute bottom-[10.5%] left-[5%] flex w-[13%] justify-between">
            {RUNWAY_LIGHTS.map((on, i) => (
              <span
                key={`rwy-${i}`}
                className={`block h-1 w-1 rounded-full ${on ? 'bg-amber-400/95' : 'bg-amber-400/45'}`}
              />
            ))}
          </div>
          {/* Windsack pole. */}
          <div className="absolute bottom-[13%] left-[1.5%] h-[24%] w-1.5 rounded bg-slate-400/50" />
          <div className="absolute bottom-[36%] left-[0.5%] h-1 w-6 rounded bg-slate-400/50" />
          {/* Runway haze while the round is not running. */}
          {!thrusting ? (
            <div className="absolute bottom-[12%] left-[3%] h-3 w-24 animate-pulse rounded-full bg-white/70 blur-md" />
          ) : null}
          {/* Lift-off smoke burst during the first moments of the climb. */}
          {thrusting && sawBettingRef.current && progress < 0.12 ? (
            <>
              <span className="sr-launch absolute left-[10%] top-[80%] block h-10 w-10 rounded-full bg-white/60 blur-md" />
              <span
                className="sr-launch absolute left-[10%] top-[80%] block h-14 w-14 rounded-full bg-white/45 blur-lg"
                style={{ animationDelay: '140ms' }}
              />
            </>
          ) : null}
        </div>

{/* ---------- 7. AIRPLANE — position derived from the SERVER multiplier ----------
            Rendered for BETTING / RUNNING / CASHED_OUT only: a CRASHED round
            renders NO plane on ANY render, including the very first crashed
            event, so a refresh / reconnect / remount can never reveal a plane
            beside the fireball.
            The position layer owns only translation; centering, pitch and local
            animation are descendants. No CSS easing delays impact alignment. */}
        {showPlane ? (
          <div
            className="pointer-events-none absolute inset-0 z-30"
            style={{ transform: `translate3d(${left}%, ${top}%, 0)` }}
            data-flight-position
          >
            <div className="absolute left-0 top-0" style={{ transform: 'translate(-50%, -50%)' }}>
            {/* Flight pitch (measured from the scene box) + acceleration scale.
                The airplane is drawn nose-RIGHT, so NEGATE the pitch to climb
                nose-up (CSS rotate is clockwise-positive). */}
            <div
              style={{
                transform: `rotate(${-pitchDeg}deg) scale(${planeScale})`,
              }}
            >
              {/* Local motion: idle bob while waiting, engine vibration under
                  thrust. No impact variant — the plane is unmounted instead. */}
              <div className={`relative ${thrusting ? 'sr-vibrate' : phase === 'BETTING' ? 'sr-vibrate-soft' : 'sr-bob'}`}>
                  {/* Motion-blur streak behind the tail (grows with the multiplier).
                      The plane is nose-RIGHT, so the streak sits LEFT of centre. */}
                  {thrusting ? (
                    <span
                      className="absolute left-0 top-1/2 block h-1.5 rounded-full"
                      style={{
                        width: 26 + 70 * travel,
                        transform: 'translate(-100%, -50%)',
                        background:
                          'linear-gradient(90deg, rgba(253,224,71,0) 0%, rgba(254,249,195,0.75) 100%)',
                        filter: 'blur(2px)',
                        opacity: 0.22 + 0.5 * travel,
                      }}
                      aria-hidden
                    />
                  ) : null}

                  {/* Engine glow behind the tail. */}
                  {!crashed ? (
                    <span
                      className="absolute left-0 top-1/2 block h-10 w-10 -translate-x-1/3 -translate-y-1/2 rounded-full bg-amber-400/50 blur-md"
                      style={{ opacity: 0.45 + 0.5 * progress }}
                      aria-hidden
                    />
                  ) : null}

                  {/* Exhaust puffs trailing from the tail (anchored at the tail). */}
                  {thrusting
                    ? EXHAUST.map((puff, i) => (
                        <span
                          key={`exhaust-${i}`}
                          className="sr-trail absolute left-0 top-1/2 block rounded-full bg-orange-200/60 blur-[3px]"
                          style={
                            {
                              width: puff.s,
                              height: puff.s,
                              boxShadow: '0 0 10px rgba(251,146,60,0.55)',
                              opacity: exhaustOpacity,
                              animationDelay: `${puff.d}ms`,
                              '--sr-tx': `${puff.tx}px`,
                              '--sr-ty': `${puff.ty}px`,
                            } as CSSProperties
                          }
                          aria-hidden
                        />
                      ))
                    : null}


                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- 8. CRASH - "FLIES AWAY" beat (z-30) ----------
            A LIVE crash this mount watched plays the 600ms fly-off: the ship
            above carries `.sr-fly-away` (a pure transform/opacity escape to the
            upper right; instant removal under reduced motion). The curve and HUD
            freeze at the server crash value and only a few speed-streaks remain
            where the plane fled. A mount that arrives already crashed (refresh /
            reconnect) renders no plane and no beat at all. */}
        {flyingAway ? (
          <div
            className="pointer-events-none absolute z-30"
            style={{ left: `${left}%`, top: `${top}%` }}
            aria-hidden
          >
            <span className="sr-fly-streak absolute left-0 top-0 block rounded-full" style={{ width: 64 }} />
            <span
              className="sr-fly-streak absolute left-0 top-0 block rounded-full"
              style={{ width: 40, animationDelay: '90ms', opacity: 0.5 }}
            />
            <span
              className="sr-fly-streak absolute left-0 top-0 block rounded-full"
              style={{ width: 28, animationDelay: '180ms', opacity: 0.35 }}
            />
          </div>
        ) : null}

        {/* ---------- 11. HUD: the big multiplier ----------
            Reference placement: the multiplier is a LARGE, unboxed number on the
            RIGHT of the sky, vertically centred on the flight area — clear of the
            take-off pad (left) and of the low horizon, so it never covers the plane
            at lift-off and never sits on a gradient. It is also the first
            `.tabular-nums` element in the scene, which the browser test reads.
            The status text is announced through the sr-only <p role="status">
            outside the scene instead of painted over the sky. */}
        <div
          className="sr-reference-hud pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
          aria-hidden
        >
          <div className="sr-reference-hud-stack">
            {crashed ? <p className="sr-reference-flew-away">FLEW AWAY!</p> : null}
            <p
              className={`sr-reference-multiplier text-5xl font-black leading-none tabular-nums ${
                crashed
                  ? 'text-red-400'
                  : cashedOut
                    ? 'text-emerald-300'
                    : 'text-white'
              }`}
            >
              {shown.toFixed(2)}×
            </p>
          </div>
        </div>
        {/* Betting countdown — display-only label, kept out of the artwork. */}
        {phase === 'BETTING' && secondsToClose != null ? (
          <p
            className="pointer-events-none absolute inset-x-0 bottom-2 z-50 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/85 drop-shadow-[0_1px_6px_rgba(6,28,60,0.55)] sm:text-[11px]"
            aria-hidden
          >
            Betting open · {secondsToClose}s
          </p>
        ) : null}
        {process.env.NODE_ENV === 'development' ? (
          <pre ref={debugRef} data-sr-debug aria-hidden
            className="pointer-events-none absolute bottom-2 right-2 z-50 max-w-[90%] whitespace-pre-wrap break-all rounded bg-black/70 p-2 text-[10px] text-emerald-200" />
        ) : null}
      </div>

      {/* Screen-reader status (outside role="img" so it is announced). Its text
          only changes when the SERVER round state changes. */}
      <p className="sr-only" role="status">
        {statusText}
      </p>
    </div>
  );
}
