/**
 * TANVIONROYALE Open Graph image generator (dependency-free, Node >= 20).
 *
 * Renders app/opengraph-image.png (1200x630) — a static brand card with the
 * original TANVIONROYALE badge mark and a geometric TANVIONROYALE wordmark — used by the
 * Next.js metadata file convention for og:image / twitter:image.
 *
 * Generated as a committed static asset (instead of a runtime ImageResponse
 * route) so social-image generation is deterministic on every platform and
 * has zero build-time wasm/font dependencies. Regenerate after brand changes
 * with: pnpm --filter @tanvion-royale/web icons:generate
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WHITE,
  INK,
  GOLD_FROM,
  GOLD_TO,
  BLUE_FROM,
  BLUE_TO,
  inCrest,
  crestPixel,
} from './brand-geometry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..', 'app');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const SS = 2; // supersampling factor for anti-aliased edges

// ---------------------------------------------------------------------------
// Geometric wordmark glyphs (design space per glyph: height 100, variable
// width). Straight-line letterforms matching the badge monogram's weight, so
// the wordmark needs no font rendering. rects: [x1,y1,x2,y2]; quads: 4 points.
// ---------------------------------------------------------------------------
const GLYPHS = {
  N: {
    w: 64,
    rects: [
      [0, 0, 14, 100],
      [50, 0, 64, 100],
    ],
    quads: [
      [
        [14, 0],
        [28, 0],
        [64, 100],
        [50, 100],
      ],
    ],
  },
  E: {
    w: 56,
    rects: [
      [0, 0, 14, 100],
      [0, 0, 56, 14],
      [0, 43, 48, 57],
      [0, 86, 56, 100],
    ],
  },
  I: {
    w: 40,
    rects: [[0, 0, 40, 14], [13, 0, 27, 100], [0, 86, 40, 100]],
  },
  L: {
    w: 52,
    rects: [[0, 0, 14, 100], [0, 86, 52, 100]],
  },
  O: {
    w: 68,
    ring: { cx: 34, cy: 50, rOut: 34, rIn: 18 },
    fullRing: true,
  },
  R: {
    w: 68,
    rects: [[0, 0, 14, 100], [14, 0, 48, 14], [14, 43, 48, 57]],
    quads: [
      [[48, 0], [62, 14], [50, 43], [36, 43]],
      [[36, 57], [50, 57], [68, 100], [52, 100]],
    ],
  },
  V: {
    w: 68,
    quads: [
      [[0, 0], [16, 0], [34, 78], [24, 100]],
      [[52, 0], [68, 0], [44, 100], [34, 78]],
    ],
  },
  Y: {
    w: 68,
    quads: [
      [[0, 0], [16, 0], [34, 38], [28, 58]],
      [[52, 0], [68, 0], [40, 58], [34, 38]],
    ],
    rects: [[27, 48, 41, 100]],
  },
  X: {
    w: 64,
    quads: [
      [
        [0, 0],
        [16, 0],
        [64, 100],
        [48, 100],
      ],
      [
        [48, 0],
        [64, 0],
        [16, 100],
        [0, 100],
      ],
    ],
  },
  T: {
    w: 60,
    rects: [
      [0, 0, 60, 14],
      [23, 0, 37, 100],
    ],
  },
  G: {
    w: 68,
    ring: { cx: 34, cy: 50, rOut: 34, rIn: 17 },
    bar: { x0: 34, x1: 62, y0: 43, y1: 57 },
  },
  A: {
    w: 68,
    quads: [
      [
        [24, 0],
        [38, 0],
        [14, 100],
        [0, 100],
      ],
      [
        [30, 0],
        [44, 0],
        [68, 100],
        [54, 100],
      ],
    ],
    rects: [[10, 62, 58, 76]],
  },
  M: {
    w: 76,
    rects: [
      [0, 0, 14, 100],
      [62, 0, 76, 100],
    ],
    quads: [
      [
        [14, 0],
        [28, 0],
        [44, 62],
        [30, 62],
      ],
      [
        [48, 0],
        [62, 0],
        [46, 62],
        [32, 62],
      ],
    ],
  },
};

/** Lay out the single TANVIONROYALE wordmark: "TANVION" gold + "ROYALE" blue. */
function layoutWordmark() {
  const entries = [];
  let x = 0;
  const paletteFor = (index) => (index < 7 ? [GOLD_FROM, GOLD_TO] : [BLUE_FROM, BLUE_TO]);
  [...'TANVIONROYALE'].forEach((ch, index) => {
    const glyph = GLYPHS[ch];
    entries.push({ glyph, ox: x, palette: paletteFor(index) });
    x += glyph.w + 14;
  });
  return { entries, totalWidth: x - 14, height: 100 };
}

/** Vertical two-stop gradient for a wordmark glyph at design height gy. */
function glyphColor(palette, gy) {
  const t = Math.min(1, Math.max(0, gy / 100));
  const [from, to] = palette;
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function inRing(x, y, ring, bar) {
  const dx = x - ring.cx;
  const dy = y - ring.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > ring.rOut || d < ring.rIn) return false;
  if (bar && x >= bar.x0 && x <= bar.x1 && y >= bar.y0 && y <= bar.y1) return true;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return Math.abs(angle) >= 45;
}

function inGlyph(glyph, x, y) {
  if (glyph.rects) {
    for (const [x1, y1, x2, y2] of glyph.rects) {
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
    }
  }
  if (glyph.quads) {
    for (const quad of glyph.quads) {
      if (inConvexQuadLocal(x, y, quad)) return true;
    }
  }
  if (glyph.ring) {
    if (glyph.fullRing) {
      const dx = x - glyph.ring.cx;
      const dy = y - glyph.ring.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      return d <= glyph.ring.rOut && d >= glyph.ring.rIn;
    }
    return inRing(x, y, glyph.ring, glyph.bar);
  }
  return false;
}

function inConvexQuadLocal(x, y, quad) {
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

// === PART 2 (composition + PNG encoder) ===

/**
 * Evaluate the OG card color at design coordinates (x, y) in a 1200x630 space.
 * The background is always opaque ink; foreground layers are blended over it.
 */
function ogPixel(x, y) {
  // Layer 0: ink background.
  let r = INK[0];
  let g = INK[1];
  let b = INK[2];

  const blend = (color, alpha) => {
    r = color[0] * alpha + r * (1 - alpha);
    g = color[1] * alpha + g * (1 - alpha);
    b = color[2] * alpha + b * (1 - alpha);
  };

  // Decorative oversized ring watermark on the right (very subtle).
  {
    const dx = x - 950;
    const dy = y - 320;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 330 && d >= 240) blend(WHITE, 0.05);
  }

  // Circular TR crest (100-space crest scaled 2.4x, centered at 600,185).
  {
    const u = (x - 600) / 2.4 + 50;
    const v = (y - 185) / 2.4 + 50;
    if (inCrest(u, v)) {
      blend(crestPixel(u, v), 1);
    }
  }

  // Wordmark: TANVIONROYALE, height 110 at (61, 380).
  {
    const word = layoutWordmark();
    const s = 1.1;
    const gx = (x - 61) / s;
    const gy = (y - 380) / s;
    if (gy >= 0 && gy <= word.height) {
      for (const { glyph, ox, palette } of word.entries) {
        if (gx >= ox && gx <= ox + glyph.w && inGlyph(glyph, gx - ox, gy)) {
          blend(glyphColor(palette, gy), 1);
          break;
        }
      }
    }
  }

  // Gold -> blue gradient divider under the wordmark.
  {
    const bx0 = 61;
    const bx1 = 1139;
    const by0 = 512;
    const by1 = 526;
    if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
      const t = (x - bx0) / (bx1 - bx0);
      blend(
        [
          GOLD_FROM[0] + (BLUE_FROM[0] - GOLD_FROM[0]) * t,
          GOLD_FROM[1] + (BLUE_FROM[1] - GOLD_FROM[1]) * t,
          GOLD_FROM[2] + (BLUE_FROM[2] - GOLD_FROM[2]) * t,
        ],
        1,
      );
    }
  }

  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Render the card at OG_WIDTH x OG_HEIGHT with 2x supersampling. */
function renderOg() {
  const hiW = OG_WIDTH * SS;
  const hiH = OG_HEIGHT * SS;
  const hi = new Float64Array(hiW * hiH * 3);
  for (let py = 0; py < hiH; py++) {
    for (let px = 0; px < hiW; px++) {
      const [r, g, b] = ogPixel((px + 0.5) / SS, (py + 0.5) / SS);
      const i = (py * hiW + px) * 3;
      hi[i] = r;
      hi[i + 1] = g;
      hi[i + 2] = b;
    }
  }
  const rgba = Buffer.alloc(OG_WIDTH * OG_HEIGHT * 4);
  for (let y = 0; y < OG_HEIGHT; y++) {
    for (let x = 0; x < OG_WIDTH; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * hiW + (x * SS + sx)) * 3;
          r += hi[i];
          g += hi[i + 1];
          b += hi[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * OG_WIDTH + x) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

// --- Minimal PNG encoder (RGBA, filter 0) ------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Generate ----------------------------------------------------------------

const png = encodePng(OG_WIDTH, OG_HEIGHT, renderOg());
writeFileSync(join(APP_DIR, 'opengraph-image.png'), png);
console.log(`wrote app/opengraph-image.png (${OG_WIDTH}x${OG_HEIGHT}, ${png.length} bytes)`);

