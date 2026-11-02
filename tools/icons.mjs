/**
 * Generates the home-screen / favicon art: three hexes on the sea.
 *
 * Run with `npm run icons`. Writes straight into `public/`, which Vite copies
 * to the site root, so the manifest can reach them at `./icon-192.png` and so on.
 *
 * PNG is written by hand (zlib is in Node, an image library is not), which keeps
 * this repo free of binary art nobody can diff. Shapes are drawn into a 4x
 * supersampled buffer and boxed back down, so the hex edges stay smooth.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Sea behind the island, top colour to bottom colour. */
const SKY = [0x1c, 0x5b, 0x9c];
const DEEP = [0x06, 0x1d, 0x38];

/** The three hexes, drawn in this order. Colours come from the art pack. */
const HEXES = [
  { dx: -0.5, dy: -0.75, fill: [0x3a, 0xa3, 0x55], rim: [0x12, 0x51, 0x27] }, // wood
  { dx: 0.5, dy: -0.75, fill: [0xe6, 0xc5, 0x4a], rim: [0x8f, 0x66, 0x0e] }, // grain
  { dx: 0, dy: 0.75, fill: [0xd4, 0x66, 0x3a], rim: [0x75, 0x2c, 0x16] }, // brick
];

const SS = 4; // supersampling factor
const ROOT3 = Math.sqrt(3);

/** Pointy-top hexagon, matching the board tiles. */
function hexPoints(cx, cy, r) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Renders one icon.
 *
 * `cover` is how much of the square the hex cluster fills. Maskable icons get a
 * smaller number, because Android crops anything outside the middle 80%.
 */
function render(size, cover) {
  const w = size * SS;
  const buf = new Uint8Array(w * w * 3);

  // The cluster is 3.5 radii tall, so that is what `cover` divides.
  const r = (w * cover) / 3.5;
  const mid = w / 2;
  const shapes = HEXES.map((h) => ({
    ...h,
    outer: hexPoints(mid + h.dx * ROOT3 * r, mid + h.dy * r, r),
    inner: hexPoints(mid + h.dx * ROOT3 * r, mid + h.dy * r, r * 0.9),
  }));

  for (let y = 0; y < w; y++) {
    const t = y / (w - 1);
    const bg = [0, 1, 2].map((c) => Math.round(SKY[c] + (DEEP[c] - SKY[c]) * t));
    for (let x = 0; x < w; x++) {
      let px = bg;
      for (const s of shapes) {
        if (!inside(s.outer, x + 0.5, y + 0.5)) continue;
        px = inside(s.inner, x + 0.5, y + 0.5) ? s.fill : s.rim;
      }
      const i = (y * w + x) * 3;
      buf[i] = px[0];
      buf[i + 1] = px[1];
      buf[i + 2] = px[2];
    }
  }

  // Box-filter back down to the real size.
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * w + (x * SS + sx)) * 3;
          acc[0] += buf[i];
          acc[1] += buf[i + 1];
          acc[2] += buf[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(acc[c] / (SS * SS));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Minimal PNG writer: 8-bit truecolour, one IDAT, no interlacing.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = none) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * 3 + 1);
    raw[at] = 0;
    Buffer.from(rgb.subarray(y * size * 3, (y + 1) * size * 3)).copy(raw, at + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */

/** The same three hexes as vector, for browsers that take an SVG favicon. */
function favicon() {
  const r = 28;
  const hex = (dx, dy, fill, rim) => {
    const pts = hexPoints(50 + dx * ROOT3 * r, 50 + dy * r, r)
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    const hx = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return `<polygon points="${pts}" fill="${hx(fill)}" stroke="${hx(rim)}" stroke-width="${(r * 0.2).toFixed(1)}" stroke-linejoin="round"/>`;
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1c5b9c"/><stop offset="1" stop-color="#061d38"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#s)"/>` +
    HEXES.map((h) => hex(h.dx, h.dy, h.fill, h.rim)).join('') +
    `</svg>`
  );
}

const FILES = [
  ['favicon-32.png', 32, 0.78],
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  // Android crops to the middle 80%, so the cluster has to sit well inside.
  ['icon-maskable-512.png', 512, 0.6],
];

for (const [name, size, cover] of FILES) {
  writeFileSync(join(OUT, name), png(size, render(size, cover)));
  console.log(`${name}  ${size}x${size}`);
}

writeFileSync(join(OUT, 'favicon.svg'), favicon());
console.log('favicon.svg');
