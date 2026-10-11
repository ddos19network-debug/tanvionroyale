'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { CrashHistoryEntry } from '@/lib/api/crash';

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
 *   2. the crash-sequence stage timer, which only decides how long the explosion
 *      layers stay on screen before settling into the frozen crash aftermath
 *      (presentation only).
 * Neither can influence the round, the multiplier, settlement or the wallet.
 *
 * VEHICLE: a cartoon side-view AIRPLANE rendered from the trimmed transparent
 * PNG asset `/sky-rocket-plane-trim.png`. It is derived from the original
 * `public/sky-rocket-plane.png` (733×418) by cropping the alpha bounding box
 * — source rect (124, 92, 494×180) — so the element box hugs the artwork and the
 * rotation pivot IS the visual centre. The airplane is drawn nose-RIGHT at rest
 * and is pitched by a clamped 6–14° along the curve.
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
 * CRASH VISUAL: the moment the backend reports CRASHED the plane is REMOVED —
 * no plane and no wreckage is rendered in ANY crashed render, the first one
 * included (so a refresh / reconnect / React remount can never flash one). The
 * layered fireball with three shockwave rings, ~18 fire particles, fire
 * fragments, lingering smoke and generic debris plays for a crash this mount
 * actually watched fly (shortened to 600ms for a reduced-motion user); a mount
 * that arrives already crashed (refresh / reconnect / route change) goes
 * straight to the FROZEN aftermath (smouldering glow,
 * static smoke plumes, generic debris, NO plane) so the explosion is never
 * replayed. The multiplier freezes at the server's crash value throughout. A NEW
 * round id resets the visual crash state, so the plane reappears at the launch
 * pad on the next round.
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
// Flight geometry — percentages of the SCENE BOX
// ---------------------------------------------------------------------------

/** Launch pad anchor: x% from the left, y% of the height measured from the
    BOTTOM. y=20 keeps the now reference-sized plane (96–260px wide, 35–95px
    tall) fully above the runway strip even on squat desktop flight areas
    (1366×768 → 590px scene) while still reading as "rolling on the runway". */
const PAD = { x: 16, y: 20 };
/** End of the climb — the plane's high-multiplier parking spot, upper right. */
const APEX = { x: 88, y: 88 };
/** Bézier control point. It pulls the path into a shallow take-off roll that
    steepens into a climb: tangent at the pad ≈ 10°, tangent at the apex ≈ 72°. */
const CTRL = { x: 62, y: 22 };

/** Quadratic Bézier component value at t. */
function bezier(t: number, p0: number, p1: number, p2: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/**
 * Arc-length table over the take-off curve (deterministic, module-level, SSR-safe).
 * 96 uniform-t samples are plenty for a <path>-matching position lookup and cost
 * nothing: every lookup is a binary search over a precomputed array.
 */
const ARC_SAMPLES = 96;
const ARC = (() => {
  const pts: { t: number; len: number }[] = [{ t: 0, len: 0 }];
  let prevX = PAD.x;
  let prevY = PAD.y;
  let total = 0;
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    const x = bezier(t, PAD.x, CTRL.x, APEX.x);
    const y = bezier(t, PAD.y, CTRL.y, APEX.y);
    total += Math.hypot(x - prevX, y - prevY);
    pts.push({ t, len: total });
    prevX = x;
    prevY = y;
  }
  return { pts, total };
})();

/** Point (scene %) at arc-length fraction `s` of the flight curve. */
function curveParameter(s: number): number {
  const clamped = Math.min(1, Math.max(0, s));
  const target = clamped * ARC.total;
  let lo = 0;
  let hi = ARC.pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ARC.pts[mid].len < target) lo = mid + 1;
    else hi = mid;
  }
  const after = ARC.pts[lo];
  const before = ARC.pts[Math.max(0, lo - 1)];
  const span = after.len - before.len || 1;
  const frac = Math.min(1, Math.max(0, (target - before.len) / span));
  return before.t + (after.t - before.t) * frac;
}

function curvePointAt(s: number): { left: number; top: number } {
  const t = curveParameter(s);
  return {
    left: bezier(t, PAD.x, CTRL.x, APEX.x),
    top: 100 - bezier(t, PAD.y, CTRL.y, APEX.y),
  };
}

/** De Casteljau subdivision makes the stroke end exactly at the rendered plane. */
function flightPath(progress: number, endPoint?: { left: number; top: number }): string {
  const t = curveParameter(progress);
  const end = endPoint ?? curvePointAt(progress);
  const cx = PAD.x + (CTRL.x - PAD.x) * t;
  const cy = 100 - (PAD.y + (CTRL.y - PAD.y) * t);
  return `M ${PAD.x} ${100 - PAD.y} Q ${cx} ${cy} ${end.left} ${end.top}`;
}

/** Tangent (scene %, top-based) at arc-length fraction `s` — finite difference. */
function curveTangentAt(s: number): { dx: number; dy: number } {
  const eps = 0.008;
  const a = curvePointAt(Math.max(0, s - eps));
  const b = curvePointAt(Math.min(1, s + eps));
  return { dx: b.left - a.left, dy: b.top - a.top };
}

/**
 * Multiplier → flight progress (0 at 1.00×, →1 at the end of the curve).
 *
 * Returns an ARC-LENGTH fraction, so plane speed is constant along the curve and
 * the SVG trail (pathLength=1 + dasharray=progress) always ends exactly at the
 * plane. `1 - 1/m` is monotonic in the SERVER multiplier and keeps common short
 * rounds (1×–2×, ~2 s) visibly travelling — a purely logarithmic mapping left
 * them parked. A small logarithmic term keeps very high multipliers creeping
 * towards the apex instead of freezing there (2× ≈ 0.46, 3× ≈ 0.63, 10× ≈ 0.93).
 */
export function rocketProgress(multiplier: number): number {
  // Smooth launch acceleration, then bounded upper-atmosphere travel. No clock:
  // 1.2x ≈ .07, 3x ≈ .60, 10x ≈ .92. Invalid values cannot create NaN transforms.
  const safe = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
  return Math.min(1, Math.max(0, 1 - Math.exp(-0.8 * Math.pow(Math.log(safe), 1.4))));
}

/** Scene point (percent) on the curve for a given flight progress. */
function scenePoint(progress: number): { left: number; top: number } {
  return curvePointAt(progress);
}

/** Convenience for tests/debug: multiplier → scene point in one step. */
export function rocketPosition(multiplier: number): { left: number; top: number } {
  return scenePoint(rocketProgress(multiplier));
}

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

/** Fire particles thrown outward from the crash point (~18, per the brief). */
const FIRE_PARTICLES = [
  { tx: -46, ty: 18, d: 0, s: 3 }, { tx: 40, ty: 26, d: 40, s: 2 },
  { tx: -30, ty: -34, d: 80, s: 3 }, { tx: 34, ty: -40, d: 120, s: 2 },
  { tx: -58, ty: -6, d: 60, s: 4 }, { tx: 56, ty: 6, d: 100, s: 3 },
  { tx: -14, ty: 44, d: 150, s: 2 }, { tx: 16, ty: -52, d: 180, s: 3 },
  { tx: -40, ty: -22, d: 210, s: 2 }, { tx: 44, ty: -16, d: 240, s: 3 },
  { tx: -22, ty: -48, d: 270, s: 2 }, { tx: 26, ty: 40, d: 300, s: 3 },
  { tx: -70, ty: 26, d: 90, s: 2 }, { tx: 72, ty: 30, d: 130, s: 3 },
  { tx: -8, ty: -66, d: 160, s: 2 }, { tx: 10, ty: 54, d: 200, s: 3 },
  { tx: -52, ty: -44, d: 230, s: 2 }, { tx: 50, ty: -50, d: 280, s: 3 },
];

/** Bigger, softer fire fragments that break off the fireball. */
const FIRE_FRAGMENTS = [
  { tx: -34, ty: 14, d: 60, s: 10 }, { tx: 30, ty: 20, d: 120, s: 12 },
  { tx: -24, ty: -26, d: 200, s: 9 }, { tx: 26, ty: -30, d: 260, s: 11 },
  { tx: -44, ty: -8, d: 340, s: 8 }, { tx: 42, ty: 4, d: 400, s: 10 },
];

/** Smoke puffs that rise and expand after the blast. */
const SMOKE = [
  { tx: -30, ty: -26, d: 220, s: 2.6 }, { tx: 26, ty: -30, d: 280, s: 3 },
  { tx: -12, ty: -46, d: 360, s: 3.4 }, { tx: 38, ty: -8, d: 420, s: 2.8 },
  { tx: -44, ty: 2, d: 480, s: 2.7 }, { tx: 8, ty: -16, d: 540, s: 3.1 },
  { tx: -20, ty: -58, d: 600, s: 3.6 }, { tx: 22, ty: -40, d: 660, s: 3.2 },
];

/** Tumbling debris thrown from the impact. */
const DEBRIS = [
  { tx: -52, ty: 22, d: 40, w: 8, h: 6, c: 'bg-slate-300/80' },
  { tx: 48, ty: 30, d: 70, w: 6, h: 10, c: 'bg-slate-400/80' },
  { tx: -34, ty: -30, d: 110, w: 10, h: 4, c: 'bg-slate-200/80' },
  { tx: 30, ty: -38, d: 150, w: 5, h: 9, c: 'bg-slate-500/80' },
  { tx: -62, ty: -4, d: 190, w: 7, h: 7, c: 'bg-slate-300/80' },
  { tx: 60, ty: 8, d: 230, w: 9, h: 5, c: 'bg-fuchsia-300/70' },
  { tx: -16, ty: 38, d: 270, w: 6, h: 6, c: 'bg-slate-400/80' },
  { tx: 18, ty: -44, d: 310, w: 8, h: 8, c: 'bg-slate-200/70' },
  { tx: -46, ty: -40, d: 340, w: 5, h: 10, c: 'bg-slate-500/80' },
  { tx: 52, ty: -24, d: 380, w: 7, h: 6, c: 'bg-fuchsia-200/60' },
];

/** Static frozen-aftermath layers (no animation → also correct for reduced motion). */
const AFTERMATH_SMOKE = [
  { tx: -30, ty: -30, s: 30 }, { tx: 28, ty: -34, s: 34 }, { tx: -8, ty: -48, s: 38 },
  { tx: 40, ty: -10, s: 26 }, { tx: -46, ty: -6, s: 28 }, { tx: 12, ty: -20, s: 32 },
];
const AFTERMATH_DEBRIS = [
  { tx: -46, ty: 20 }, { tx: 44, ty: 26 }, { tx: -28, ty: -26 }, { tx: 26, ty: -32 },
  { tx: 8, ty: 30 }, { tx: -60, ty: 4 }, { tx: 56, ty: -6 }, { tx: -14, ty: -40 },
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

/* NOTE: the frozen aftermath intentionally contains NO plane wreckage — the spec
   requires the airplane to disappear completely at crash (only fire, smoke and
   generic debris remain visible). */

/**
 * Crash-sequence stage.
 *  - 'none':      normal launch / flight
 *  - 'playing':   the explosion is playing (started by a LIVE crash only)
 *  - 'aftermath': the frozen crashed state (also the stage the scene settles on
 *                 when it mounts while the round is already crashed, so a
 *                 refresh / reconnect never replays the explosion)
 */
type CrashStage = 'none' | 'playing' | 'aftermath';

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
   * Only thrusting matters here: a CRASHED round never renders a plane at all
   * (`showPlane`), so the old `|| exploding` term could never change the artwork
   * — and it kept the pitch (and therefore the containment guard) dependent on
   * state declared further down the component.
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

  // Explosion stage. Mounting while the round is ALREADY crashed starts in
  // 'aftermath', so refresh / reconnect / React remount never replay the blast.
  // The crash identity includes the round id so two consecutive rounds that
  // crash at the SAME multiplier still each play exactly once.
  const [crashStage, setCrashStage] = useState<CrashStage>(crashed ? 'aftermath' : 'none');
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
    // Only a crash this mount actually SAW the round fly into plays the blast.
    // Loading (or reconnecting / refreshing) into an already-crashed round goes
    // straight to the frozen aftermath — never a replayed explosion, never a plane.
    const watched = sawFlightRef.current;
    setCrashStage(watched ? 'playing' : 'aftermath');
  }, [crashed, crashMultiplier, roundId, reducedMotion]);

  useEffect(() => {
    if (crashStage !== 'playing') return;
    const timer = setTimeout(() => setCrashStage('aftermath'), reducedMotion ? 600 : 2600);
    return () => clearTimeout(timer);
  }, [crashStage, reducedMotion]);

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

  const exploding = crashStage === 'playing';
  const aftermath = crashStage === 'aftermath';
  // Keep the jet visible through the authoritative crash impact so the presentation
  // matches the supplied Aviator-style reference: burning jet + fire/smoke.
  const showPlane = true;

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
    ? `Crashed at ${shown.toFixed(2)}×`
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

                  {/* Cartoon airplane, side view, nose-RIGHT at rest — the trimmed
                      transparent PNG (public/sky-rocket-plane-trim.png) so the
                      element box hugs the artwork and it rotates around its real
                      centre. Width is viewport-led: clamp(120px, 18vw, 260px)
                      (see `.sr-plane` in app/sky-rocket-phase2.css) so the plane
                      occupies the same share of the flight area as in the
                      supplied reference on desktop AND on mobile. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- the plane
                      is positioned/rotated/scaled with CSS transforms and measured
                      in real pixels by the tests; next/image adds a wrapper element
                      that would break that geometry for no benefit (the asset is a
                      fixed-size local PNG with an alpha channel). */}
                  <img
                    src="/sky-rocket-reference-jet.png"
                    alt="Sky Rocket airplane"
                    className={`sr-plane sr-reference-jet relative block h-auto ${crashed ? 'sr-jet-burning' : ''}`}
                    draggable={false}
                  />
                  {crashed ? (
                    <span className="sr-jet-fire" aria-hidden>
                      <span className="sr-jet-fire-core" />
                      <span className="sr-jet-smoke sr-jet-smoke-a" />
                      <span className="sr-jet-smoke sr-jet-smoke-b" />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- 8. CRASH — effects surrounding the crash point (z-20) ----------
            Anchored at the SERVER crash position (the frozen crash multiplier, and
            while flying at the served multiplier), clipped by the scene's
            overflow-hidden so the explosion can never escape the game area.
            These render with NO plane — a crashed round never mounts one. */}
        {crashStage !== 'none' ? (
          <div
            className="pointer-events-none absolute z-20"
            style={{ left: `${left}%`, top: `${top}%` }}
            aria-hidden
          >
            {exploding ? (
              <>
                <span className="sr-impact-flare absolute left-0 top-0 block h-16 w-16 rounded-full bg-white" />
                {/* Layer 4 — soft outer glow, slowest. Sized so the peak fireball
                    (scale 2.3×, see sr-blast) stays inside a 390px-wide phone
                    scene instead of swallowing the whole sky. */}
                <span className="sr-blast-late absolute left-0 top-0 block h-44 w-44 rounded-full bg-orange-500/30 blur-2xl" />
                {/* Layer 3 — red/orange outer flame */}
                <span
                  className="sr-blast absolute left-0 top-0 block h-36 w-36 rounded-full bg-orange-600/45 blur-lg"
                  style={{ animationDelay: '40ms' }}
                />
                {/* Layer 2 — orange fireball */}
                <span
                  className="sr-blast absolute left-0 top-0 block h-32 w-32 rounded-full"
                  style={
                    {
                      background:
                        'radial-gradient(circle, #fff7d6 0%, #fbbf24 34%, #f97316 58%, rgba(239,68,68,0.4) 78%, rgba(239,68,68,0) 100%)',
                      animationDelay: '20ms',
                    } as CSSProperties
                  }
                />
                {/* A second, offset fireball puff so the blast is not a perfect circle */}
                <span
                  className="sr-blast-late absolute left-0 top-0 block h-24 w-24 rounded-full bg-amber-400/70 blur-md"
                  style={{ marginLeft: '-18px', marginTop: '-10px' }}
                />
                <span
                  className="sr-blast-late absolute left-0 top-0 block h-20 w-20 rounded-full bg-rose-500/60 blur-md"
                  style={{ marginLeft: '16px', marginTop: '12px', animationDelay: '220ms' }}
                />

                {/* Fire fragments thrown off the fireball */}
                {FIRE_FRAGMENTS.map((fragment, i) => (
                  <span
                    key={`fragment-${i}`}
                    className={`sr-fire-blob absolute left-0 top-0 block rounded-full ${
                      i % 2 === 0 ? 'bg-orange-400/80' : 'bg-amber-300/80'
                    } blur-[3px]`}
                    style={
                      {
                        width: fragment.s,
                        height: fragment.s,
                        animationDelay: `${fragment.d}ms`,
                        '--sr-tx': `${fragment.tx}px`,
                        '--sr-ty': `${fragment.ty}px`,
                      } as CSSProperties
                    }
                  />
                ))}

                {/* Shockwave — three rings in visibly separate pulses, plus one
                    soft blurred pressure wave. */}
                <span className="sr-ring absolute left-0 top-0 block h-24 w-24 rounded-full border-[3px] border-orange-100/90" />
                <span className="sr-ring-2 absolute left-0 top-0 block h-24 w-24 rounded-full border-2 border-amber-200/75" />
                <span className="sr-ring-3 absolute left-0 top-0 block h-24 w-24 rounded-full border border-orange-200/50 blur-[1px]" />
                <span className="sr-ring-2 absolute left-0 top-0 block h-20 w-20 rounded-full bg-white/15 blur-md" />
              </>
            ) : null}

            {/* Fire particles (~18) thrown outward from the impact. */}
            {exploding
              ? FIRE_PARTICLES.map((spark, i) => (
                  <span
                    key={`spark-${i}`}
                    className="sr-spark absolute left-0 top-0 block rounded-full"
                    style={
                      {
                        width: spark.s,
                        height: spark.s,
                        backgroundColor:
                          i % 3 === 0 ? '#fef3c7' : i % 3 === 1 ? '#fbbf24' : '#fb923c',
                        boxShadow: '0 0 6px rgba(251,146,60,0.9)',
                        animationDelay: `${spark.d}ms`,
                        '--sr-tx': `${spark.tx}px`,
                        '--sr-ty': `${spark.ty}px`,
                      } as CSSProperties
                    }
                  />
                ))
              : null}

            {/* Smoke — dark, rising, expanding, and it LINGERS (the keyframe ends
                at a small opacity so the aftermath does not blink out). */}
            {exploding
              ? SMOKE.map((puff, i) => (
                  <span
                    key={`smoke-${i}`}
                    className="sr-smoke absolute left-0 top-0 block h-12 w-12 rounded-full bg-slate-500/45 blur-md"
                    style={
                      {
                        animationDelay: `${puff.d}ms`,
                        '--sr-tx': `${puff.tx}px`,
                        '--sr-ty': `${puff.ty}px`,
                        '--sr-scale': puff.s,
                      } as CSSProperties
                    }
                  />
                ))
              : null}

            {/* Debris — scattered, rotating, falling. */}
            {exploding
              ? DEBRIS.map((bit, i) => (
                  <span
                    key={`debris-${i}`}
                    className={`sr-debris absolute left-0 top-0 block rounded-[1px] ${bit.c}`}
                    style={
                      {
                        width: bit.w,
                        height: bit.h,
                        animationDelay: `${bit.d}ms`,
                        '--sr-tx': `${bit.tx}px`,
                        '--sr-ty': `${bit.ty}px`,
                      } as CSSProperties
                    }
                  />
                ))
              : null}

            {/* Frozen crash aftermath — static (no animation), so it reads exactly
                the same for reduced-motion users, on refresh and after reconnect.
                Deliberately NO plane and NO wreckage: fire glow, smoke and generic
                debris only. */}
            {aftermath ? (
              <>
                {/* Smouldering glow at the crash point */}
                <span className="sr-aftermath-glow absolute left-0 top-0 block h-48 w-48 rounded-full bg-orange-700/25 blur-2xl" />
                <span className="sr-aftermath-glow absolute left-0 top-0 block h-24 w-24 rounded-full bg-amber-500/20 blur-xl" />
                <span className="sr-aftermath-glow absolute left-0 top-0 block h-10 w-10 rounded-full bg-red-500/25 blur-md" />
                {/* Static smoke plumes */}
                {AFTERMATH_SMOKE.map((puff, i) => (
                  <span
                    key={`after-smoke-${i}`}
                    data-sr-aftermath-smoke
                    className="absolute left-0 top-0 block rounded-full bg-slate-500/25 blur-md"
                    style={{
                      width: puff.s,
                      height: puff.s,
                      marginLeft: puff.tx,
                      marginTop: puff.ty,
                    }}
                  />
                ))}
                {/* Static scattered debris (generic — not plane parts) */}
                {AFTERMATH_DEBRIS.map((bit, i) => (
                  <span
                    key={`after-debris-${i}`}
                    data-sr-aftermath-debris
                    className="absolute left-0 top-0 block h-2 w-1.5 rounded-[1px] bg-slate-300/60"
                    style={{
                      transform: `translate(${bit.tx}px, ${bit.ty}px) rotate(${i * 47}deg)`,
                    }}
                  />
                ))}
              </>
            ) : null}
          </div>
        ) : null}

{/* ---------- 9. CRASH CORE — the white-hot centre of the blast (z-30).
            A crashed round mounts no plane, so from the very first crashed frame
            this is fire / smoke / debris ONLY — no plane silhouette remains. */}
        {exploding ? (
          <div className="pointer-events-none absolute z-30" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden>
            <span
              className="sr-blast absolute left-0 top-0 block h-16 w-16 rounded-full bg-white"
              style={{ animationDelay: '60ms' }}
            />
            <span className="sr-blast absolute left-0 top-0 block h-24 w-24 rounded-full bg-yellow-200/80 blur-sm" />
          </div>
        ) : null}

        {/* ---------- 10. Detonation flash across the whole scene ---------- */}
        {exploding ? (
          <span className="sr-flash pointer-events-none absolute inset-0 z-40 block bg-orange-50" aria-hidden />
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