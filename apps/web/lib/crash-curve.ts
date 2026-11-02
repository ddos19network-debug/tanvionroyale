/**
 * Sky Rocket — pure multiplier → scene geometry (no React, no DOM, no clock).
 *
 * This is the SINGLE source of truth for how a server-authoritative multiplier
 * maps to a point on the flight curve. Both the drawn curve and the plane
 * position derive from it, so the artwork can never disagree with the number the
 * server reported. There is deliberately no separate client clock anywhere in
 * here: every function is a pure mapping of the multiplier it is handed (which
 * the scene only ever feeds from the server snapshot / eased server samples).
 *
 * Guarantees relied upon by the tests and the UX spec:
 *   - monotonic: a larger multiplier never moves the point backwards, so a
 *     reconnect mid-flight (the multiplier can only grow) never jumps;
 *   - clamped: the returned point always stays inside the scene box;
 *   - finite: an invalid multiplier (NaN / < 1) falls back to the launch pad
 *     instead of producing a NaN transform.
 */

export interface ScenePoint {
  /** Percent of the scene width from the left (0–100). */
  left: number;
  /** Percent of the scene height from the TOP (0–100). */
  top: number;
}

export interface ScenePointPx {
  /** Pixels from the left of the scene box. */
  x: number;
  /** Pixels from the top of the scene box. */
  y: number;
}

export interface SceneSize {
  width: number;
  height: number;
}

/** Launch pad anchor: x% from the left, y% of height measured from the BOTTOM. */
export const PAD: ScenePoint = { left: 16, top: 80 }; // top% (from top) = 100 - 20
/** End of the climb — the plane's high-multiplier parking spot, upper right. */
export const APEX: ScenePoint = { left: 88, top: 12 }; // top% = 100 - 88
/** Bézier control point (in % , bottom-referenced then converted). */
const CTRL_LEFT = 62;
const CTRL_BOTTOM = 22;

/** Quadratic Bézier component value at t. */
function bezier(t: number, p0: number, p1: number, p2: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** Curve point (left%, top%) at Bézier parameter t (0 = pad, 1 = apex). */
function curvePointAtT(t: number): ScenePoint {
  return {
    left: bezier(t, PAD.left, CTRL_LEFT, APEX.left),
    top: 100 - bezier(t, 100 - PAD.top, CTRL_BOTTOM, 100 - APEX.top),
  };
}

/**
 * Arc-length re-parametrisation so plane speed is constant along the path and
 * the SVG trail (pathLength=1 + dasharray=progress) always ends at the plane.
 * Deterministic and module-level (SSR-safe): every lookup is a binary search.
 */
const ARC_SAMPLES = 96;
const ARC = (() => {
  const pts: { t: number; len: number }[] = [{ t: 0, len: 0 }];
  let prev = curvePointAtT(0);
  let total = 0;
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    const p = curvePointAtT(t);
    total += Math.hypot(p.left - prev.left, p.top - prev.top);
    pts.push({ t, len: total });
    prev = p;
  }
  return { pts, total };
})();

/** Bézier parameter at arc-length fraction `s` (0–1). */
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

/**
 * Multiplier → flight progress (0 at 1.00×, →1 at the apex).
 *
 * `1 - exp(-k·ln(m)^1.4)` is strictly monotonic in the multiplier and keeps
 * short rounds (1×–2×, ~2 s) visibly travelling while very high multipliers
 * creep towards the apex instead of freezing (1.2× ≈ .07, 3× ≈ .60, 10× ≈ .92).
 */
export function rocketProgress(multiplier: number): number {
  const safe = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
  return Math.min(1, Math.max(0, 1 - Math.exp(-0.8 * Math.pow(Math.log(safe), 1.4))));
}

/** Scene point (percent) on the curve for a given flight progress. */
export function scenePoint(progress: number): ScenePoint {
  const t = curveParameter(progress);
  return curvePointAtT(t);
}

/** Multiplier → scene point (percent) in one step. */
export function rocketPosition(multiplier: number): ScenePoint {
  return scenePoint(rocketProgress(multiplier));
}

/**
 * Tangent (scene %, top-based) at arc-length fraction `s` — finite difference.
 * Used by the scene to pitch the ship along the curve.
 */
export function curveTangentAt(s: number): { dx: number; dy: number } {
  const eps = 0.008;
  const a = scenePoint(Math.max(0, s - eps));
  const b = scenePoint(Math.min(1, s + eps));
  return { dx: b.left - a.left, dy: b.top - a.top };
}

/**
 * SVG path for the lit flight trail, bottom-referenced for the scene's
 * `viewBox="0 0 100 100"` overlay. De Casteljau subdivision makes the stroke end
 * exactly at the rendered ship anchor, so the trail never over/undershoots it.
 */
export function flightPath(progress: number, endPoint?: ScenePoint): string {
  const t = curveParameter(progress);
  const end = endPoint ?? scenePoint(progress);
  // De Casteljau: the sub-curve from the pad to the ship is itself a quadratic
  // Bézier whose control point is the lerp of the pad and the main control point
  // (both bottom-referenced here, then converted to the overlay's top-based y).
  const cx = PAD.left + (CTRL_LEFT - PAD.left) * t;
  const padBottom = 100 - PAD.top;
  const cyBottom = padBottom + (CTRL_BOTTOM - padBottom) * t;
  const cy = 100 - cyBottom;
  return `M ${PAD.left} ${PAD.top} Q ${cx} ${cy} ${end.left} ${end.top}`;
}

/**
 * Pure multiplier → scene point in PIXELS, clamped inside the scene.
 *
 * `zoom` (default 1) applies the "zoom-out" feel: as the flight grows the axes
 * rescale, modelled here as a vertical stretch toward the apex so the curve
 * keeps filling the scene at high multipliers without the ship leaving it.
 *
 * Monotonic + clamped + NaN-safe: safe to call on every server sample and to
 * recompute from scratch on a reconnect with no visual jump.
 */
export function multiplierToScenePoint(
  multiplier: number,
  sceneSize: SceneSize,
  zoom = 1,
): ScenePointPx {
  const progress = rocketProgress(multiplier);
  const p = scenePoint(progress);
  // Apply the vertical zoom around the launch pad, then clamp inside the box.
  const zoomedTop = PAD.top + (p.top - PAD.top) * zoom;
  const leftPct = Math.min(100, Math.max(0, p.left));
  const topPct = Math.min(100, Math.max(0, zoomedTop));
  const w = Number.isFinite(sceneSize.width) && sceneSize.width > 0 ? sceneSize.width : 0;
  const h = Number.isFinite(sceneSize.height) && sceneSize.height > 0 ? sceneSize.height : 0;
  return { x: (leftPct / 100) * w, y: (topPct / 100) * h };
}
