/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  client/render.js
   Procedural 2.5D renderer. Every pixel is drawn in code:
   first-person raycast view (the only view), billboard sprites, awareness cues,
   dynamic lighting, typhoon weather, gore decals and particles.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.ABAW_DATA, LV = root.ABAW_LEVEL, AU = root.ABAW_AUDIO;
  const HUDFONT = '"Arial Narrow", "Roboto Condensed", "Barlow Condensed", "Helvetica Neue", system-ui, sans-serif';
  const T = D.TILE;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  /* ============ procedural sprite cache ============ */
  function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ---------- TILE ATLAS ---------- */
  function drawTileVariant(kind, s, i, biome) {
    const c = cvs(s, s), x = c.getContext('2d');
    const r = (a, b) => a + Math.random() * (b - a);
    if (kind === 'road' || kind === 'floor') {
      const indoor = biome === 'station';
      x.fillStyle = indoor ? '#23262c' : '#2b2b2f';
      x.fillRect(0, 0, s, s);
      // grain
      for (let n = 0; n < s * 1.5; n++) {
        const px = Math.random() * s, py = Math.random() * s;
        x.fillStyle = 'rgba(' + (indoor ? '255,255,255,' : '190,186,175,') + (Math.random() * 0.05) + ')';
        x.fillRect(px, py, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      // stains
      for (let n = 0; n < 3; n++) {
        x.fillStyle = 'rgba(10,10,12,' + (0.05 + Math.random() * 0.13) + ')';
        x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, r(4, 15), r(3, 11), Math.random() * 3, 0, TAU); x.fill();
      }
      if (!indoor) {
        // asphalt cracks
        x.strokeStyle = 'rgba(14,14,16,.55)'; x.lineWidth = 1;
        x.beginPath(); let px = Math.random() * s, py = 0; x.moveTo(px, py);
        for (let k = 0; k < 4; k++) { px += r(-9, 9); py += s / 4; x.lineTo(px, py); }
        x.stroke();
        if (i === 2) { x.fillStyle = 'rgba(214,196,90,.16)'; x.fillRect(s * 0.42, 0, s * 0.14, s); } // lane paint
        if (i === 3) { // manhole
          x.fillStyle = '#1c1c20'; x.beginPath(); x.arc(s / 2, s / 2, s * 0.28, 0, TAU); x.fill();
          x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 2; x.stroke();
        }
      } else {
        // station floor tiles
        x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1;
        x.strokeRect(0.5, 0.5, s - 1, s - 1);
        if (i === 1) { x.fillStyle = 'rgba(255,206,80,.10)'; x.fillRect(0, s * 0.4, s, s * 0.2); } // tactile strip
        if (i === 3) { x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6); }
      }
    } else if (kind === 'water') {
      const g = x.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, biome === 'station' ? '#1b2a2c' : '#25301f');
      g.addColorStop(1, biome === 'station' ? '#14202a' : '#1d2419');
      x.fillStyle = g; x.fillRect(0, 0, s, s);
      for (let n = 0; n < 26; n++) {
        x.strokeStyle = 'rgba(180,210,220,' + (0.03 + Math.random() * 0.07) + ')';
        x.lineWidth = 1;
        x.beginPath();
        const yy = Math.random() * s; x.moveTo(0, yy);
        x.bezierCurveTo(s * .3, yy + r(-4, 4), s * .6, yy + r(-4, 4), s, yy + r(-3, 3));
        x.stroke();
      }
      for (let n = 0; n < 6; n++) { // floating debris
        x.fillStyle = 'rgba(60,52,38,.7)';
        x.save(); x.translate(Math.random() * s, Math.random() * s); x.rotate(Math.random() * 3);
        x.fillRect(-r(2, 6), -1, r(4, 12), r(2, 4)); x.restore();
      }
    } else if (kind === 'rubble') {
      x.fillStyle = '#33312c'; x.fillRect(0, 0, s, s);
      for (let n = 0; n < 9; n++) {
        const px = Math.random() * s, py = Math.random() * s, sz = r(3, 11);
        x.fillStyle = ['#4a4741', '#3b3934', '#575349', '#2e2c28'][n % 4];
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + sz, py + sz * .3); x.lineTo(px + sz * .6, py + sz); x.lineTo(px - sz * .2, py + sz * .7); x.closePath(); x.fill();
        x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(px, py + sz * .8, sz, 2);
      }
    } else if (kind === 'rail') {
      x.fillStyle = '#2a2723'; x.fillRect(0, 0, s, s);
      for (let n = 0; n < 4; n++) { x.fillStyle = '#3d362c'; x.fillRect(0, n * s / 4 + 2, s, s / 8); }
      x.fillStyle = '#6d6a63'; x.fillRect(s * 0.22, 0, s * 0.09, s); x.fillRect(s * 0.68, 0, s * 0.09, s);
      x.fillStyle = 'rgba(255,255,255,.10)'; x.fillRect(s * 0.22, 0, s * 0.03, s); x.fillRect(s * 0.68, 0, s * 0.03, s);
    } else if (kind === 'walltop') {
      x.fillStyle = i % 2 ? '#3c3f47' : '#43464e'; x.fillRect(0, 0, s, s);
      for (let n = 0; n < 40; n++) { x.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.10 + ')'; x.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, s - 1, s - 1);
      if (biome === 'station' && i === 1) { x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(0, 0, s, 3); }
      if (i === 3) { x.fillStyle = 'rgba(120,60,40,.18)'; x.beginPath(); x.arc(s * .6, s * .4, s * .3, 0, TAU); x.fill(); } // rust/water stain
    } else if (kind === 'block') {
      x.fillStyle = '#4b4a45'; x.fillRect(0, 0, s, s);
      x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, s * 0.7, s, s * 0.3);
      x.strokeStyle = 'rgba(255,255,255,.07)'; x.strokeRect(1.5, 1.5, s - 3, s - 3);
    }
    return c;
  }

  /* ============ RENDERER ============ */
  class Renderer {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.level = null;
      this.cam = { x: 0, y: 0, zoom: 1 };
      // first-person is the shipped view; flip to false to fall back to top-down
      this.fp = true;
      this.hurtDir = 0; this.hurtDirT = 0; this.ownPos = null;
      this.hitT = 0; this.hitCrit = false; this.spread = 6; this._pyaw = 0; this.yawVel = 0;
      this.yaw = 0; this.zbuf = null; this.fpBob = 0; this.fpMuzzle = 0; this.fpMoving = false;
      this.shake = 0; this.flash = 0; this.hurt = 0; this.time = 0;
      this.buf = []; this.prev = null; this.curr = null;
      this.localMode = false;
      this.opts = { shake: true, dmg: true, fps: false, quality: 1 };
      // Quality tiers scale every expensive effect. Mobile defaults to 'medium'
      // and drops to 'low' automatically if the frame budget is missed.
      this.TIERS = {
        low:    { dprCap: 1.0,  rain: 46,  fog: 5,  grain: 0,  lightScale: 0.34, fx: 0.45, decals: 150, glow: 0, shadows: 0 },
        medium: { dprCap: 1.5,  rain: 110, fog: 10, grain: 26, lightScale: 0.42, fx: 0.7,  decals: 300, glow: 1, shadows: 1 },
        high:   { dprCap: 2.0,  rain: 190, fog: 16, grain: 90, lightScale: 0.5,  fx: 1,    decals: 460, glow: 1, shadows: 1 }
      };
      this.tier = 'high';
      this.q = this.TIERS.high;
      this.frameMs = 16; this.slowFrames = 0;
      this.light = null; this.lightCtx = null;
      this.rain = []; this.fog = []; this.embers = [];
      this.wallH = 30;
      this.biome = 'avenue';
      this.stats = { fps: 0, draw: 0, ents: 0 };
      this._fAcc = 0; this._fCnt = 0;
      this.heroCache = new Map();
      this.resize();
      root.addEventListener('resize', () => this.resize());
    }
    /** 'low' | 'medium' | 'high' — rebuilds resolution-dependent buffers. */
    setTier(t) {
      if (!this.TIERS[t]) t = 'high';
      this.tier = t; this.q = this.TIERS[t];
      this.opts.quality = 1;
      this.resize();
    }
    /** Automatic downgrade when a device cannot hold ~45fps. Never upgrades. */
    autoTier(ms) {
      this.frameMs = this.frameMs * 0.9 + ms * 0.1;
      if (this.frameMs > 26) {
        this.slowFrames++;
        if (this.slowFrames > 90) {
          this.slowFrames = 0;
          if (this.tier === 'high') this.setTier('medium');
          else if (this.tier === 'medium') this.setTier('low');
        }
      } else if (this.frameMs < 18) this.slowFrames = Math.max(0, this.slowFrames - 2);
    }
    resize() {
      const dpr = Math.min(this.q.dprCap, root.devicePixelRatio || 1) * (this.opts.quality || 1);
      this.w = root.innerWidth; this.h = root.innerHeight;
      this.c.width = Math.max(1, Math.floor(this.w * dpr)); this.c.height = Math.max(1, Math.floor(this.h * dpr));
      this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px';
      this.dpr = dpr;
      this.light = cvs(Math.max(1, Math.ceil(this.w * this.q.lightScale)), Math.max(1, Math.ceil(this.h * this.q.lightScale)));
      this.lightCtx = this.light.getContext('2d');
      this.lightScale = this.light.width / Math.max(1, this.w);
    }
    setLevel(levelData) {
      this.level = LV.deserialize ? (levelData.grid instanceof Uint8Array ? levelData : LV.deserialize(levelData)) : levelData;
      /* Loot containers. The level carries their static placement; the snapshot
         only sends damage deltas (bk), keyed by this index. */
      this.breakByN = [];
      {
        const bl = (this.level && this.level.breakables) || [];
        for (let i = 0; i < bl.length; i++) {
          const b = bl[i], def = D.BREAKABLES[b.t] || {};
          this.breakByN.push({
            n: i, t: b.t, x: b.x, y: b.y, rot: b.rot || 0, seed: b.seed || 0,
            hp: 1, dead: false, r: def.r || 15, color: def.color || '#a9762f'
          });
        }
      }
      this.biome = this.level.biome;
      this.wallH = this.biome === 'station' ? 42 : this.biome === 'skyway' ? 20 : 34;
    }

    /* ---------- snapshot buffer + interpolation ---------- */
    push(snap, local) {
      const rt = performance.now();
      this.buf.push({ rt, snap, local: !!local });
      if (this.buf.length > 12) this.buf.shift();
      this.localMode = !!local;
    }
    sample(now) {
      if (!this.buf.length) return null;
      const delay = this.localMode ? 0 : 95;
      const target = now - delay;
      let a = this.buf[0], b = this.buf[this.buf.length - 1];
      for (let i = 0; i < this.buf.length - 1; i++) {
        if (this.buf[i].rt <= target && this.buf[i + 1].rt >= target) { a = this.buf[i]; b = this.buf[i + 1]; break; }
        if (this.buf[i + 1].rt < target) { a = this.buf[i + 1]; b = this.buf[i + 1]; }
      }
      const span = b.rt - a.rt;
      const t = span > 0.001 ? clamp((target - a.rt) / span, 0, 1) : 1;
      return { a: a.snap, b: b.snap, t };
    }
    static mixEnt(A, B, t) {
      if (!A) return B;
      const o = Object.assign({}, B);
      o.x = lerp(A.x, B.x, t); o.y = lerp(A.y, B.y, t);
      if (A.z !== undefined && B.z !== undefined) o.z = lerp(A.z, B.z, t);
      if (A.a !== undefined) o.a = lerpAngle(A.a, B.a, t);
      if (A.w !== undefined && B.w !== undefined) o.w = lerp(A.w, B.w, t);
      if (A.wk !== undefined && B.wk !== undefined) o.wk = lerp(A.wk, B.wk, t);
      return o;
    }
    mixList(A, B, t, key) {
      const out = [];
      const am = new Map(); (A || []).forEach(e => am.set(e[key], e));
      (B || []).forEach(e => { const a = am.get(e[key]); out.push(a ? Renderer.mixEnt(a, e, t) : e); if (a) am.delete(e[key]); });
      am.forEach(e => out.push(e));   // still show entities that just vanished (1 frame grace)
      return out;
    }

    /* ---------- main draw ---------- */
    draw(now, dt, extra) {
      if (!this.level) return;
      const s = this.sample(now);
      if (!s) return;
      const snap = s.b;
      const ents = {
        surv: this.mixList(s.a.surv, snap.surv, s.t, 'id'),
        en: this.mixList(s.a.en, snap.en, s.t, 'i'),
        tr: snap.tr, pr: snap.pr, hz: snap.hz, it: snap.it, cp: snap.cp
      };
      // phase 2: the local survivor is drawn at the CLIENT-PREDICTED position.
      // main.js integrates our movement every frame and reconcile() folds each
      // 24 Hz snapshot back in, so the view (and the FP raycast origin) reacts
      // on the input frame instead of a round trip later.
      if (!this.localMode && this.youId && this.predOwn) {
        const me = ents.surv.find(e => e.id === this.youId);
        if (me && !me.dd) { me.x = this.predOwn.x; me.y = this.predOwn.y; }
      }
      const ownE = this.youId ? ents.surv.find(e => e.id === this.youId) : null;
      this.ownPos = ownE && !ownE.dd ? { x: ownE.x, y: ownE.y } : null;
      if (snap.bk && this.breakByN) {
        for (const d of snap.bk) {
          const b = this.breakByN[d.n];
          if (b) { b.dead = d.h < 0; b.hp = d.h < 0 ? 0 : d.h / 100; }
        }
      }
      this.snap = snap; this.ents = ents;
      this.time += dt;
      this.consumeFx(snap);

      /* ---- camera: EVERY PLAYER GETS THEIR OWN ----
         snap.cam is the SQUAD camera the sim computes: it averages the position
         of every alive survivor and zooms out (down to 0.62) as they spread
         apart. Broadcasting that meant all four players watched one shared
         view, so anyone who split from the group drifted to the edge of the
         screen or off it completely -- you could not see your own character.
         Each client now centres on its own survivor. The sim camera is kept
         only for shake and as a fallback until we know who we are. */
      const c = snap.cam;
      const mine = this.youId ? ents.surv.find(e => e.id === this.youId) : null;
      let tx, ty;
      if (mine && !mine.dd) {
        // ents.surv already carries the predicted position for the local player
        tx = mine.x; ty = mine.y;
      } else if (mine) {
        // dead: follow the nearest living teammate rather than your own corpse
        let best = null, bd = Infinity;
        for (const q of ents.surv) {
          if (q.dd || q.id === mine.id) continue;
          const d = (q.x - mine.x) ** 2 + (q.y - mine.y) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
        tx = best ? best.x : mine.x; ty = best ? best.y : mine.y;
      } else {
        tx = c.x; ty = c.y;
      }
      // zoom from YOUR neighbourhood only -- the old formula used the whole
      // squad's spread, so one person running ahead zoomed everybody out
      let far = 0;
      for (const q of ents.surv) {
        if (q.dd || (mine && q.id === mine.id)) continue;
        const d = Math.hypot(q.x - tx, q.y - ty);
        if (d < 900 && d > far) far = d;
      }
      const tz = clamp(1.30 - far / 2400, 0.95, 1.30);
      const ease = this.localMode ? 1 : Math.min(1, dt * 22);
      this.cam.x = lerp(this.cam.x, tx, ease);
      this.cam.y = lerp(this.cam.y, ty, ease);
      this.cam.zoom = lerp(this.cam.zoom, tz, Math.min(1, dt * 6));
      this.shake = this.opts.shake ? c.sh : 0;

      // FP and top-down both publish the view rect (tests + culling rely on it)
      const zv = this.cam.zoom * (this.w < 700 ? 0.82 : 1);
      this.viewW = this.w / zv; this.viewH = this.h / zv;
      this.view = { x0: this.cam.x - this.viewW / 2 - 80, y0: this.cam.y - this.viewH / 2 - 120, x1: this.cam.x + this.viewW / 2 + 80, y1: this.cam.y + this.viewH / 2 + 140 };

      const ctx = this.ctx;
      this._fCnt++; this._fAcc += dt;
      if (this._fAcc > 0.5) { this.stats.fps = Math.round(this._fCnt / this._fAcc); this._fAcc = 0; this._fCnt = 0; }
      this.stats.ents = ents.en.length;
      if (this.hurtFlash > 0) {
        this.hurtFlash -= dt * 3;
        const el = document.getElementById('vignette');
        if (el) el.style.opacity = clamp(this.hurtFlash, 0, 1) * 0.85;
      }
      this.drawFirstPerson(ctx, ents, dt, snap);
    }

    w2s(x, y) { return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 }; }
    visible(x, y, pad) { pad = pad || 90; return x > this.view.x0 - pad && x < this.view.x1 + pad && y > this.view.y0 - pad && y < this.view.y1 + pad; }

    /* ---------- ground + walls, row-interleaved with entities ---------- */
    drawManananggalTorso(ctx, e, bodyC, darkC, lightC, def) {
      const flap = Math.sin(this.time * 7 + e.x * 0.01) * 0.6;
      // wings
      ctx.save();
      for (const sgn of [-1, 1]) {
        ctx.save(); ctx.scale(sgn, 1);
        ctx.rotate(-0.18 + flap * 0.32);
        const g = ctx.createLinearGradient(0, -40, 70, -10);
        g.addColorStop(0, 'rgba(60,20,32,.95)'); g.addColorStop(1, 'rgba(24,8,14,.55)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(6, -34);
        ctx.quadraticCurveTo(46, -74 - flap * 12, 84, -30);
        ctx.quadraticCurveTo(58, -34, 48, -20);
        ctx.quadraticCurveTo(40, -26, 30, -14);
        ctx.quadraticCurveTo(24, -22, 8, -18);
        ctx.closePath(); ctx.fill();
        // membrane bones
        ctx.strokeStyle = 'rgba(120,50,60,.6)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(8, -30); ctx.lineTo(80, -32); ctx.moveTo(8, -28); ctx.lineTo(50, -20); ctx.moveTo(8, -26); ctx.lineTo(32, -14); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // torso
      ctx.fillStyle = bodyC;
      roundRect(ctx, -13, -46, 26, 34, 9); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.06)'; roundRect(ctx, -10, -42, 9, 22, 5); ctx.fill();
      // torn waist with trailing viscera
      ctx.fillStyle = '#4a0c16';
      ctx.beginPath(); ctx.ellipse(0, -12, 13, 7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,30,40,.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const ph = this.time * 3 + i;
        ctx.beginPath(); ctx.moveTo(-6 + i * 3, -10);
        ctx.quadraticCurveTo(-8 + i * 4 + Math.sin(ph) * 6, 6 + i * 2, -4 + i * 3 + Math.sin(ph * 1.3) * 10, 20 + i * 3);
        ctx.stroke();
      }
      // arms with talons
      ctx.fillStyle = lightC;
      roundRect(ctx, 10, -44, 9, 26, 4); ctx.fill(); roundRect(ctx, -19, -44, 9, 26, 4); ctx.fill();
      ctx.strokeStyle = '#e8dcc8'; ctx.lineWidth = 1.4;
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(s * 14, -18); ctx.lineTo(s * (16 + i * 2), -12 + i * 3); ctx.stroke();
      }
      // head: long black hair, fanged
      ctx.fillStyle = '#0d0709';
      ctx.beginPath(); ctx.ellipse(0, -54, 13, 16, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(bodyC, .22);
      ctx.beginPath(); ctx.arc(1, -52, 8.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0d0709';
      ctx.beginPath(); ctx.moveTo(-8, -58); ctx.quadraticCurveTo(-14, -40, -8, -30); ctx.quadraticCurveTo(-2, -44, -2, -58); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9, -58); ctx.quadraticCurveTo(15, -40, 9, -30); ctx.quadraticCurveTo(3, -44, 3, -58); ctx.fill();
      ctx.fillStyle = def.eye;
      ctx.beginPath(); ctx.arc(-2, -53, 2, 0, TAU); ctx.arc(5, -53, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(0, -47); ctx.lineTo(2, -42); ctx.lineTo(4, -47); ctx.fill();
      // phase-2 invulnerability shimmer
      if (e.vn) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,80,120,' + (0.25 + 0.2 * Math.sin(this.time * 8)) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -34, 26, 40, 0, 0, TAU); ctx.stroke(); ctx.restore();
      }
    }
    drawManananggalBody(ctx, e, bodyC, darkC, lightC, def) {
      const sw = Math.sin(e.w) * 4;
      // lower half: hips + legs, stump bubbling
      ctx.fillStyle = darkC;
      roundRect(ctx, -11 + sw, -14, 10, 20, 4); ctx.fill(); roundRect(ctx, 1 - sw, -14, 10, 20, 4); ctx.fill();
      ctx.fillStyle = bodyC;
      roundRect(ctx, -15, -38, 30, 26, 9); ctx.fill();
      // waist stump
      ctx.fillStyle = '#5c1018';
      ctx.beginPath(); ctx.ellipse(0, -38, 15, 8, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -40, 2, 0, -40, 26);
      g.addColorStop(0, 'rgba(255,60,90,.5)'); g.addColorStop(1, 'rgba(255,40,70,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -40, 26, 0, TAU); ctx.fill(); ctx.restore();
      // viscera tendrils whipping
      ctx.strokeStyle = 'rgba(170,30,45,.9)'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const ph = this.time * 2.4 + i * 1.1;
        ctx.beginPath(); ctx.moveTo(-10 + i * 4, -38);
        ctx.quadraticCurveTo(-16 + i * 6 + Math.sin(ph) * 12, -56, -10 + i * 5 + Math.cos(ph) * 18, -70 + Math.sin(ph) * 8);
        ctx.stroke();
      }
      // summoning glyph when casting
      if (e.s === 'summon') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,90,120,.8)'; ctx.lineWidth = 2;
        const rr = 40 + Math.sin(this.time * 6) * 8;
        ctx.beginPath(); ctx.ellipse(0, 4, rr, rr * .45, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    /* ---------- PROPS ---------- */
    drawProp(ctx, p) {
      const kind = p.t;
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.38)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, (p.r || 20) * 1.05, (p.r || 20) * 0.48, 0, 0, TAU); ctx.fill();
      ctx.translate(p.x, p.y);
      switch (kind) {
        case 'car': this.propCar(ctx, p, '#5d6a78'); break;
        case 'jeepney': this.propJeepney(ctx, p); break;
        case 'stall': this.propStall(ctx, p); break;
        case 'dumpster': this.propBox(ctx, p, 26, 18, '#3d5340', 22); break;
        case 'crate': this.propBox(ctx, p, 17, 15, '#6b5533', 14); break;
        case 'barrier': this.propBarrier(ctx, p); break;
        case 'debris': this.propDebris(ctx, p); break;
        case 'burning': this.propBurning(ctx, p); break;
        case 'balete': this.propBalete(ctx, p); break;
        case 'pillar': this.propPillar(ctx, p); break;
        case 'bench': this.propBox(ctx, p, 22, 8, '#5a4a34', 10); break;
        case 'vending': this.propBox(ctx, p, 15, 22, '#2f4a63', 34, true); break;
        case 'locker': this.propBox(ctx, p, 16, 12, '#4a5560', 26); break;
        case 'turnstile': this.propTurnstile(ctx, p); break;
        case 'traincar': this.propTrain(ctx, p); break;
        case 'barricade': this.propBarricade(ctx, p); break;
        case 'chopper': this.propChopper(ctx, p); break;
        case 'helipad': this.propHelipad(ctx, p); break;
        case 'breach': this.propBreach(ctx, p); break;
        case 'building': case 'room': case 'rail': break; // baked into tiles
        default: this.propDebris(ctx, p);
      }
      ctx.restore();
    }
    propCar(ctx, p, c) {
      ctx.save(); ctx.rotate(p.rot || 0);
      const w = 42, h = 22;
      ctx.fillStyle = shade(c, -0.5); roundRect(ctx, -w / 2, -h / 2 + 6, w, h, 5); ctx.fill();
      ctx.fillStyle = c; roundRect(ctx, -w / 2, -h / 2, w, h, 6); ctx.fill();
      ctx.fillStyle = 'rgba(180,210,230,.22)'; roundRect(ctx, -w / 2 + 8, -h / 2 + 3, w - 16, h * .42, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-w / 2 + 4, h / 2 - 4, w - 8, 4);
      ctx.fillStyle = '#1a1c20'; ctx.fillRect(-w / 2 - 2, -h / 2 + 2, 4, 6); ctx.fillRect(w / 2 - 2, -h / 2 + 2, 4, 6);
      if ((p.seed || 0) % 3 === 0) { ctx.fillStyle = 'rgba(90,50,30,.5)'; ctx.beginPath(); ctx.ellipse(6, 2, 10, 6, .4, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    propJeepney(ctx, p) {
      ctx.save(); ctx.rotate(p.rot || 0);
      const w = 54, h = 26;
      ctx.fillStyle = '#7a1f1f'; roundRect(ctx, -w / 2, -h / 2 + 5, w, h, 4); ctx.fill();
      ctx.fillStyle = '#c0392b'; roundRect(ctx, -w / 2, -h / 2, w, h * .62, 5); ctx.fill();
      // chrome trim + colours
      ctx.fillStyle = '#e8d27a'; ctx.fillRect(-w / 2, -h / 2 + h * .5, w, 2.4);
      ctx.fillStyle = '#3aa0d8'; ctx.fillRect(-w / 2 + 6, -h / 2 + 3, 8, 5);
      ctx.fillStyle = '#4ade80'; ctx.fillRect(-w / 2 + 18, -h / 2 + 3, 8, 5);
      ctx.fillStyle = '#ffb02e'; ctx.fillRect(-w / 2 + 30, -h / 2 + 3, 8, 5);
      ctx.fillStyle = 'rgba(190,220,240,.25)'; ctx.fillRect(-w / 2 + 4, -h / 2 + 10, w - 8, 5);
      ctx.fillStyle = '#15171b'; ctx.beginPath(); ctx.arc(-w / 2 + 10, h / 2 + 2, 5, 0, TAU); ctx.arc(w / 2 - 10, h / 2 + 2, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    propStall(ctx, p) {
      ctx.save(); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#4a3a26'; ctx.fillRect(-20, -6, 40, 16);
      ctx.fillStyle = '#6b5533'; ctx.fillRect(-22, -12, 44, 8);
      // tarp roof
      ctx.fillStyle = (p.seed || 0) % 2 ? '#2f6fb5' : '#c0392b';
      ctx.beginPath(); ctx.moveTo(-26, -12); ctx.lineTo(-20, -34); ctx.lineTo(20, -34); ctx.lineTo(26, -12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * 9 - 2, -34, 4, 22);
      ctx.restore();
    }
    propBox(ctx, p, w, h, c, height, glow) {
      ctx.save(); ctx.rotate(p.rot || 0);
      ctx.fillStyle = shade(c, -0.45); ctx.fillRect(-w / 2, -h / 2 + 4, w, h);
      ctx.fillStyle = c; ctx.fillRect(-w / 2, -h / 2 - height * 0.28, w, h);
      ctx.fillStyle = shade(c, 0.2); ctx.fillRect(-w / 2, -h / 2 - height * 0.28, w, 3);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-w / 2, -h / 2 - height * 0.28 + h - 3, w, 3);
      if (glow) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(120,200,255,.16)'; ctx.fillRect(-w / 2 + 2, -h / 2 - height * .2, w - 4, h * .6); ctx.restore(); }
      ctx.restore();
    }
    propBarrier(ctx, p) {
      ctx.save(); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#8a8f98'; ctx.fillRect(-24, -3, 48, 7);
      ctx.fillStyle = '#d8dde4'; ctx.fillRect(-24, -8, 48, 5);
      for (let i = -2; i <= 2; i++) { ctx.fillStyle = i % 2 ? '#c0392b' : '#e8ecef'; ctx.fillRect(i * 9 - 4, -8, 9, 5); }
      ctx.fillStyle = '#3a3d44'; ctx.fillRect(-22, 4, 4, 8); ctx.fillRect(18, 4, 4, 8);
      ctx.restore();
    }
    propDebris(ctx, p) {
      const r = p.r || 14;
      for (let i = 0; i < 5; i++) {
        const a = hash(i, p.seed || 1) * TAU, d = hash(i + 7, p.seed || 1) * r;
        ctx.fillStyle = ['#4a4741', '#3b3934', '#575349'][i % 3];
        ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d * .6); ctx.rotate(a);
        ctx.fillRect(-r * .3, -r * .18, r * .6, r * .36); ctx.restore();
      }
    }
    propBurning(ctx, p) {
      ctx.fillStyle = '#241a12'; ctx.beginPath(); ctx.ellipse(0, 2, 16, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(-12, -6, 24, 8);
      for (let i = 0; i < 4; i++) {
        const t = this.time * 5 + i * 1.6;
        const hh = 18 + Math.sin(t) * 9;
        const g = ctx.createLinearGradient(0, 0, 0, -hh);
        g.addColorStop(0, 'rgba(255,120,20,.9)'); g.addColorStop(.5, 'rgba(255,190,70,.6)'); g.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-8 + i * 4, 0); ctx.quadraticCurveTo(-4 + i * 4 + Math.sin(t) * 4, -hh * .6, -6 + i * 4, -hh); ctx.quadraticCurveTo(0 + i * 4, -hh * .4, 0 + i * 4, 0); ctx.fill();
      }
    }
    propBalete(ctx, p) {
      const r = p.r || 22;
      ctx.fillStyle = '#3a2f22';
      ctx.beginPath(); ctx.ellipse(0, 0, r * .5, r * .35, 0, 0, TAU); ctx.fill();
      // trunk + aerial roots
      ctx.strokeStyle = '#4a3b28'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -40); ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * .4;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, -34 + i * 2);
        ctx.quadraticCurveTo(Math.cos(a) * 22, -18, Math.cos(a) * 16, 2);
        ctx.stroke();
      }
      // canopy
      ctx.fillStyle = '#1f3a22';
      for (let i = 0; i < 5; i++) { const a = i * 1.3; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 16, -46 + Math.sin(a) * 8, 20, 13, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(70,120,70,.25)';
      ctx.beginPath(); ctx.ellipse(-6, -52, 16, 10, 0, 0, TAU); ctx.fill();
    }
    propPillar(ctx, p) {
      const r = p.r || 20, h = 130;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(-r, -h * .18, r * 2, h * .2);
      const g = ctx.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, '#2f3238'); g.addColorStop(.35, '#565b64'); g.addColorStop(1, '#25282d');
      ctx.fillStyle = g; ctx.fillRect(-r, -h, r * 2, h);
      ctx.fillStyle = '#3d4149'; ctx.fillRect(-r - 3, -h, r * 2 + 6, 7); ctx.fillRect(-r - 3, -8, r * 2 + 6, 8);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let i = 1; i < 5; i++) ctx.fillRect(-r, -h + i * (h / 5), r * 2, 1.4);
    }
    propTurnstile(ctx, p) {
      const w = p.w || 100;
      ctx.fillStyle = '#3a3f48'; ctx.fillRect(-w / 2, -10, w, 20);
      ctx.fillStyle = '#565d68'; ctx.fillRect(-w / 2, -16, w, 7);
      for (let i = 0; i < Math.floor(w / 34); i++) {
        ctx.fillStyle = '#22262c'; ctx.fillRect(-w / 2 + 8 + i * 34, -14, 18, 24);
        ctx.fillStyle = '#7d8794'; ctx.fillRect(-w / 2 + 12 + i * 34, -8, 3, 14);
      }
    }
    propTrain(ctx, p) {
      const w = p.w || 200, h = p.h || 100;
      ctx.save(); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#1d2126'; roundRect(ctx, -w / 2, -h / 2 + 8, w, h, 8); ctx.fill();
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, '#9aa4ae'); g.addColorStop(.5, '#6d7783'); g.addColorStop(1, '#414a54');
      ctx.fillStyle = g; roundRect(ctx, -w / 2, -h / 2, w, h, 9); ctx.fill();
      ctx.fillStyle = '#c8a22a'; ctx.fillRect(-w / 2, -h / 2 + h * .58, w, 4);
      ctx.fillStyle = 'rgba(20,26,32,.85)';
      for (let i = 0; i < Math.floor(w / 46); i++) roundRect(ctx, -w / 2 + 12 + i * 46, -h / 2 + 10, 32, h * .34, 3), ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (let i = 0; i < Math.floor(w / 46); i++) ctx.fillRect(-w / 2 + 14 + i * 46, -h / 2 + 12, 12, h * .1);
      ctx.restore();
    }
    propBarricade(ctx, p) {
      ctx.fillStyle = '#4a3a24';
      for (let i = -2; i <= 2; i++) { ctx.save(); ctx.translate(i * 26, Math.sin(i) * 6); ctx.rotate(i * 0.06); ctx.fillRect(-14, -22, 28, 8); ctx.fillRect(-12, -14, 5, 24); ctx.fillRect(7, -14, 5, 24); ctx.restore(); }
      ctx.fillStyle = 'rgba(120,90,40,.35)'; ctx.fillRect(-70, -6, 140, 6);
      // sandbags
      for (let i = -3; i <= 3; i++) { ctx.fillStyle = i % 2 ? '#6b6248' : '#5a5238'; ctx.beginPath(); ctx.ellipse(i * 20, 6, 12, 7, 0, 0, TAU); ctx.fill(); }
    }
    propHelipad(ctx, p) {
      const r = p.r || 200;
      ctx.strokeStyle = 'rgba(255,220,120,.5)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * .58, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,120,.75)';
      ctx.font = '900 ' + Math.round(r * .5) + 'px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.scale(1, .58); ctx.fillText('H', 0, 0); ctx.restore();
      // blinking lights
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + this.time * .4;
        const on = (Math.sin(this.time * 4 + i) > 0);
        ctx.fillStyle = on ? 'rgba(255,120,80,.95)' : 'rgba(120,40,30,.4)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * .58, 4, 0, TAU); ctx.fill();
      }
    }
    propChopper(ctx, p) {
      const spin = this.time * 26;
      ctx.save();
      ctx.fillStyle = '#2b3238';
      ctx.beginPath(); ctx.ellipse(0, -6, 46, 22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3d464e';
      ctx.beginPath(); ctx.ellipse(0, -14, 38, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(150,210,240,.28)';
      ctx.beginPath(); ctx.ellipse(16, -16, 13, 9, .2, 0, TAU); ctx.fill();
      // tail
      ctx.fillStyle = '#2b3238'; ctx.fillRect(-70, -14, 34, 9);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-72, -22, 6, 16);
      // rotor
      ctx.strokeStyle = 'rgba(220,230,240,.42)'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const a = spin + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(Math.cos(a) * 82, -22 + Math.sin(a) * 20); ctx.stroke();
      }
      ctx.fillStyle = '#565f68'; ctx.beginPath(); ctx.arc(0, -22, 5, 0, TAU); ctx.fill();
      // searchlight
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(30, 20, 4, 30, 40, 190);
      g.addColorStop(0, 'rgba(255,250,220,.34)'); g.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(120, 190); ctx.lineTo(-60, 190); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.restore();
    }
    propBreach(ctx, p) {
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.beginPath();
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; const rr = (p.r || 60) * (0.6 + hash(i, p.x | 0) * 0.5); ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr * .7); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,120,130,.35)'; ctx.lineWidth = 2; ctx.stroke();
      // rebar
      ctx.strokeStyle = '#6b5a44'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const a = hash(i, 3) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * (p.r || 60) * .9, Math.sin(a) * (p.r || 60) * .5); ctx.stroke(); }
    }

    /* ---------- projectiles / tracers ---------- */
    /* ---- loot containers (destructible) ----
       Drawn inside the y-sorted row pass so survivors pass in front of and
       behind them correctly. Damage shows as cracks, dents and a lean; a
       destroyed container leaves rubble instead of popping out of existence. */
    drawBreakable(ctx, b) {
      const def = D.BREAKABLES[b.t] || {};
      const r = b.r || 15, z = def.z || 24, hurt = 1 - b.hp;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.dead) {
        ctx.fillStyle = 'rgba(12,10,9,.5)';
        ctx.beginPath(); ctx.ellipse(0, 2, r * 1.1, r * .45, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = .62;
        this.propDebris(ctx, { r: r * 1.1, seed: b.seed || 3 });
        ctx.restore();
        return;
      }
      // a faint pulse so containers read as lootable, not scenery
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(0, 2, 1, 0, 2, r * 2.2);
      gl.addColorStop(0, hexA(def.color || b.color, .12 + .05 * Math.sin(this.time * 2.1 + (b.seed || 0) * .013)));
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.ellipse(0, 2, r * 2.2, r * 1.15, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath(); ctx.ellipse(0, 4, r * .98, r * .42, 0, 0, TAU); ctx.fill();
      ctx.rotate((b.rot || 0) + hurt * .07);
      if (hurt > .5) ctx.translate(Math.sin(this.time * 30) * hurt * .7, 0);
      const c = def.color || '#a9762f';
      if (b.t === 'trash') {
        ctx.fillStyle = shade(c, -.42); ctx.beginPath(); ctx.ellipse(0, 2, r * .82, r * .36, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = c; ctx.fillRect(-r * .78, -z, r * 1.56, z + 2);
        ctx.fillStyle = shade(c, .2); ctx.beginPath(); ctx.ellipse(0, -z, r * .78, r * .32, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.2;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * r * .42, -z + 3); ctx.lineTo(i * r * .42, 1); ctx.stroke(); }
        ctx.fillStyle = shade(c, .32); ctx.fillRect(-r * .86, -z - 4, r * 1.72, 5);
      } else if (b.t === 'barrel') {
        ctx.fillStyle = shade(c, -.44); ctx.beginPath(); ctx.ellipse(0, 2, r * .86, r * .38, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = c; ctx.fillRect(-r * .82, -z, r * 1.64, z + 2);
        ctx.fillStyle = shade(c, .22); ctx.beginPath(); ctx.ellipse(0, -z, r * .82, r * .34, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f0c33c'; ctx.fillRect(-r * .82, -z * .64, r * 1.64, 5);
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
        ctx.fillText('!', 0, -z * .64 + 4.6);
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-r * .82, -z * .3); ctx.lineTo(r * .82, -z * .3); ctx.stroke();
      } else {
        const w = r * 1.9, h = r * 1.5;
        this.propBox(ctx, { rot: 0 }, w, h, c, z, b.t === 'vending');
        const fy0 = -h / 2 - z * .28, fy1 = h / 2 - z * .28;
        if (b.t === 'crate') {
          ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-w / 2, fy0); ctx.lineTo(w / 2, fy1);
          ctx.moveTo(w / 2, fy0); ctx.lineTo(-w / 2, fy1);
          ctx.stroke();
        } else if (b.t === 'box') {
          ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(0, fy0); ctx.lineTo(0, fy1); ctx.stroke();
          ctx.fillStyle = 'rgba(220,210,180,.22)'; ctx.fillRect(-w / 2, (fy0 + fy1) / 2 - 2, w, 4);
        } else if (b.t === 'cabinet') {
          const cy = (fy0 + fy1) / 2;
          ctx.fillStyle = '#c62838';
          ctx.fillRect(-2.4, cy - 6, 4.8, 12); ctx.fillRect(-7, cy - 2.2, 14, 4.4);
        }
      }
      if (hurt > .18) {
        ctx.strokeStyle = 'rgba(0,0,0,' + (.22 + hurt * .45).toFixed(2) + ')';
        ctx.lineWidth = 1 + hurt;
        const n = 1 + Math.floor(hurt * 3);
        for (let i = 0; i < n; i++) {
          const a = hash(i, b.seed || 5) * TAU, d = r * (.3 + hash(i + 3, b.seed || 5) * .55);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * d, -z * .5 + Math.sin(a) * d * .5);
          ctx.lineTo(Math.cos(a + 1.1) * d * 1.5, -z * .5 + Math.sin(a + 1.1) * d * .8);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    consumeFx(snap) {
      const list = snap.fxp || snap.fx || [];
      const cam = { x: this.cam.x, y: this.cam.y };
      for (const f of list) {
        const pos = { x: f.x, y: f.y };
        switch (f.type) {
          case 'shot': {
            const sv = (snap.surv || []).find(s => s.id === f.id);
            const w = f.w;
            AU.SFX.shot(w, pos, cam, this.viewW);
            // shell casing
            break;
          }
          case 'blood':
            AU.SFX.hit(pos, cam, this.viewW, (f.n || 0) > 7);
            if (f.by && f.by === this.youId) { this.hitT = 0.14; this.hitCrit = (f.n || 0) > 7; }
            break;
          case 'spark':
            break;
          case 'die':
            AU.SFX.die(pos, cam, this.viewW, f.type);
            if (f.boss) AU.SFX.roar(pos, cam, this.viewW);
            break;
          case 'hurt':
            this.hurtFlash = 1;
            // remember WHERE the hit came from so FP can point at it
            if (f.id === this.youId && f.sx !== undefined && f.sy !== undefined) {
              this.hurtDir = Math.atan2(f.sy - f.y, f.sx - f.x);
              this.hurtDirT = 0.9;
            }
            break;
          case 'down':
            AU.SFX.down(pos, cam, this.viewW);
            break;
          case 'death': AU.SFX.down(pos, cam, this.viewW); break;
          case 'revive': AU.SFX.revive(pos, cam, this.viewW); break;
          case 'breakfree': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'ability': {
            const hero = f.hero;
            AU.SFX.ability(hero, pos, cam, this.viewW);
            break;
          }
          case 'aura': break;
          case 'explode': {
            const fire = f.kind === 'fire', hot = fire || f.kind === 'boom';
            const col = fire ? '#ff9a3c' : (f.kind === 'boom' ? '#ffb02e' : '#a8ff60');
            AU.SFX.explode(pos, cam, this.viewW, f.r > 90);
            break;
          }
          case 'flame':
            break;
          case 'haz_end': break;
          case 'spit': AU.SFX.spit(pos, cam, this.viewW); break;
          case 'cry': AU.SFX.cry(pos, cam, this.viewW); break;
          case 'leap': AU.SFX.screech(pos, cam, this.viewW); break;
          case 'tackle': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'charge_warn': AU.SFX.charge(pos, cam, this.viewW); break;
          case 'charge_go': break;
          case 'smash': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'curse_warn': break;
          case 'swipe': break;
          case 'pin': break;
          case 'reload': AU.SFX.reload(pos, cam, this.viewW); break;
          case 'reload_end': AU.SFX.ui('click'); break;
          case 'dry': AU.SFX.dry(pos, cam, this.viewW); break;
          case 'pickup': AU.SFX.pickup(pos, cam, this.viewW, f.kind); break;
          case 'boss_spawn': AU.SFX.roar(pos, cam, this.viewW); break;
          case 'boss_split': AU.SFX.screech(pos, cam, this.viewW); AU.SFX.roar(pos, cam, this.viewW); break;
          case 'boss_die': AU.SFX.roar(pos, cam, this.viewW); AU.SFX.explode(pos, cam, this.viewW, true); break;
          case 'boss_part': AU.SFX.explode(pos, cam, this.viewW, true); break;
          case 'summon': AU.SFX.screech(pos, cam, this.viewW); break;
          case 'dive_warn': break;
          case 'dive_hit': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'boss_cast': AU.SFX.spit(pos, cam, this.viewW); break;
          case 'horde': AU.SFX.horde(cam); break;
          case 'horde_spawn': break;
          case 'special_spawn': break;
          case 'fall': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'gen_on': AU.SFX.ui('start'); break;
          case 'wrench': AU.SFX.ui('click'); break;
          case 'flow_done': AU.SFX.ui('start'); break;
          case 'objective': AU.SFX.ui('click'); break;
          case 'victory': AU.SFX.ui('win'); break;
          case 'defeat': AU.SFX.ui('lose'); break;
          case 'break':
            AU.SFX.smash(pos, cam, this.viewW);
            break;
          case 'swap': AU.SFX.reload(pos, cam, this.viewW); break;
          case 'deny': AU.SFX.dry(pos, cam, this.viewW); break;
          case 'throw':
            AU.SFX.ui('click');
            break;
          case 'armor': break;
          case 'armor_break':
            AU.SFX.smash(pos, cam, this.viewW);
            break;
          case 'stage_start': break;
          default: break;
        }
      }
    }

    /* ---------- minimap ---------- */
    /* ============================================================
       FIRST-PERSON 2.5D  (raycaster + camera-facing billboards)
       The sim remains a 2D authoritative model; this is purely a
       projection of that same plane from eye height. Walls are
       raycast column-by-column over the tile grid (DDA); every
       actor/prop is a billboard sorted far-to-near and occluded by
       the wall depth buffer. No 3D engine, no new assets.
       ============================================================ */
    fpColW() { return this.tier === 'low' ? 4 : this.tier === 'medium' ? 3 : 2; }

    drawFirstPerson(ctx, ents, dt, snap) {
      const W = this.w, H = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const me = this.youId ? ents.surv.find(e => e.id === this.youId) : null;
      const px = me ? me.x : this.cam.x, py = me ? me.y : this.cam.y;
      const yaw = this.yaw || 0;
      const fy = Math.sin(yaw), fx = Math.cos(yaw);      // forward
      const rx = -fy, ry = fx;                            // right

      // head bob tracks movement so walking feels like walking
      this.fpBob = (this.fpBob || 0) + dt * (this.fpMoving ? 10 : 2.4);
      const bob = Math.sin(this.fpBob) * (this.fpMoving ? 6 : 1.6);
      const horizon = H * 0.5 + bob;

      // ceiling + floor wash (cheap, and reads as a dark interior)
      let g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, '#05060d'); g.addColorStop(1, '#141826');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(1, horizon));
      g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, '#12141c'); g.addColorStop(1, '#2c2128');
      ctx.fillStyle = g; ctx.fillRect(0, horizon, W, H - horizon);

      const L = this.level;
      if (!L || !L.grid) return;
      const TS = L.tile, grid = L.grid, LW = L.w, LH = L.h;
      const cols = Math.max(96, Math.floor(W / this.fpColW()));
      const colW = W / cols;
      if (!this.zbuf || this.zbuf.length !== cols) this.zbuf = new Float32Array(cols);
      const plane = Math.tan(Math.PI / 6);   // 60 deg fov
      const MAXD = 16 * TS;

      const solidT = (tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= LW || ty >= LH) return 1;
        const v = grid[ty * LW + tx]; return (v === 1 || v === 6) ? 1 : 0;
      };

      // ---- walls: one DDA ray per column ----
      for (let c = 0; c < cols; c++) {
        const camN = (2 * c / cols - 1) * plane;
        const rdx = fx + rx * camN, rdy = fy + ry * camN;
        let mapX = Math.floor(px / TS), mapY = Math.floor(py / TS);
        const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
        let stepX, stepY, sideX, sideY;
        if (rdx < 0) { stepX = -1; sideX = (px / TS - mapX) * ddx; } else { stepX = 1; sideX = (mapX + 1 - px / TS) * ddx; }
        if (rdy < 0) { stepY = -1; sideY = (py / TS - mapY) * ddy; } else { stepY = 1; sideY = (mapY + 1 - py / TS) * ddy; }
        let side = 0, hit = 0, guard = 0, tv = 1;
        while (!hit && guard++ < 96) {
          if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; } else { sideY += ddy; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= LW || mapY >= LH) { hit = 1; tv = 1; break; }
          tv = grid[mapY * LW + mapX]; hit = (tv === 1 || tv === 6) ? 1 : 0;
        }
        const perpTiles = Math.max(0.02, side === 0 ? (sideX - ddx) : (sideY - ddy));
        const dWorld = perpTiles * TS;
        this.zbuf[c] = dWorld;

        const wallH = Math.min(H * 4, (H * 2.4) / perpTiles);
        let wx = side === 0 ? (py / TS + perpTiles * rdy) : (px / TS + perpTiles * rdx);
        wx -= Math.floor(wx);
        const stripe = ((wx * 6) | 0) % 2;

        // distance fog + side shading + a brick-ish stripe
        let lit = clamp(1 - dWorld / MAXD, 0, 1); lit = 0.16 + 0.84 * Math.pow(lit, 1.35);
        if (side === 1) lit *= 0.80;
        if (stripe) lit *= 0.90;
        const base = tv === 6 ? [128, 108, 92] : [104, 110, 132];
        ctx.fillStyle = 'rgb(' + ((base[0] * lit) | 0) + ',' + ((base[1] * lit) | 0) + ',' + ((base[2] * lit) | 0) + ')';
        ctx.fillRect(c * colW, horizon - wallH / 2, colW + 1, wallH);
      }

      // ---- billboards: actors, loot, props ----
      const sprites = [];
      for (const e of ents.en) sprites.push({ x: e.x, y: e.y, k: 'en', t: e.t, b: e.b, f: e.f, w: e.w, s: e.s });
      for (const sv of ents.surv) if (sv.id !== this.youId && !sv.dd) sprites.push({ x: sv.x, y: sv.y, k: 'ally', t: sv.hero, w: sv.wk });
      for (const it of ents.it) sprites.push({ x: it.x, y: it.y, k: 'item', t: it.k });
      if (this.breakByN) for (const b of this.breakByN) if (!b.dead) sprites.push({ x: b.x, y: b.y, k: 'prop', t: b.t });
      for (const sp of sprites) {
        const ddx2 = sp.x - px, ddy2 = sp.y - py;
        const depth = ddx2 * fx + ddy2 * fy;
        if (depth < 0.35) continue;
        const lateral = ddx2 * rx + ddy2 * ry;
        sp.depth = depth; sp.sx = W / 2 * (1 + (lateral / depth) / plane);
      }
      sprites.sort((a, b) => (b.depth || 0) - (a.depth || 0));
      for (const sp of sprites) {
        if (!sp.depth) continue;
        const col = Math.floor(sp.sx / colW);
        if (col >= 0 && col < cols && this.zbuf[col] < sp.depth - 6) continue;   // hidden behind a wall
        const worldH = sp.k === 'en' ? (sp.b ? 96 : 54) : sp.k === 'ally' ? 54 : sp.k === 'item' ? 20 : 34;
        const hh = (H * worldH) / sp.depth;
        const ww = hh * 0.52;
        if (sp.sx + ww < 0 || sp.sx - ww > W) continue;
        const fog = clamp(1 - sp.depth / MAXD, 0, 1);
        ctx.globalAlpha = 0.25 + 0.75 * fog;
        const eye = 1.2 * TS;
        const yBot = horizon + (H * eye) / sp.depth;
        const top = yBot - hh;
        this.drawBillboard(ctx, sp, top, ww, hh);
        ctx.globalAlpha = 1;
      }

      // ---- tracers as screen-space streaks toward their world point ----
      if (ents.tr) for (const t of ents.tr) {
        const depth = (t.x - px) * fx + (t.y - py) * fy;
        if (depth < 0.4) continue;
        const lateral = (t.x - px) * rx + (t.y - py) * ry;
        const sx = W / 2 * (1 + (lateral / depth) / plane);
        ctx.strokeStyle = 'rgba(255,214,120,' + (0.5 * t.l).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, horizon - H * 0.06); ctx.lineTo(sx + 6, horizon - H * 0.05); ctx.stroke();
      }

      this.drawAwareness(ctx, ents, dt);

      this.drawViewmodel(ctx, me, dt);
      this.drawHud(ctx, ents, snap, dt);

      // vignette for the horror mood
      g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    /* ---------------- detailed billboard sprites ---------------- */
    bbLimb(ctx, x1, y1, x2, y2, w, c) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    drawBillboard(ctx, sp, top, ww, hh) {
      const cx = sp.sx, w = sp.w || 0;
      const s1 = Math.sin(w * 6), s2 = Math.sin(w * 6 + Math.PI);
      const flash = sp.f ? 1 : 0;
      const C = c => (flash ? '#ffffff' : c);
      const limb = (x1, y1, x2, y2, lw, c) => this.bbLimb(ctx, x1, y1, x2, y2, lw, C(c));
      const blob = (x, y, rx, ry, c) => { ctx.fillStyle = C(c); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
      if (sp.k === 'en') {
        const t = sp.t;
        if (sp.b || t === 'manananggal') {                       // ACT 1 BOSS
          const flap = Math.sin(w * 3.1);
          const wy = top + hh * 0.30;
          for (const sd of [-1, 1]) {                            // membranous wings
            ctx.fillStyle = C('#4a1020');
            ctx.beginPath();
            ctx.moveTo(cx + sd * ww * 0.12, wy);
            ctx.quadraticCurveTo ? ctx.quadraticCurveTo(cx + sd * ww * 1.5, wy - hh * (0.34 + flap * 0.16), cx + sd * ww * 1.9, wy - hh * (0.10 + flap * 0.22)) : ctx.lineTo(cx + sd * ww * 1.9, wy - hh * 0.2);
            ctx.quadraticCurveTo ? ctx.quadraticCurveTo(cx + sd * ww * 1.2, wy + hh * 0.10, cx + sd * ww * 0.16, wy + hh * 0.12) : ctx.lineTo(cx + sd * ww * 0.16, wy + hh * 0.12);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = C('#2a0812'); ctx.lineWidth = Math.max(1, ww * 0.03);
            for (let r = 1; r <= 3; r++) { ctx.beginPath(); ctx.moveTo(cx + sd * ww * 0.14, wy); ctx.lineTo(cx + sd * ww * (0.5 + r * 0.42), wy - hh * (0.30 + flap * 0.18) + r * hh * 0.10); ctx.stroke(); }
          }
          blob(cx, top + hh * 0.42, ww * 0.34, hh * 0.24, '#8c2333');          // severed torso
          blob(cx, top + hh * 0.20, ww * 0.22, hh * 0.11, '#d8c3ae');          // pale head
          ctx.fillStyle = C('#12060a');                                          // long black hair
          ctx.fillRect(cx - ww * 0.26, top + hh * 0.10, ww * 0.52, hh * 0.05);
          limb(cx - ww * 0.24, top + hh * 0.14, cx - ww * 0.30, top + hh * 0.42, ww * 0.05, '#12060a');
          limb(cx + ww * 0.24, top + hh * 0.14, cx + ww * 0.30, top + hh * 0.42, ww * 0.05, '#12060a');
          ctx.fillStyle = C('#ff2d55');                                          // glowing eyes
          ctx.fillRect(cx - ww * 0.11, top + hh * 0.185, ww * 0.07, ww * 0.05);
          ctx.fillRect(cx + ww * 0.04, top + hh * 0.185, ww * 0.07, ww * 0.05);
          for (let g = 0; g < 3; g++)                                            // trailing viscera
            limb(cx + (g - 1) * ww * 0.12, top + hh * 0.62, cx + (g - 1) * ww * 0.16 + s1 * ww * 0.06, top + hh * (0.86 + g * 0.05), ww * 0.045, '#6d1622');
          limb(cx - ww * 0.30, top + hh * 0.36, cx - ww * 0.52, top + hh * (0.50 + s1 * 0.05), ww * 0.06, '#8c2333');   // claw arms
          limb(cx + ww * 0.30, top + hh * 0.36, cx + ww * 0.52, top + hh * (0.50 + s2 * 0.05), ww * 0.06, '#8c2333');
          return;
        }
        if (t === 'tiyanak') {                                    // crawling baby demon, big head
          blob(cx, top + hh * 0.34, ww * 0.34, hh * 0.20, '#a01830');
          ctx.fillStyle = C('#ff5f52'); ctx.fillRect(cx - ww * 0.16, top + hh * 0.30, ww * 0.09, ww * 0.06); ctx.fillRect(cx + ww * 0.07, top + hh * 0.30, ww * 0.09, ww * 0.06);
          blob(cx, top + hh * 0.66, ww * 0.30, hh * 0.16, '#7d1226');
          limb(cx - ww * 0.26, top + hh * 0.62, cx - ww * 0.44, top + hh * (0.86 + s1 * 0.05), ww * 0.07, '#7d1226');
          limb(cx + ww * 0.26, top + hh * 0.62, cx + ww * 0.44, top + hh * (0.86 + s2 * 0.05), ww * 0.07, '#7d1226');
          return;
        }
        if (t === 'batibat') {                                    // wide nightmare brute
          limb(cx - ww * 0.16, top + hh * 0.62, cx - ww * 0.22, top + hh * (0.98 + s1 * 0.02), ww * 0.13, '#3d2a52');
          limb(cx + ww * 0.16, top + hh * 0.62, cx + ww * 0.22, top + hh * (0.98 + s2 * 0.02), ww * 0.13, '#3d2a52');
          blob(cx, top + hh * 0.48, ww * 0.46, hh * 0.26, '#5b3a78');
          blob(cx, top + hh * 0.16, ww * 0.20, hh * 0.11, '#4a2f61');
          ctx.fillStyle = C('#e9d5ff'); ctx.fillRect(cx - ww * 0.10, top + hh * 0.145, ww * 0.06, ww * 0.04); ctx.fillRect(cx + ww * 0.04, top + hh * 0.145, ww * 0.06, ww * 0.04);
          limb(cx - ww * 0.42, top + hh * 0.36, cx - ww * 0.60, top + hh * (0.72 + s1 * 0.06), ww * 0.11, '#5b3a78');
          limb(cx + ww * 0.42, top + hh * 0.36, cx + ww * 0.60, top + hh * (0.72 + s2 * 0.06), ww * 0.11, '#5b3a78');
          return;
        }
        if (t === 'mangkukulam') {                                // hooded witch + staff
          ctx.fillStyle = C('#1d3b2a');
          ctx.beginPath(); ctx.moveTo(cx - ww * 0.40, top + hh * 0.98); ctx.lineTo(cx - ww * 0.20, top + hh * 0.24);
          ctx.lineTo(cx + ww * 0.20, top + hh * 0.24); ctx.lineTo(cx + ww * 0.40, top + hh * 0.98); ctx.closePath(); ctx.fill();
          blob(cx, top + hh * 0.18, ww * 0.20, hh * 0.12, '#16281d');
          ctx.fillStyle = C('#3ddc84'); ctx.fillRect(cx - ww * 0.09, top + hh * 0.165, ww * 0.05, ww * 0.04); ctx.fillRect(cx + ww * 0.04, top + hh * 0.165, ww * 0.05, ww * 0.04);
          limb(cx + ww * 0.30, top + hh * 0.10, cx + ww * 0.34, top + hh * 0.98, ww * 0.05, '#5b4326');
          blob(cx + ww * 0.31, top + hh * 0.08, ww * 0.08, ww * 0.08, '#7CFC9E');
          return;
        }
        if (t === 'pugot') {                                      // headless brute, neck stump
          limb(cx - ww * 0.17, top + hh * 0.60, cx - ww * 0.24, top + hh * (0.98 + s1 * 0.02), ww * 0.13, '#585e68');
          limb(cx + ww * 0.17, top + hh * 0.60, cx + ww * 0.24, top + hh * (0.98 + s2 * 0.02), ww * 0.13, '#585e68');
          blob(cx, top + hh * 0.46, ww * 0.40, hh * 0.26, '#767d89');
          blob(cx, top + hh * 0.18, ww * 0.17, hh * 0.07, '#5e1220');           // stump
          limb(cx - ww * 0.36, top + hh * 0.34, cx - ww * 0.56, top + hh * (0.62 + s1 * 0.08), ww * 0.11, '#767d89');
          limb(cx + ww * 0.36, top + hh * 0.34, cx + ww * 0.56, top + hh * (0.62 + s2 * 0.08), ww * 0.11, '#767d89');
          return;
        }
        if (t === 'spitter') {                                    // bloated dumagat
          limb(cx - ww * 0.13, top + hh * 0.70, cx - ww * 0.17, top + hh * 0.98, ww * 0.09, '#17706a');
          limb(cx + ww * 0.13, top + hh * 0.70, cx + ww * 0.17, top + hh * 0.98, ww * 0.09, '#17706a');
          blob(cx, top + hh * 0.55, ww * 0.42, hh * 0.24, '#2dd4bf');
          blob(cx + ww * 0.10, top + hh * 0.50, ww * 0.12, hh * 0.09, '#a7f3d0');   // acid sac
          blob(cx, top + hh * 0.22, ww * 0.16, hh * 0.10, '#1f8f80');
          ctx.fillStyle = C('#fef08a'); ctx.fillRect(cx - ww * 0.08, top + hh * 0.205, ww * 0.05, ww * 0.04); ctx.fillRect(cx + ww * 0.03, top + hh * 0.205, ww * 0.05, ww * 0.04);
          return;
        }
        // bangkay / takas — infected humanoid, arms reaching
        const lean = t === 'runner' ? 0.14 : 0.06;
        limb(cx - ww * 0.13, top + hh * 0.62, cx - ww * (0.20 + s1 * 0.06), top + hh * 0.98, ww * 0.09, '#4d5348');
        limb(cx + ww * 0.13, top + hh * 0.62, cx + ww * (0.20 + s2 * 0.06), top + hh * 0.98, ww * 0.09, '#4d5348');
        ctx.save(); ctx.translate(cx, top + hh * 0.45); ctx.rotate(lean * 0.6);
        blob(0, 0, ww * 0.26, hh * 0.20, t === 'runner' ? '#6b705c' : '#565b50');
        ctx.restore();
        limb(cx - ww * 0.20, top + hh * 0.36, cx - ww * (0.44 + s2 * 0.05), top + hh * (0.52 - lean * 0.4), ww * 0.07, '#7d8a6a');
        limb(cx + ww * 0.20, top + hh * 0.36, cx + ww * (0.46 + s1 * 0.05), top + hh * (0.50 - lean * 0.4), ww * 0.07, '#7d8a6a');
        blob(cx + ww * lean * 0.5, top + hh * 0.16, ww * 0.16, hh * 0.10, '#8a9578');
        ctx.fillStyle = C('#ff3b30'); ctx.fillRect(cx + ww * lean * 0.5 - ww * 0.08, top + hh * 0.145, ww * 0.05, ww * 0.04);
        ctx.fillStyle = C('#ff3b30'); ctx.fillRect(cx + ww * lean * 0.5 + ww * 0.03, top + hh * 0.145, ww * 0.05, ww * 0.04);
        return;
      }
      if (sp.k === 'ally') {
        const col = (D.SURVIVORS[sp.t] || {}).color || '#5ad1ff';
        limb(cx - ww * 0.12, top + hh * 0.62, cx - ww * (0.17 + s1 * 0.05), top + hh * 0.98, ww * 0.09, '#243447');
        limb(cx + ww * 0.12, top + hh * 0.62, cx + ww * (0.17 + s2 * 0.05), top + hh * 0.98, ww * 0.09, '#243447');
        blob(cx, top + hh * 0.45, ww * 0.25, hh * 0.19, col);
        ctx.fillStyle = C('#ffffff55'); ctx.fillRect(cx - ww * 0.25, top + hh * 0.40, ww * 0.50, hh * 0.035);   // reflective strip
        limb(cx - ww * 0.20, top + hh * 0.36, cx - ww * 0.34, top + hh * (0.56 + s2 * 0.05), ww * 0.07, col);
        limb(cx + ww * 0.20, top + hh * 0.36, cx + ww * 0.36, top + hh * (0.52 + s1 * 0.05), ww * 0.07, col);
        blob(cx, top + hh * 0.16, ww * 0.15, hh * 0.09, '#d9b48b');
        ctx.fillStyle = C('#0e2f45'); ctx.fillRect(cx - ww * 0.15, top + hh * 0.10, ww * 0.30, hh * 0.045);      // cap
        return;
      }
      if (sp.k === 'item') {
        if (sp.t === 'medkit') { ctx.fillStyle = C('#e8ecf2'); ctx.fillRect(cx - ww * 0.42, top + hh * 0.18, ww * 0.84, hh * 0.64); ctx.fillStyle = C('#e0263f'); ctx.fillRect(cx - ww * 0.08, top + hh * 0.28, ww * 0.16, hh * 0.44); ctx.fillRect(cx - ww * 0.28, top + hh * 0.42, ww * 0.56, hh * 0.16); }
        else if (sp.t === 'ammo') { ctx.fillStyle = C('#4d5a3a'); ctx.fillRect(cx - ww * 0.40, top + hh * 0.30, ww * 0.80, hh * 0.52); ctx.fillStyle = C('#ffd24a'); for (let b = 0; b < 3; b++) ctx.fillRect(cx - ww * 0.24 + b * ww * 0.18, top + hh * 0.16, ww * 0.08, hh * 0.18); }
        else if (sp.t === 'armor') { ctx.fillStyle = C('#27455e'); ctx.fillRect(cx - ww * 0.34, top + hh * 0.14, ww * 0.68, hh * 0.72); ctx.fillStyle = C('#8fb4ff'); ctx.fillRect(cx - ww * 0.20, top + hh * 0.28, ww * 0.40, hh * 0.16); }
        else if (sp.t === 'throw') { ctx.fillStyle = C('#3a4148'); ctx.beginPath(); ctx.ellipse(cx, top + hh * 0.55, ww * 0.24, hh * 0.30, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = C('#ff9a3c'); ctx.fillRect(cx - ww * 0.10, top + hh * 0.16, ww * 0.20, hh * 0.12); }
        else { ctx.fillStyle = C('#2b2e35'); ctx.fillRect(cx - ww * 0.46, top + hh * 0.42, ww * 0.92, hh * 0.14); ctx.fillRect(cx - ww * 0.10, top + hh * 0.56, ww * 0.14, hh * 0.28); ctx.fillRect(cx + ww * 0.20, top + hh * 0.30, ww * 0.10, hh * 0.12); }
        return;
      }
      // breakable props
      ctx.fillStyle = C('#7a6a52'); ctx.fillRect(cx - ww * 0.46, top + hh * 0.12, ww * 0.92, hh * 0.86);
      ctx.strokeStyle = C('#5d5140'); ctx.lineWidth = Math.max(1, ww * 0.05);
      ctx.strokeRect(cx - ww * 0.46, top + hh * 0.12, ww * 0.92, hh * 0.86);
      ctx.beginPath(); ctx.moveTo(cx - ww * 0.46, top + hh * 0.42); ctx.lineTo(cx + ww * 0.46, top + hh * 0.42);
      ctx.moveTo(cx - ww * 0.46, top + hh * 0.70); ctx.lineTo(cx + ww * 0.46, top + hh * 0.70); ctx.stroke();
    }

    /* ---------------- procedural weapon viewmodels ---------------- */
    drawViewmodel(ctx, me, dt) {
      const W = this.w, H = this.h, u = H / 360;
      const kind = (me && me.wp) || 'rifle';
      this.yawVel = (this.yaw - (this._pyaw === undefined ? this.yaw : this._pyaw)) / Math.max(dt, 1e-4);
      this._pyaw = this.yaw;
      const yv = clamp(this.yawVel, -3.2, 3.2);
      const kick = this.fpMuzzle > 0 ? this.fpMuzzle / 0.07 : 0;
      if (this.fpMuzzle > 0) this.fpMuzzle -= dt;
      const rl = me && me.rl > 0 ? me.rl : 0;
      const dip = rl > 0 ? Math.sin(Math.min(1, rl / 1.4) * Math.PI) : 0;
      const gx = W * 0.64 - yv * 13 * u + Math.sin(this.fpBob) * (this.fpMoving ? 7 : 2.5) * u;
      const gy = H * 0.92 + Math.abs(Math.cos(this.fpBob)) * (this.fpMoving ? 6 : 2) * u + kick * 9 * u + dip * 30 * u;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(-0.40 + yv * 0.018 + kick * 0.035 + dip * 0.22);   // barrel rises toward the crosshair
      ctx.scale(1.12, 1.12);
      const G = '#23262e', G2 = '#343945', GD = '#101318', WOOD = '#5b3a20', GLOVE = '#39422f', GLOVE2 = '#2a3123';
      const R = (x, y, w2, h2, c) => { ctx.fillStyle = c; ctx.fillRect(x * u, y * u, w2 * u, h2 * u); };
      const hand = (x, y, r) => { ctx.fillStyle = GLOVE; ctx.beginPath(); ctx.ellipse(x * u, y * u, r * 1.2 * u, r * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = GLOVE2; ctx.fillRect((x - r) * u, (y - 1) * u, r * 2 * u, r * 0.6 * u); };
      const flash = (x, y) => {
        if (kick <= 0) return;
        ctx.fillStyle = 'rgba(255,196,90,' + (kick * 0.9).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(x * u, y * u, 13 * u, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,236,170,' + (kick * 0.8).toFixed(2) + ')'; ctx.lineWidth = 2.4 * u;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const a = k * 1.256 + this.time * 3; ctx.moveTo(x * u, y * u); ctx.lineTo(x * u + Math.cos(a) * 24 * u, y * u + Math.sin(a) * 24 * u); }
        ctx.stroke();
      };
      if (kind === 'shotgun') {
        R(-92, -12, 34, 18, WOOD); R(-60, -14, 70, 20, G); R(8, -11, 52, 9, GD); R(8, 0, 48, 7, '#1a1d24');
        R(24, -2, 26, 12, WOOD); R(60, -13, 6, 5, GD); hand(30, 10, 9); hand(-34, 12, 9); flash(70, -7);
      } else if (kind === 'smg') {
        R(-70, -12, 26, 14, G2); R(-46, -14, 62, 20, G); R(-16, 6, 13, 30, G2); R(16, -10, 30, 8, GD);
        R(46, -11, 7, 10, GD); R(-8, -22, 20, 8, GD); hand(10, 8, 8); hand(-30, 12, 8); flash(56, -7);
      } else if (kind === 'revolver') {
        R(-30, 4, 16, 26, WOOD); R(-32, -8, 44, 14, '#3b3f4a'); ctx.fillStyle = '#22252d';
        ctx.beginPath(); ctx.arc(2 * u, -1 * u, 9 * u, 0, Math.PI * 2); ctx.fill();
        R(12, -6, 34, 7, '#2b2e35'); R(44, -8, 5, 11, '#22252d'); hand(-14, 14, 9); hand(-2, 16, 8); flash(52, -3);
      } else if (kind === 'lmg') {
        R(-96, -12, 36, 18, G2); R(-62, -16, 84, 22, G); R(-30, -28, 30, 12, GD);
        R(22, -12, 58, 9, GD); R(30, 4, 26, 22, '#2c3039'); R(80, -14, 8, 13, GD);
        hand(34, 10, 9); hand(-36, 12, 9); flash(92, -8);
      } else if (kind === 'burst') {
        R(-94, -12, 34, 18, G2); R(-62, -15, 76, 21, G); R(-24, -26, 30, 11, GD);
        R(-14, 6, 13, 26, G2); R(14, -12, 44, 14, G2); R(58, -9, 24, 7, GD); R(-6, -32, 16, 7, GD);
        hand(26, 9, 9); hand(-32, 12, 9); flash(86, -6);
      } else {                                                    // assault rifle
        R(-98, -11, 36, 17, G2);                                   // stock
        R(-64, -15, 78, 21, G);                                    // receiver
        R(-30, -27, 28, 12, GD);                                   // optic
        ctx.fillStyle = '#66e0ff'; ctx.fillRect((-27) * u, (-24) * u, 5 * u, 6 * u);
        if (dip > 0.15) { ctx.save(); ctx.translate((-12) * u, 6 * u); ctx.rotate(dip * 0.5); R(-7, 0, 14, 30, G2); ctx.restore(); }
        else R(-19, 6, 14, 30, G2);                                // curved-ish mag
        R(14, -12, 46, 15, G2);                                    // handguard
        ctx.fillStyle = GD; for (let v = 0; v < 3; v++) ctx.fillRect((20 + v * 13) * u, (-9) * u, 8 * u, 9 * u);
        R(60, -8, 26, 7, GD); R(86, -10, 9, 11, GD);               // barrel + brake
        R(38, -19, 4, 8, GD);                                      // front sight
        if (dip < 0.4) hand(28, 9, 9);
        hand(-32, 12, 9);
        flash(98, -5);
      }
      ctx.restore();
    }

    /* ---------------- CoD-style canvas HUD ---------------- */
    static degFromYaw(yaw) { const d = (yaw * 180 / Math.PI + 90) % 360; return d < 0 ? d + 360 : d; }
    /* ---------------- CODM / Warzone-style canvas HUD ---------------- */
    drawMinimapFP(ctx, ents, u) {
      const own = this.ownPos, L = this.level;
      if (!own || !L) return;
      const TS = L.tile || 32;
      const R = 54 * u, cx = R + 13 * u, cy = R + 13 * u;
      const scale = (R * 0.94) / (17 * TS);
      const th = -this.yaw - Math.PI / 2;                 // forward = up
      const c = Math.cos(th), s = Math.sin(th);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
      ctx.fillStyle = 'rgba(6,9,13,.74)'; ctx.fill();
      ctx.clip();
      ctx.translate(cx, cy); ctx.rotate(th);
      const h = TS * scale / 2;
      const ox = own.x, oy = own.y, reach = 17 * TS;
      ctx.fillStyle = 'rgba(120,132,150,.5)';
      const t0x = Math.floor((ox - reach) / TS), t1x = Math.floor((ox + reach) / TS);
      const t0y = Math.floor((oy - reach) / TS), t1y = Math.floor((oy + reach) / TS);
      for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
        if (!LV.isSolid(L, tx * TS + TS / 2, ty * TS + TS / 2)) continue;
        ctx.fillRect((tx * TS + TS / 2 - ox) * scale - h, (ty * TS + TS / 2 - oy) * scale - h, h * 2, h * 2);
      }
      const dot = (wx, wy, r, colr) => { ctx.fillStyle = colr; ctx.beginPath(); ctx.arc((wx - ox) * scale, (wy - oy) * scale, r, 0, 6.2832); ctx.fill(); };
      for (const it of (ents.it || [])) if (Math.hypot(it.x - ox, it.y - oy) < reach) dot(it.x, it.y, 1.6 * u, '#ffb02e');
      if (L.extract) {
        const ex = (L.extract.x - ox) * scale, ey = (L.extract.y - oy) * scale;
        const d = Math.hypot(ex, ey), k = d > R * 0.9 ? (R * 0.9) / d : 1;
        ctx.fillStyle = '#4ade80';
        ctx.save(); ctx.translate(ex * k, ey * k); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.4 * u, -2.4 * u, 4.8 * u, 4.8 * u); ctx.restore();
      }
      for (const sv of (ents.surv || [])) if (sv.id !== this.youId && !sv.dd) dot(sv.x, sv.y, 2.6 * u, '#5ad1ff');
      for (const e of (ents.en || [])) if (Math.hypot(e.x - ox, e.y - oy) < reach) dot(e.x, e.y, e.boss ? 3.6 * u : 2.4 * u, e.boss ? '#ff2d55' : '#ff3b30');
      ctx.restore();
      // ring + rotating compass letters
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1 * u;
      for (let d = 0; d < 360; d += 45) {
        const wa = (d - 90) * Math.PI / 180;              // world angle of compass deg d (N=-y)
        const ra = wa + th;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ra) * (R - 3 * u), cy + Math.sin(ra) * (R - 3 * u));
        ctx.lineTo(cx + Math.cos(ra) * R, cy + Math.sin(ra) * R);
        ctx.stroke();
      }
      const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
      ctx.font = '700 ' + (8 * u) + 'px ' + HUDFONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const d of [0, 90, 180, 270]) {
        const ra = (d - 90) * Math.PI / 180 + th;
        ctx.fillStyle = d === 0 ? '#ffd24a' : 'rgba(255,255,255,.8)';
        ctx.fillText(CARD[d], cx + Math.cos(ra) * (R + 6.5 * u), cy + Math.sin(ra) * (R + 6.5 * u));
      }
      ctx.textBaseline = 'alphabetic';
      // own arrow + view cone
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 0.85, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(cx, cy - 5.5 * u); ctx.lineTo(cx - 3.6 * u, cy + 4.5 * u); ctx.lineTo(cx + 3.6 * u, cy + 4.5 * u); ctx.closePath(); ctx.fill();
    }

    drawHud(ctx, ents, snap, dt) {
      const W = this.w, H = this.h, u = H / 360;
      const me = this.youId ? ents.surv.find(e => e.id === this.youId) : null;
      if (this.hitT > 0) this.hitT -= dt;
      const txt = (str, x, y, size, colr, align, weight) => {
        ctx.font = (weight || 700) + ' ' + (size * u) + 'px ' + HUDFONT;
        ctx.textAlign = align || 'left';
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText(str, x + 1.2 * u, y + 1.2 * u);
        ctx.fillStyle = colr; ctx.fillText(str, x, y);
      };
      // customizable HUD layout hooks (client/hudlayout.js -> canvasPos)
      const HP = (typeof window !== 'undefined' && window.ABAW_HUDL && window.ABAW_HUDL.canvasPos) ? window.ABAW_HUDL.canvasPos(W, H) : (this.hudPos || {});
      const withPanel = (key, fn) => {
        const p = HP[key];
        if (!p || (!p.dx && !p.dy && (p.o == null || p.o === 1))) { fn(); return; }
        if (!isFinite(p.dx) || !isFinite(p.dy) || !isFinite(p.o == null ? 1 : p.o)) { fn(); return; }
        ctx.save();
        if (p.dx || p.dy) ctx.translate(p.dx || 0, p.dy || 0);
        if (p.o != null && p.o !== 1) ctx.globalAlpha = (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1) * p.o;
        fn();
        ctx.restore();
      };
      withPanel('minimap', () => this.drawMinimapFP(ctx, ents, u));

      // ---- thin compass strip (Warzone) ----
      withPanel('compass', () => {
      const deg = Renderer.degFromYaw(this.yaw);
      const cw = Math.min(W * 0.40, 430 * u), ch = 13 * u, cx0 = W / 2, cy0 = 9 * u + ch / 2, pxd = cw / 90;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx0 - cw / 2, cy0 - ch / 2, cw, ch); ctx.clip();
      const grd = ctx.createLinearGradient(cx0 - cw / 2, 0, cx0 + cw / 2, 0);
      grd.addColorStop(0, 'rgba(6,9,13,0)'); grd.addColorStop(0.18, 'rgba(6,9,13,.62)');
      grd.addColorStop(0.82, 'rgba(6,9,13,.62)'); grd.addColorStop(1, 'rgba(6,9,13,0)');
      ctx.fillStyle = grd; ctx.fillRect(cx0 - cw / 2, cy0 - ch / 2, cw, ch);
      const CARDS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      for (let d = Math.floor((deg - 45) / 15) * 15; d <= deg + 45; d += 15) {
        const x = cx0 + (d - deg) * pxd, dd = ((d % 360) + 360) % 360;
        if (CARDS[dd] !== undefined) txt(CARDS[dd], x, cy0 + 3 * u, 8.5, dd === 0 ? '#ffd24a' : 'rgba(255,255,255,.92)', 'center');
        else { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, cy0 + ch / 2 - 4 * u); ctx.lineTo(x, cy0 + ch / 2 - 1 * u); ctx.stroke(); }
      }
      if (this.ownPos) {
        const pip = (bx, by, colr) => {
          const bdeg = Renderer.degFromYaw(Math.atan2(by, bx));
          const diff = ((bdeg - deg + 540) % 360) - 180;
          if (Math.abs(diff) > 45) return;
          ctx.fillStyle = colr;
          ctx.fillRect(cx0 + diff * pxd - 1.2 * u, cy0 - ch / 2 + 1 * u, 2.4 * u, ch - 2 * u);
        };
        for (const e of (ents.en || [])) {
          const dx = e.x - this.ownPos.x, dy = e.y - this.ownPos.y;
          if (Math.hypot(dx, dy) < 12 * ((this.level && this.level.tile) || 32)) pip(dx, dy, e.boss ? '#ff2d55' : '#ff3b30');
        }
        if (this.level && this.level.extract) pip(this.level.extract.x - this.ownPos.x, this.level.extract.y - this.ownPos.y, '#4ade80');
      }
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(cx0, cy0 + ch / 2 + 1 * u); ctx.lineTo(cx0 - 3.4 * u, cy0 + ch / 2 + 6 * u); ctx.lineTo(cx0 + 3.4 * u, cy0 + ch / 2 + 6 * u); ctx.closePath(); ctx.fill();
      });

      // ---- crosshair (outlined, dynamic) ----
      const tgt = 5 + (this.fpMoving ? 6 : 0) + (this.fpMuzzle > 0 ? 7 : 0) + ((me && me.sp) ? 3 : 0);
      this.spread += (tgt - this.spread) * Math.min(1, dt * 14);
      const g = this.spread * u, L2 = 6.5 * u;
      const xhair = (colr, lw) => {
        ctx.strokeStyle = colr; ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(W / 2 - g - L2, H / 2); ctx.lineTo(W / 2 - g, H / 2);
        ctx.moveTo(W / 2 + g, H / 2); ctx.lineTo(W / 2 + g + L2, H / 2);
        ctx.moveTo(W / 2, H / 2 - g - L2); ctx.lineTo(W / 2, H / 2 - g);
        ctx.moveTo(W / 2, H / 2 + g); ctx.lineTo(W / 2, H / 2 + g + L2);
        ctx.stroke();
      };
      xhair('rgba(0,0,0,.8)', 3.2 * u);
      xhair('rgba(255,255,255,.95)', 1.5 * u);
      ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(W / 2 - 1.4 * u, H / 2 - 1.4 * u, 2.8 * u, 2.8 * u);
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(W / 2 - 0.7 * u, H / 2 - 0.7 * u, 1.4 * u, 1.4 * u);
      // hitmarker
      if (this.hitT > 0) {
        const a = clamp(this.hitT / 0.14, 0, 1), r1 = 5 * u, r2 = 12 * u;
        const hm = (colr, lw) => {
          ctx.strokeStyle = colr; ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(W / 2 + r1, H / 2 + r1); ctx.lineTo(W / 2 + r2, H / 2 + r2);
          ctx.moveTo(W / 2 + r1, H / 2 - r1); ctx.lineTo(W / 2 + r2, H / 2 - r2);
          ctx.moveTo(W / 2 - r1, H / 2 + r1); ctx.lineTo(W / 2 - r2, H / 2 + r2);
          ctx.moveTo(W / 2 - r1, H / 2 - r1); ctx.lineTo(W / 2 - r2, H / 2 - r2);
          ctx.stroke();
        };
        hm('rgba(0,0,0,.85)', 3.4 * u);
        hm(this.hitCrit ? 'rgba(255,80,60,' + a.toFixed(2) + ')' : 'rgba(255,255,255,' + a.toFixed(2) + ')', 1.8 * u);
      }

      // ---- health: bottom-left, cross icon + slim bar ----
      if (me) withPanel('health', () => {
        const bx = 16 * u, by = H - 20 * u, bw = 148 * u, bh = 5 * u;
        const low = me.hp / me.mhp <= 0.35;
        ctx.fillStyle = low ? '#ff5f52' : '#e8ecf2';                       // med cross
        ctx.fillRect(bx, by - 9 * u, 3.2 * u, 10 * u); ctx.fillRect(bx - 3.4 * u, by - 5.6 * u, 10 * u, 3.2 * u);
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx + 12 * u, by - 2 * u, bw, bh);
        ctx.fillStyle = low ? '#ff5f52' : '#8ef0a0';
        ctx.fillRect(bx + 12 * u, by - 2 * u, bw * clamp(me.hp / me.mhp, 0, 1), bh);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.8 * u;
        ctx.strokeRect(bx + 12 * u, by - 2 * u, bw, bh);
        if (me.arm > 0) { ctx.fillStyle = '#8fb4ff'; ctx.fillRect(bx + 12 * u, by - 5 * u, bw * clamp(me.ar / (me.arm || 1), 0, 1), 2 * u); }
        txt(String(Math.max(0, me.hp)), bx + 16 * u + bw, by + 3.5 * u, 10, low ? '#ff5f52' : 'rgba(255,255,255,.85)', 'left', 600);
      });
      if (me && me.hp / me.mhp < 0.3) {
        const a = 0.15 + 0.11 * Math.sin(this.time * 6);
        const gg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.78);
        gg.addColorStop(0, 'rgba(120,0,0,0)'); gg.addColorStop(1, 'rgba(150,0,0,' + a.toFixed(3) + ')');
        ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
        }

      // ---- ammo cluster: bottom-right, big condensed numbers ----
      if (me) withPanel('ammo', () => {
        const ax = W - 18 * u;
        txt(String(me.mag), ax - 44 * u, H - 22 * u, 34, me.mag === 0 ? '#ff5f52' : '#f2f5f9', 'right', 800);
        txt('/ ' + me.res, ax, H - 24 * u, 13, 'rgba(242,245,249,.66)', 'right', 600);
        const wn = String(((D.WEAPONS || {})[me.wp] || {}).name || me.wp || '').toUpperCase();
        txt(wn, ax, H - 44 * u, 9, 'rgba(242,245,249,.6)', 'right', 600);
        const wdef = (D.WEAPONS || {})[me.wp] || {};
        if (me.rl > 0 && wdef.reload) {
          const pw = 74 * u, prog = clamp(1 - me.rl / wdef.reload, 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(ax - pw, H - 14 * u, pw, 2.6 * u);
          ctx.fillStyle = '#ffd24a'; ctx.fillRect(ax - pw, H - 14 * u, pw * prog, 2.6 * u);
        } else if (me.tn > 0) {
          ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 1.2 * u;
          ctx.beginPath(); ctx.arc(ax - 84 * u, H - 28 * u, 5 * u, 0, 6.2832); ctx.stroke();
          txt('x' + me.tn, ax - 74 * u, H - 24 * u, 10, '#ff9a3c', 'left', 700);
        }
      });
      if (me) txt('KILLS  ' + (me.k || 0), W - 16 * u, 20 * u, 11, 'rgba(242,245,249,.9)', 'right', 700);

      // ---- boss bar: segmented, top-centre under compass ----
      const boss = (ents.en || []).find(e => e.b);
      if (boss) {
        const bw2 = Math.min(W * 0.38, 380 * u), bx2 = W / 2 - bw2 / 2, by2 = 32 * u, seg = 24;
        txt(String(((D.ENEMIES || {})[boss.t] || {}).name || 'MANANANGGAL').toUpperCase(), W / 2, by2 - 3 * u, 10, '#ff2d55', 'center', 800);
        const frac = clamp(boss.hp / (boss.mhp || 1), 0, 1);
        for (let i = 0; i < seg; i++) {
          const on = (i + 0.5) / seg <= frac;
          ctx.fillStyle = on ? '#ff2d55' : 'rgba(255,255,255,.13)';
          ctx.fillRect(bx2 + (bw2 / seg) * i + 0.6 * u, by2, bw2 / seg - 1.2 * u, 4.5 * u);
        }
      }
      ctx.textAlign = 'left';
    }

    static threatMarker(bear, W, H, m) {
      const vx = Math.cos(bear), vy = Math.sin(bear);   // view space: +x fwd, +y right
      const behind = vx < 0;
      const kx = Math.abs(vy) < 1e-4 ? Infinity : (W / 2 - m) / Math.abs(vy);
      const ky = Math.abs(vx) < 1e-4 ? Infinity : (H / 2 - m) / Math.abs(vx);
      const K = Math.min(kx, ky);
      return { px: W / 2 + vy * K, py: H / 2 - vx * K, side: vy >= 0 ? 1 : -1, behind };
    }

    drawAwareness(ctx, ents, dt) {
      const W = this.w, H = this.h, own = this.ownPos;
      if (!own || !this.level) return;
      const TS = this.level.tile || 32;
      if (this.hurtDirT > 0) this.hurtDirT -= dt;
      for (const e of (ents.en || [])) {
        if (e.dd) continue;
        const dx = e.x - own.x, dy = e.y - own.y;
        const d = Math.hypot(dx, dy);
        if (d > 11 * TS || d < 1) continue;
        let bear = Math.atan2(dy, dx) - this.yaw;
        while (bear > Math.PI) bear -= 2 * Math.PI;
        while (bear < -Math.PI) bear += 2 * Math.PI;
        if (Math.abs(bear) < 0.52) continue;                 // inside the view cone
        const m = Renderer.threatMarker(bear, W, H, 26);
        const a = Math.max(0, Math.min(1, 1 - d / (11 * TS))) * 0.8 + 0.2;
        const s = 9 + 7 * a + (e.boss ? 4 : 0);
        ctx.globalAlpha = a * (m.behind ? 0.5 : 0.95);
        ctx.fillStyle = e.boss ? '#ff2d55' : '#e0263f';
        ctx.save(); ctx.translate(m.px, m.py);
        ctx.rotate(Math.atan2(m.py - H / 2, m.px - W / 2));   // point away from centre
        ctx.beginPath();
        ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.8); ctx.lineTo(-s * 0.7, s * 0.8);
        ctx.closePath(); ctx.fill(); ctx.restore();
        if (d < 3.5 * TS) {                                   // too close for comfort
          const pulse = 0.30 * (1 - d / (3.5 * TS)) * (0.65 + 0.35 * Math.sin(this.time * 7));
          const g = ctx.createRadialGradient(m.px, m.py, 2, m.px, m.py, 90);
          g.addColorStop(0, 'rgba(224,38,63,' + pulse.toFixed(3) + ')');
          g.addColorStop(1, 'rgba(224,38,63,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = g;
          ctx.fillRect(m.px - 90, m.py - 90, 180, 180);
        }
      }
      ctx.globalAlpha = 1;
      if (this.hurtDirT > 0) {                                // "galing SAAN yung tama?"
        let hb = this.hurtDir - this.yaw;
        while (hb > Math.PI) hb -= 2 * Math.PI;
        while (hb < -Math.PI) hb += 2 * Math.PI;
        const m = Renderer.threatMarker(hb, W, H, 34);
        ctx.globalAlpha = Math.max(0, Math.min(1, this.hurtDirT / 0.9)) * 0.85;
        ctx.strokeStyle = '#ff2038'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(m.px, m.py, 24, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    drawMinimap(canvas, snap) {
      const L = this.level; if (!L) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#070a0f'; ctx.fillRect(0, 0, W, H);
      const sc = Math.min(W / (L.w * L.tile), H / (L.h * L.tile));
      const ox = (W - L.w * L.tile * sc) / 2, oy = (H - L.h * L.tile * sc) / 2;
      // downsample grid
      const step = 2;
      for (let y = 0; y < L.h; y += step) for (let x = 0; x < L.w; x += step) {
        const t = L.g[y * L.w + x];
        let c = null;
        if (t === T.WALL) c = '#3a4048'; else if (t === T.BLOCK) c = '#33383f';
        else if (t === T.WATER) c = '#1c3040'; else if (t === T.RAIL) c = '#2e2a22';
        else if (t === T.GAP) c = '#04050a'; else if (t === T.RUBBLE) c = '#2c2a24';
        else c = '#22262c';
        ctx.fillStyle = c;
        ctx.fillRect(ox + x * L.tile * sc, oy + y * L.tile * sc, L.tile * sc * step + .6, L.tile * sc * step + .6);
      }
      // path
      ctx.strokeStyle = 'rgba(255,176,46,.30)'; ctx.lineWidth = 1.6; ctx.beginPath();
      L.marks.forEach((m, i) => { const px = ox + m.x * sc, py = oy + m.y * sc; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
      // objective
      const o = snap.obj;
      if (o && o.x) {
        ctx.strokeStyle = o.type === 'extract' ? '#4ade80' : '#ffb02e'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(ox + o.x * sc, oy + o.y * sc, Math.max(4, o.r * sc), 0, TAU); ctx.stroke();
      }
      // generators
      (snap.gn || []).forEach(g => {
        ctx.fillStyle = g.d ? '#4ade80' : '#ffe6a8';
        ctx.fillRect(ox + g.x * sc - 2, oy + g.y * sc - 2, 4, 4);
      });
      // enemies
      for (const e of snap.en) {
        const d = D.ENEMIES[e.t];
        ctx.fillStyle = e.b ? '#ff2d55' : (d && d.tier === 'special') ? '#ff8a3c' : '#c23040';
        const r = e.b ? 4 : (d && d.tier === 'special') ? 2.6 : 1.5;
        ctx.beginPath(); ctx.arc(ox + e.x * sc, oy + e.y * sc, r, 0, TAU); ctx.fill();
      }
      // survivors
      for (const s of snap.surv) {
        const hd = D.SURVIVORS[s.hero];
        ctx.fillStyle = s.dd ? '#555' : s.dn ? '#e0263f' : (s.id === this.youId ? '#ffffff' : hd.color);
        ctx.beginPath(); ctx.arc(ox + s.x * sc, oy + s.y * sc, s.id === this.youId ? 3.6 : 3, 0, TAU); ctx.fill();
        if (s.id === this.youId) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox + s.x * sc, oy + s.y * sc); ctx.lineTo(ox + (s.x + Math.cos(s.a) * 130) * sc, oy + (s.y + Math.sin(s.a) * 130) * sc); ctx.stroke(); }
      }
      // frame
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, W - 1, H - 1);
    }
  }

  /* ---------- helpers ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hex2rgb(h) {
    h = (h || '#fff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function hexA(h, a) { const c = hex2rgb(h); return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
  function shade(h, amt) {
    const c = hex2rgb(h);
    const f = v => Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt));
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * t;
  }

  /* ---------- portrait for menus/HUD (procedural) ---------- */
  function drawPortrait(canvas, heroId, size) {
    const hero = D.SURVIVORS[heroId]; if (!hero || !canvas) return;
    const w = canvas.width = size || 120, h = canvas.height = (size || 120) * 1.1;
    const x = canvas.getContext('2d');
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(hero.color, -0.62)); g.addColorStop(1, '#080a0f');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // rim light
    x.save(); x.globalCompositeOperation = 'lighter';
    const rg = x.createRadialGradient(w * .5, h * .35, 4, w * .5, h * .35, w * .7);
    rg.addColorStop(0, hexA(hero.accent, .22)); rg.addColorStop(1, hexA(hero.accent, 0));
    x.fillStyle = rg; x.fillRect(0, 0, w, h); x.restore();
    const s = w / 120;
    x.save(); x.translate(w / 2, h * 0.96); x.scale(s * 1.5, s * 1.5);
    // bust
    x.fillStyle = shade(hero.color, -0.18);
    roundRect(x, -22, -34, 44, 40, 12); x.fill();
    x.fillStyle = shade(hero.color, 0.14);
    roundRect(x, -17, -30, 34, 18, 7); x.fill();
    x.fillStyle = hero.accent; x.fillRect(-17, -12, 34, 4);
    // shoulders
    x.fillStyle = shade(hero.color, -0.34);
    x.beginPath(); x.arc(-20, -28, 9, 0, TAU); x.arc(20, -28, 9, 0, TAU); x.fill();
    // neck + head
    x.fillStyle = shade(hero.skin, -0.2); x.fillRect(-6, -44, 12, 12);
    x.fillStyle = hero.skin; x.beginPath(); x.arc(0, -54, 16, 0, TAU); x.fill();
    x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.arc(4, -50, 15, 0, TAU); x.fill();
    x.fillStyle = hero.skin; x.beginPath(); x.arc(-3, -54, 14.6, 0, TAU); x.fill();
    // hair / headgear
    if (heroId === 'berto') { x.fillStyle = '#1d2a3d'; x.beginPath(); x.arc(0, -57, 16.4, Math.PI, TAU); x.fill(); x.fillStyle = '#2f6fb5'; x.fillRect(-17, -60, 34, 6); x.fillStyle = '#ffd24a'; x.fillRect(-17, -55, 34, 2); }
    else if (heroId === 'rhea') { x.fillStyle = '#241a16'; x.beginPath(); x.arc(0, -56, 17, Math.PI * .92, TAU * 1.05); x.fill(); x.fillStyle = '#241a16'; roundRect(x, 9, -54, 8, 26, 4); x.fill(); roundRect(x, -17, -54, 8, 24, 4); x.fill(); }
    else if (heroId === 'junjun') { x.fillStyle = '#c0392b'; x.beginPath(); x.arc(0, -58, 16.6, Math.PI, TAU); x.fill(); x.fillStyle = '#a5322a'; roundRect(x, -26, -62, 18, 7, 3); x.fill(); }
    else { x.fillStyle = '#3d3226'; x.beginPath(); x.arc(0, -57, 16.6, Math.PI, TAU); x.fill(); x.fillStyle = '#8a2b2b'; x.fillRect(-16, -60, 32, 6); }
    // face
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(-9, -56, 4.4, 3.4); x.fillRect(4, -56, 4.4, 3.4);
    x.fillStyle = '#1a1208'; x.fillRect(-7.6, -55.4, 2.2, 2.4); x.fillRect(5.4, -55.4, 2.2, 2.4);
    x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(-4, -46); x.lineTo(3, -46); x.stroke();
    // weapon silhouette
    x.fillStyle = '#15171b';
    if (hero.weapon === 'shotgun') { x.save(); x.rotate(-0.35); x.fillRect(-6, -22, 44, 7); x.fillStyle = '#5b3a20'; x.fillRect(-14, -21, 14, 9); x.restore(); }
    else if (hero.weapon === 'burst') { x.save(); x.rotate(-0.28); x.fillRect(-4, -20, 40, 6); x.fillStyle = '#3a3d45'; x.fillRect(6, -25, 12, 5); x.restore(); }
    else if (hero.weapon === 'smg') { x.save(); x.rotate(-0.2); x.fillRect(-4, -22, 24, 5); x.fillRect(-4, -14, 24, 5); x.restore(); }
    else { x.save(); x.rotate(-0.3); x.fillRect(-6, -21, 48, 7); x.fillStyle = '#4a3520'; x.fillRect(-16, -20, 14, 9); x.restore(); }
    x.restore();
    // scanlines
    x.save(); x.globalAlpha = .10; x.fillStyle = '#000';
    for (let i = 0; i < h; i += 3) x.fillRect(0, i, w, 1);
    x.restore();
  }

  root.ABAW_RENDER = { Renderer, drawPortrait, roundRect, shade, hexA, hex2rgb };
})(typeof self !== 'undefined' ? self : this);
