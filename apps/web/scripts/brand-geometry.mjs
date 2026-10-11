/**
 * Shared TANVIONROYALE brand geometry (design space: 100x100 for the crest mark).
 *
 * Used by scripts/generate-brand-icons.mjs (favicon.ico, apple-icon.png) and
 * scripts/generate-og-image.mjs (opengraph-image.png) so every generated
 * raster matches the SVG sources (app/icon.svg, public/logo-mark.svg,
 * components/brand/logo.tsx) exactly.
 *
 * Brand mark: a circular crest — outer gold ring, inner royal-blue ring and a
 * dark navy disc carrying the interlocked gold "T" + blue "R" monogram of the
 * original TANVIONROYALE artwork.
 */

// Tile corner radius for ICO tiles (0 = full bleed, used for the apple icon).
export const BADGE_RADIUS = 24;

// Gold (outer ring + "T" monogram).
export const GOLD_FROM = [255, 216, 94]; // #ffd85e
export const GOLD_TO = [178, 132, 24]; // #b28418
// Royal blue (inner ring + "R" monogram).
export const BLUE_FROM = [56, 189, 248]; // #38bdf8
export const BLUE_TO = [29, 78, 216]; // #1d4ed8
// Crest disc and tile background.
export const NAVY_FROM = [18, 38, 82]; // #12264e
export const NAVY_TO = [6, 14, 32]; // #060e20
export const TILE_BG = [4, 8, 18]; // near-black outside the crest
export const WHITE = [255, 255, 255];
export const INK = [6, 13, 26]; // OG card background

export const CREST_CENTER = [50, 50];
export const R_GOLD_OUT = 50; // outer edge of the gold ring
export const R_GOLD_IN = 45.5; // gold/blue boundary
export const R_BLUE_IN = 41.5; // inner edge of the blue ring

// --- Monogram geometry (all points inside the inner disc, r <= 41.5) --------
// "T" (gold): top bar + center stem.
export const T_BAR = { x0: 24, y0: 28, x1: 66, y1: 38 };
export const T_STEM = { x0: 42, y0: 28, x1: 53, y1: 72 };
// "R" (blue, drawn over the T): stem + top-half bowl annulus + slanted leg.
export const R_STEM = { x0: 57, y0: 38, x1: 66, y1: 72 };
export const R_BOWL = { cx: 66, cy: 47, rOut: 10, rIn: 4.5 };
export const R_LEG = [
  [63, 50],
  [74, 50],
  [79, 72],
  [68, 72],
];

export function inBadge(x, y, radius) {
  if (radius <= 0) return true;
  const r = radius;
  const cx = x < r ? r : x > 100 - r ? 100 - r : x;
  const cy = y < r ? r : y > 100 - r ? 100 - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

export function inConvexQuad(x, y, quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

function inRect(x, y, r) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Inside the circular crest (everything the crest artwork covers). */
export function inCrest(x, y) {
  const dx = x - CREST_CENTER[0];
  const dy = y - CREST_CENTER[1];
  return dx * dx + dy * dy <= R_GOLD_OUT * R_GOLD_OUT;
}

function lerp3(from, to, t) {
  const k = Math.min(1, Math.max(0, t));
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ];
}

function goldColor(x, y) {
  return lerp3(GOLD_FROM, GOLD_TO, (x + y) / 198);
}

function blueColor(x, y) {
  return lerp3(BLUE_FROM, BLUE_TO, (x + y) / 198);
}

function navyColor(x, y) {
  return lerp3(NAVY_FROM, NAVY_TO, (x + y) / 198);
}

function inR(x, y) {
  if (inRect(x, y, R_STEM)) return true;
  const dx = x - R_BOWL.cx;
  const dy = y - R_BOWL.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (y <= R_BOWL.cy && d <= R_BOWL.rOut && d >= R_BOWL.rIn) return true;
  return inConvexQuad(x, y, R_LEG);
}

function inT(x, y) {
  return inRect(x, y, T_BAR) || inRect(x, y, T_STEM);
}

/**
 * Color at a point INSIDE the circular crest; null outside it. Bands are
 * sampled from the outside in so ring edges stay crisp, and the blue R is
 * drawn over the gold T (interlocked monogram).
 */
export function crestPixel(x, y) {
  const dx = x - CREST_CENTER[0];
  const dy = y - CREST_CENTER[1];
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > R_GOLD_OUT) return null;
  if (d >= R_GOLD_IN) return goldColor(x, y); // outer gold ring
  if (d >= R_BLUE_IN) return blueColor(x, y); // inner royal-blue ring
  // Navy disc — the blue R sits on top of the gold T.
  if (inR(x, y)) return blueColor(x, y);
  if (inT(x, y)) return goldColor(x, y);
  return navyColor(x, y);
}

/**
 * Color at any point of the icon tile (the rounded-rect/full-bleed mask is
 * handled by the renderer): near-black background with the circular crest
 * inscribed, mirroring the original artwork.
 */
export function pixelColor(x, y) {
  return crestPixel(x, y) ?? TILE_BG;
}