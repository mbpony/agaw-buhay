#!/usr/bin/env node
/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  tools/fp-preview.js
   Renders one real first-person frame to a PNG so the raycaster
   can be inspected without a browser. It calls the ACTUAL
   Renderer.prototype.drawFirstPerson (not a copy) against a
   tiny software 2D context, then encodes the pixel buffer.

     node tools/fp-preview.js [stageId] [yawDeg] [out.png]
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const D = require('../core/data.js');
const LV = require('../core/level.js');
const { Sim } = require('../core/sim.js');
// render.js is a browser UMD: it reads these globals at load time, and picks
// its root from `self`, which Node lacks -- point it at global.
global.self = global;
global.ABAW_DATA = D;
global.ABAW_LEVEL = LV;
global.ABAW_AUDIO = { SFX: new Proxy({}, { get: () => () => {} }), init() {}, resume() {}, setVolume() {}, setMuted() {}, startAmbience() {}, stopAmbience() {}, setTension() {} };
const R = require('../client/render.js');

/* ---------- tiny PNG encoder ---------- */
const CT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CT[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td), 0); return Buffer.concat([l, td, c]); };
function png(w, h, px) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- software 2D context (the subset drawFirstPerson uses) ---------- */
function parseColor(c) {
  if (!c) return [0, 0, 0, 1];
  if (typeof c === 'object') return c;                       // gradient marker
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
  if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return [128, 128, 128, 1];
}
function makeCtx(W, H, buf) {
  const put = (x, y, r, g, b, a) => {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = buf[i] * (1 - a) + r * a; buf[i + 1] = buf[i + 1] * (1 - a) + g * a; buf[i + 2] = buf[i + 2] * (1 - a) + b * a; buf[i + 3] = 255;
  };
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, dpr: 1,
    setTransform() {}, save() {}, restore() {},
    createLinearGradient(x0, y0, x1, y1) { return { _g: 1, y0, y1, vert: Math.abs(x0 - x1) < 1, stops: [], addColorStop(o, c) { this.stops.push([o, parseColor(c)]); } }; },
    createRadialGradient() { return { _rad: 1, stops: [], addColorStop() {} }; },
    fillRect(x, y, w, h) {
      const a = this.globalAlpha;
      const col = this.fillStyle;
      if (col && col._rad) return;                            // vignette: skip in preview
      if (col && col._g) {
        for (let yy = Math.max(0, y | 0); yy < Math.min(H, y + h); yy++) {
          const t = col.vert ? Math.max(0, Math.min(1, (yy - col.y0) / Math.max(1, col.y1 - col.y0))) : 0;
          let c0 = col.stops[0][1], c1 = col.stops[col.stops.length - 1][1], tt = t;
          for (let i = 0; i < col.stops.length - 1; i++) if (t >= col.stops[i][0] && t <= col.stops[i + 1][0]) { c0 = col.stops[i][1]; c1 = col.stops[i + 1][1]; tt = (t - col.stops[i][0]) / Math.max(1e-6, col.stops[i + 1][0] - col.stops[i][0]); break; }
          const r = c0[0] + (c1[0] - c0[0]) * tt, g = c0[1] + (c1[1] - c0[1]) * tt, b = c0[2] + (c1[2] - c0[2]) * tt;
          for (let xx = Math.max(0, x | 0); xx < Math.min(W, x + w); xx++) put(xx, yy, r, g, b, a);
        }
        return;
      }
      const c = parseColor(col);
      for (let yy = Math.max(0, y | 0); yy < Math.min(H, y + h); yy++)
        for (let xx = Math.max(0, x | 0); xx < Math.min(W, x + w); xx++) put(xx, yy, c[0], c[1], c[2], a * (c[3] === undefined ? 1 : c[3]));
    },
    _path: [],
    beginPath() { this._path = []; },
    ellipse(x, y, rx, ry) { this._path.push({ x, y, rx, ry }); },
    arc(x, y, r) { this._path.push({ x, y, rx: r, ry: r }); },
    fill() {
      const c = parseColor(this.fillStyle), a = this.globalAlpha * (c[3] === undefined ? 1 : c[3]);
      for (const e of this._path) for (let yy = Math.floor(e.y - e.ry); yy <= e.y + e.ry; yy++) for (let xx = Math.floor(e.x - e.rx); xx <= e.x + e.rx; xx++) {
        const nx = (xx - e.x) / Math.max(1e-6, e.rx), ny = (yy - e.y) / Math.max(1e-6, e.ry);
        if (nx * nx + ny * ny <= 1) put(xx, yy, c[0], c[1], c[2], a);
      }
      this._path = [];
    },
    moveTo(x, y) { this._lx = x; this._ly = y; },
    lineTo(x, y) {
      const c = parseColor(this.strokeStyle), a = this.globalAlpha;
      const steps = Math.max(1, Math.hypot(x - this._lx, y - this._ly) | 0);
      for (let i = 0; i <= steps; i++) { const t = i / steps; put(this._lx + (x - this._lx) * t, this._ly + (y - this._ly) * t, c[0], c[1], c[2], a); }
      this._lx = x; this._ly = y;
    },
    stroke() {}
  };
  return ctx;
}

/* ---------- build a world and shoot one frame ---------- */
const stageId = process.argv[2] || '1-1';
const yawDeg = parseFloat(process.argv[3] || '0');
const out = process.argv[4] || 'fp-preview.png';
const stage = D.stageById(stageId) || D.STAGES[0];
const lvl = LV.generate(stage);
const sim = new Sim({ stage, level: lvl, difficulty: 'normal', seed: 7 });
D.SURVIVOR_ORDER.forEach((h, i) => sim.addSurvivor({ id: 'p' + i, name: 'P' + i, hero: h, isBot: i > 0 }));
for (let i = 0; i < 60 * 20; i++) sim.update(1 / 60, {});      // let enemies spawn & approach
const snap = sim.snapshot();

const W = 640, H = 360;
const buf = Buffer.alloc(W * H * 4);
const ctx = makeCtx(W, H, buf);
const me = sim.survivors[0];
const Rend = R.Renderer || global.ABAW_RENDER.Renderer;
const self = Object.create(Rend.prototype);
Object.assign(self, {
  w: W, h: H, dpr: 1, tier: 'high', youId: 'p0', yaw: yawDeg * Math.PI / 180,
  level: lvl, zbuf: null, fpBob: 0, fpMuzzle: 0, fpMoving: true,
  cam: { x: me.x, y: me.y }, breakByN: sim.breaks, opts: {}
});
const ents = { surv: snap.surv, en: snap.en, it: snap.it, tr: snap.tr, pr: snap.pr, hz: snap.hz, cp: snap.cp };
Rend.prototype.drawFirstPerson.call(self, ctx, ents, 1 / 60, snap);
fs.writeFileSync(path.join(__dirname, '..', out), png(W, H, buf));
console.log('wrote ' + out + '  (' + W + 'x' + H + ')  yaw=' + yawDeg + 'deg  enemies=' + snap.en.length + ' at ' + Math.round(me.x) + ',' + Math.round(me.y));
