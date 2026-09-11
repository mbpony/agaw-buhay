#!/usr/bin/env node
/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  tools/gen-icons.js
   Regenerates the PWA / home-screen icons from code.

   The game ships zero binary art assets: everything is drawn
   procedurally. The icons follow the same rule, so this script
   writes them out with a hand-rolled PNG encoder (zlib is in
   Node's stdlib) rather than checking in artwork.

     node tools/gen-icons.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- minimal PNG writer ---------- */
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // one filter byte (0 = None) per scanline
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- the artwork ---------- */
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex('#0b0e17'), BG_BOT = hex('#1d0a11');
const ACCENT = hex('#ff5a5f'), HOT = hex('#ffb02e');

/** distance from point p to segment ab, in the same units as p */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Draw the mark: a stylised "A" (Agaw) built from three strokes, with a glow,
 * over a vertical gradient and a corner vignette. `pad` keeps it inside the
 * safe area iOS/Android crop differently.
 */
function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  // All distances below are NORMALISED (0..1 across the icon), so the stroke
  // half-thickness is a fraction, not a pixel count.
  const stroke = 0.082;
  const u = size;                        // unit box for the glyph
  // glyph segments in normalised coords (y grows downward)
  const segs = [
    [0.235, 0.80, 0.500, 0.185],         // left leg
    [0.500, 0.185, 0.765, 0.80],         // right leg
    [0.335, 0.575, 0.665, 0.575]         // crossbar
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / u, ny = y / u;

      // background gradient + vignette
      const g = Math.min(1, Math.max(0, ny));
      let r = BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * g;
      let gg = BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * g;
      let b = BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * g;
      const vd = Math.hypot(x - cx, y - cy) / (size * 0.72);
      const vig = Math.min(1, Math.max(0, 1 - Math.pow(vd, 2.6) * 0.72));
      r *= vig; gg *= vig; b *= vig;

      // miasma glow rising from the bottom
      const rise = Math.max(0, 1 - Math.abs(ny - 0.92) * 2.4) * 0.16;
      r += ACCENT[0] * rise * 0.5; gg += ACCENT[1] * rise * 0.25; b += ACCENT[2] * rise * 0.25;

      // letter distance
      let d = Infinity;
      for (const s of segs) d = Math.min(d, segDist(nx, ny, s[0], s[1], s[2], s[3]));

      // outer glow
      const halo = Math.exp(-Math.max(0, d - stroke) / 0.075) * 0.5;
      r += ACCENT[0] * halo; gg += ACCENT[1] * halo * 0.55; b += ACCENT[2] * halo * 0.5;

      // the stroke itself, with a hot top edge
      if (d < stroke) {
        const edge = 1 - d / stroke;                       // 0 at rim, 1 at core
        const heat = Math.max(0, 1 - (ny - 0.18) / 0.62);  // hotter near the apex
        const mix = Math.pow(edge, 0.55);
        r = ACCENT[0] * mix + HOT[0] * heat * 0.55 * mix + r * (1 - mix);
        gg = ACCENT[1] * mix + HOT[1] * heat * 0.55 * mix + gg * (1 - mix);
        b = ACCENT[2] * mix + HOT[2] * heat * 0.30 * mix + b * (1 - mix);
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(gg)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[i + 3] = 255;   // always opaque: iOS paints transparency black
    }
  }
  return rgba;
}

const OUT = path.join(__dirname, '..', 'client');
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180]   // iOS home screen
];
for (const [name, size] of targets) {
  const png = encodePNG(size, size, draw(size));
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('  wrote client/' + name.padEnd(22) + size + 'x' + size + '  ' + (png.length / 1024).toFixed(1) + ' KB');
}
console.log('done');
