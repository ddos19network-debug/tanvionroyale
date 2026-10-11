/**
 * TANVIONROYALE brand icon generator (dependency-free, Node >= 20).
 *
 * Rasterizes the SAME original TANVIONROYALE mark used by app/icon.svg,
 * public/logo-mark.svg and components/brand/logo.tsx into:
 *
 *   app/favicon.ico    — 16/32/48 px PNG-in-ICO frames (rounded badge)
 *   app/apple-icon.png — 180x180 full-bleed tile (iOS applies its own mask)
 *
 * Run:  pnpm --filter @tanvion-royale/web icons:generate   (or from apps/web:
 *       node scripts/generate-brand-icons.mjs && node scripts/generate-og-image.mjs)
 *
 * The generated binaries are committed; this script only needs to be re-run
 * when the brand geometry changes (see scripts/brand-geometry.mjs).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BADGE_RADIUS,
  inBadge,
  pixelColor,
} from './brand-geometry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..', 'app');

// === PART 2 (PNG/ICO encoders + generation) ===

/**
 * Render the badge at `size` px with 4x4 supersampling (anti-aliased edges).
 * Returns RGBA bytes (non-premultiplied).
 */
function render(size, { rounded }) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const step = 100 / size;
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      let inside = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (ix + (sx + 0.5) / SS) * step;
          const y = (iy + (sy + 0.5) / SS) * step;
          if (!inBadge(x, y, rounded ? BADGE_RADIUS : 0)) continue;
          inside++;
          const color = pixelColor(x, y);
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const idx = (iy * size + ix) * 4;
      if (inside > 0) {
        rgba[idx] = Math.round(r / inside);
        rgba[idx + 1] = Math.round(g / inside);
        rgba[idx + 2] = Math.round(b / inside);
      }
      rgba[idx + 3] = Math.round((inside / (SS * SS)) * 255);
    }
  }
  return rgba;
}

// --- Minimal PNG encoder (RGBA, filter 0) + ICO packer (PNG entries) --------

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

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
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

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirs = [];
  const blobs = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // width
    dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2); // palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    dirs.push(dir);
    blobs.push(png);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

// --- Generate ----------------------------------------------------------------

const faviconSizes = [16, 32, 48];
const favicon = buildIco(
  faviconSizes.map((size) => ({ size, png: encodePng(size, render(size, { rounded: true })) })),
);
writeFileSync(join(APP_DIR, 'favicon.ico'), favicon);
console.log(`wrote app/favicon.ico (${faviconSizes.join(', ')} px, ${favicon.length} bytes)`);

const appleSize = 180;
const apple = encodePng(appleSize, render(appleSize, { rounded: false }));
writeFileSync(join(APP_DIR, 'apple-icon.png'), apple);
console.log(`wrote app/apple-icon.png (${appleSize}x${appleSize}, ${apple.length} bytes)`);

