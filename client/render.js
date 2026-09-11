/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  client/render.js
   Procedural 2.5D renderer. Every pixel is drawn in code:
   chunked tile atlas, extruded walls, 8-directional characters,
   dynamic lighting, typhoon weather, gore decals and particles.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.ABAW_DATA, LV = root.ABAW_LEVEL, AU = root.ABAW_AUDIO;
  const T = D.TILE;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  /* ============ procedural sprite cache ============ */
  function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ---------- TILE ATLAS ---------- */
  function buildTiles(tile, biome) {
    const A = { size: tile, v: {} };
    const variants = { road: 5, floor: 5, water: 1, rubble: 4, rail: 2, walltop: 4, block: 3 };
    const key = biome === 'station' ? 'floor' : 'road';
    for (const k in variants) {
      A.v[k] = [];
      for (let i = 0; i < variants[k]; i++) A.v[k].push(drawTileVariant(k, tile, i, biome));
    }
    A.baseKey = key;
    return A;
  }
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

  /* ---------- CHUNK CACHE (ground + extruded walls) ---------- */
  const CHUNK = 8;
  class Chunks {
    constructor(renderer) { this.r = renderer; this.g = new Map(); this.w = new Map(); this.order = []; }
    clear() { this.g.clear(); this.w.clear(); this.order = []; }
    key(cx, cy) { return cx + ',' + cy; }
    ground(cx, cy) {
      const k = this.key(cx, cy);
      let c = this.g.get(k);
      if (c) return c;
      c = this.buildGround(cx, cy);
      this.g.set(k, c); this.touch(k);
      return c;
    }
    wall(cx, cy) {
      const k = this.key(cx, cy);
      let c = this.w.get(k);
      if (c) return c;
      c = this.buildWall(cx, cy);
      this.w.set(k, c); this.touch(k);
      return c;
    }
    touch(k) {
      this.order.push(k);
      if (this.order.length > 64) {
        const old = this.order.shift();
        this.g.delete(old); this.w.delete(old);
      }
    }
    buildGround(cx, cy) {
      const R = this.r, L = R.level, s = L.tile, W = CHUNK * s;
      const c = cvs(W, W), x = c.getContext('2d');
      const A = R.atlas;
      for (let oy = 0; oy < CHUNK; oy++) for (let ox = 0; ox < CHUNK; ox++) {
        const gx = cx * CHUNK + ox, gy = cy * CHUNK + oy;
        if (gx < 0 || gy < 0 || gx >= L.w || gy >= L.h) { x.fillStyle = '#05060a'; x.fillRect(ox * s, oy * s, s, s); continue; }
        const t = L.g[gy * L.w + gx];
        const v = hash(gx, gy);
        let img = null;
        if (t === T.ROAD) img = A.v.road[Math.floor(v * A.v.road.length)];
        else if (t === T.FLOOR) img = A.v.floor[Math.floor(v * A.v.floor.length)];
        else if (t === T.WATER) img = A.v.water[0];
        else if (t === T.RUBBLE) img = A.v.rubble[Math.floor(v * A.v.rubble.length)];
        else if (t === T.RAIL) img = A.v.rail[Math.floor(v * A.v.rail.length)];
        else if (t === T.WALL) img = A.v.walltop[Math.floor(v * A.v.walltop.length)];
        else if (t === T.BLOCK) img = A.v.block[Math.floor(v * A.v.block.length)];
        else if (t === T.GAP) { x.fillStyle = '#04050a'; x.fillRect(ox * s, oy * s, s, s); continue; }
        if (img) x.drawImage(img, ox * s, oy * s);
      }
      return c;
    }
    buildWall(cx, cy) {
      const R = this.r, L = R.level, s = L.tile, W = CHUNK * s, H = R.wallH;
      const c = cvs(W, W + H), x = c.getContext('2d');
      for (let oy = 0; oy < CHUNK; oy++) for (let ox = 0; ox < CHUNK; ox++) {
        const gx = cx * CHUNK + ox, gy = cy * CHUNK + oy;
        if (gx < 0 || gy < 0 || gx >= L.w || gy >= L.h) continue;
        const t = L.g[gy * L.w + gx];
        if (t !== T.WALL && t !== T.BLOCK) continue;
        const px = ox * s, py = oy * s + H;
        const h = t === T.WALL ? H : H * 0.46;
        const below = gy + 1 < L.h ? L.g[(gy + 1) * L.w + gx] : T.WALL;
        const right = gx + 1 < L.w ? L.g[gy * L.w + gx + 1] : T.WALL;
        const solidBelow = (below === T.WALL || below === T.BLOCK);
        const solidRight = (right === T.WALL || right === T.BLOCK);
        // front face
        if (!solidBelow) {
          const g = x.createLinearGradient(0, py - h + s, 0, py + s);
          if (t === T.WALL) { g.addColorStop(0, '#2a2d34'); g.addColorStop(1, '#15171c'); }
          else { g.addColorStop(0, '#3a382f'); g.addColorStop(1, '#1d1c17'); }
          x.fillStyle = g; x.fillRect(px, py - h + s, s, h);
          // face detail
          x.fillStyle = 'rgba(0,0,0,.28)';
          for (let n = 0; n < 3; n++) { const yy = py - h + s + (n + 0.5) * (h / 3); x.fillRect(px, yy, s, 1); }
          if (hash(gx, gy) > 0.72) { x.fillStyle = 'rgba(90,60,40,.22)'; x.fillRect(px + s * .2, py - h + s + h * .3, s * .5, h * .5); }
          if (R.biome === 'station' && hash(gx, gy + 9) > 0.86) { // tiled wall
            x.fillStyle = 'rgba(200,220,230,.06)'; x.fillRect(px + 2, py - h + s + 3, s - 4, h - 8);
          }
        }
        // right face (gives blocks volume)
        if (!solidRight && t === T.BLOCK) {
          x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(px + s - 5, py - h + s, 5, h);
        }
        // top face
        const top = t === T.WALL ? R.atlas.v.walltop[Math.floor(hash(gx, gy) * R.atlas.v.walltop.length)] : R.atlas.v.block[Math.floor(hash(gx + 3, gy) * R.atlas.v.block.length)];
        x.drawImage(top, px, py - h);
        // roof edge highlight
        x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(px, py - h, s, 1);
      }
      return c;
    }
  }

  /* ============ PARTICLES / DECALS / FX ============ */
  class Fx {
    constructor() { this.p = []; this.txt = []; this.decals = []; this.rings = []; this.decalCap = 460; this.cap = 360; }
    clear() { this.p.length = 0; this.txt.length = 0; this.decals.length = 0; this.rings.length = 0; }
    burst(x, y, n, opt) {
      opt = opt || {};
      n = Math.round(n * (this.scale === undefined ? 1 : this.scale));
      if (this.p.length > this.cap) n = Math.min(n, 4);
      for (let i = 0; i < n; i++) {
        const a = opt.a !== undefined ? opt.a + (Math.random() - .5) * (opt.spread || 1.6) : Math.random() * TAU;
        const sp = (opt.sp || 90) * (0.35 + Math.random() * 0.9);
        this.p.push({
          x, y, z: opt.z || 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.72,
          vz: opt.vz !== undefined ? opt.vz * (0.4 + Math.random()) : (opt.grav ? 60 + Math.random() * 90 : 0),
          life: (opt.life || 0.5) * (0.6 + Math.random() * 0.8), max: opt.life || 0.5,
          r: (opt.r || 2.4) * (0.6 + Math.random()), c: opt.c || '#c00', g: opt.grav === undefined ? 260 : opt.grav,
          kind: opt.kind || 'dot', fade: opt.fade === undefined ? 1 : opt.fade, rot: Math.random() * TAU, spin: (Math.random() - .5) * 8
        });
      }
    }
    text(x, y, s, c, big) { this.txt.push({ x, y, s, c: c || '#fff', life: big ? 1.1 : 0.75, max: big ? 1.1 : 0.75, big: !!big, vy: -34 }); }
    decal(x, y, r, c, kind) {
      if (this.decals.length > this.decalCap) this.decals.shift();
      this.decals.push({ x, y, r, c, kind: kind || 'blood', a: Math.random() * TAU, t: 1, seed: Math.random() * 1000 });
    }
    ring(x, y, r0, r1, c, life, w) { this.rings.push({ x, y, r0, r1, c, life, max: life, w: w || 3 }); }
    update(dt) {
      for (let i = this.p.length - 1; i >= 0; i--) {
        const p = this.p[i];
        p.life -= dt;
        if (p.life <= 0) { this.p.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vz) { p.z += p.vz * dt; p.vz -= p.g * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.34; p.vx *= 0.6; p.vy *= 0.6; } }
        p.vx *= (1 - dt * 1.6); p.vy *= (1 - dt * 1.6); p.rot += p.spin * dt;
      }
      for (let i = this.txt.length - 1; i >= 0; i--) { const t = this.txt[i]; t.life -= dt; t.y += t.vy * dt; t.vy *= (1 - dt * 2); if (t.life <= 0) this.txt.splice(i, 1); }
      for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.life -= dt; if (r.life <= 0) this.rings.splice(i, 1); }
      if (this.p.length > 1400) this.p.splice(0, this.p.length - 1400);
    }
  }

  /* ============ RENDERER ============ */
  class Renderer {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.level = null; this.atlas = null; this.chunks = new Chunks(this);
      this.fx = new Fx();
      this.cam = { x: 0, y: 0, zoom: 1 };
      // first-person is the shipped view; flip to false to fall back to top-down
      this.fp = true;
      this.hurtDir = 0; this.hurtDirT = 0; this.ownPos = null;
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
      this.propCache = new Map();
      this.heroCache = new Map();
      this.resize();
      root.addEventListener('resize', () => this.resize());
    }
    /** 'low' | 'medium' | 'high' — rebuilds resolution-dependent buffers. */
    setTier(t) {
      if (!this.TIERS[t]) t = 'high';
      this.tier = t; this.q = this.TIERS[t];
      this.opts.quality = 1;
      if (this.fx) { this.fx.decalCap = this.q.decals; this.fx.cap = Math.round(360 * this.q.fx); this.fx.scale = this.q.fx; }
      this.resize();
      if (this.level) this.seedWeather();
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
    seedWeather() {
      this.rain = [];
      const n = this.q.rain;
      for (let i = 0; i < n; i++) this.rain.push({ x: Math.random() * this.w, y: Math.random() * this.h, l: 8 + Math.random() * 22, s: 620 + Math.random() * 620, o: 0.10 + Math.random() * 0.3 });
      this.fog = [];
      for (let i = 0; i < this.q.fog; i++) this.fog.push({ x: Math.random() * this.w, y: Math.random() * this.h, r: 160 + Math.random() * 320, vx: 6 + Math.random() * 20, o: 0.02 + Math.random() * 0.05 });
      this.lightning = { t: 3 + Math.random() * 6, on: 0 };
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
      this.atlas = buildTiles(this.level.tile, this.biome);
      this.wallH = this.biome === 'station' ? 42 : this.biome === 'skyway' ? 20 : 34;
      this.chunks.clear(); this.fx.clear(); this.propCache.clear();
      this.seedWeather();
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
      if (this.fp) { this.drawFirstPerson(ctx, ents, dt, snap); return; }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#04050a'; ctx.fillRect(0, 0, this.w, this.h);

      const sx = this.shake ? (Math.random() - .5) * this.shake * 2.4 : 0;
      const sy = this.shake ? (Math.random() - .5) * this.shake * 2.4 : 0;
      const z = this.cam.zoom * (this.w < 700 ? 0.82 : 1);
      ctx.save();
      ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
      ctx.scale(z, z);
      ctx.translate(-this.cam.x, -this.cam.y);

      this.viewW = this.w / z; this.viewH = this.h / z;
      this.view = { x0: this.cam.x - this.viewW / 2 - 80, y0: this.cam.y - this.viewH / 2 - 120, x1: this.cam.x + this.viewW / 2 + 80, y1: this.cam.y + this.viewH / 2 + 140 };

      this.drawGround(ctx);
      this.drawDecals(ctx);
      this.drawHazards(ctx, ents.hz);
      this.drawItems(ctx, ents.it);
      this.drawCorpses(ctx, ents.cp);
      this.drawRows(ctx, ents);
      this.drawProjectiles(ctx, ents.pr);
      this.drawTracers(ctx, ents.tr);
      this.drawParticles(ctx);
      this.drawObjectiveMarkers(ctx, snap);
      ctx.restore();

      this.drawLighting(ctx, ents, snap);
      this.drawWeather(ctx, dt, snap);
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(this.w / 2 + sx, this.h / 2 + sy); ctx.scale(z, z); ctx.translate(-this.cam.x, -this.cam.y);
      this.drawFloatingText(ctx);
      ctx.restore();
      this.drawOverlayFx(ctx, snap, dt);

      this.fx.update(dt);
      this._fCnt++; this._fAcc += dt;
      if (this._fAcc > 0.5) { this.stats.fps = Math.round(this._fCnt / this._fAcc); this._fAcc = 0; this._fCnt = 0; }
      this.stats.ents = ents.en.length;
    }

    w2s(x, y) { return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 }; }
    visible(x, y, pad) { pad = pad || 90; return x > this.view.x0 - pad && x < this.view.x1 + pad && y > this.view.y0 - pad && y < this.view.y1 + pad; }

    /* ---------- ground + walls, row-interleaved with entities ---------- */
    drawGround(ctx) {
      const L = this.level, s = L.tile;
      const cx0 = Math.max(0, Math.floor(this.view.x0 / (s * CHUNK))), cx1 = Math.min(Math.ceil(L.w / CHUNK) - 1, Math.floor(this.view.x1 / (s * CHUNK)));
      const cy0 = Math.max(0, Math.floor(this.view.y0 / (s * CHUNK))), cy1 = Math.min(Math.ceil(L.h / CHUNK) - 1, Math.floor(this.view.y1 / (s * CHUNK)));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        ctx.drawImage(this.chunks.ground(cx, cy), cx * CHUNK * s, cy * CHUNK * s);
      }
      // animated water shimmer
      const t = this.time;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let gy = Math.max(0, Math.floor(this.view.y0 / s)); gy <= Math.min(L.h - 1, Math.floor(this.view.y1 / s)); gy++) {
        for (let gx = Math.max(0, Math.floor(this.view.x0 / s)); gx <= Math.min(L.w - 1, Math.floor(this.view.x1 / s)); gx++) {
          if (L.g[gy * L.w + gx] !== T.WATER) continue;
          const px = gx * s, py = gy * s;
          const ph = (t * 1.5 + hash(gx, gy) * 6) % 3;
          ctx.strokeStyle = 'rgba(150,200,220,' + (0.05 + 0.05 * Math.sin(t * 2 + gx * .6 + gy * .4)) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + 4, py + 8 + ph * 9); ctx.bezierCurveTo(px + s * .35, py + 4 + ph * 9, px + s * .6, py + 12 + ph * 9, px + s - 4, py + 7 + ph * 9);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawRows(ctx, ents) {
      const L = this.level, s = L.tile, H = this.wallH;
      // bucket entities by row
      const rows = new Map();
      const push = (y, fn) => { const r = Math.floor(y / s); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(fn); };
      for (const e of ents.en) if (this.visible(e.x, e.y, 160)) push(e.y, () => this.drawEnemy(ctx, e));
      for (const sv of ents.surv) if (this.visible(sv.x, sv.y, 160)) push(sv.y, () => this.drawSurvivor(ctx, sv));
      for (const p of L.props) if (this.visible(p.x, p.y, 260)) push(p.y, () => this.drawProp(ctx, p));
      if (this.breakByN) for (const b of this.breakByN) if (this.visible(b.x, b.y, 130)) push(b.y, () => this.drawBreakable(ctx, b));

      const gx0 = Math.floor(this.view.x0 / (s * CHUNK)), gx1 = Math.floor(this.view.x1 / (s * CHUNK));
      const gy0 = Math.max(0, Math.floor(this.view.y0 / (s * CHUNK))), gy1 = Math.min(Math.ceil(L.h / CHUNK) - 1, Math.floor(this.view.y1 / (s * CHUNK)));
      const rowMin = Math.floor(this.view.y0 / s) - 2, rowMax = Math.floor(this.view.y1 / s) + 1;

      // draw wall chunks + entity rows in ascending y order
      const wallChunks = [];
      for (let cy = gy0; cy <= gy1; cy++) for (let cx = Math.max(0, gx0); cx <= Math.min(Math.ceil(L.w / CHUNK) - 1, gx1); cx++) wallChunks.push({ cy, cx, y: cy * CHUNK * s });
      wallChunks.sort((a, b) => a.y - b.y);
      let wi = 0;
      for (let r = rowMin; r <= rowMax; r++) {
        const ry = r * s;
        while (wi < wallChunks.length && wallChunks[wi].y + CHUNK * s < ry) {
          const wc = wallChunks[wi++];
          ctx.drawImage(this.chunks.wall(wc.cx, wc.cy), wc.cx * CHUNK * s, wc.cy * CHUNK * s - H);
        }
        const list = rows.get(r);
        if (list) { list.sort(() => 0); for (const fn of list) fn(); }
      }
      while (wi < wallChunks.length) { const wc = wallChunks[wi++]; ctx.drawImage(this.chunks.wall(wc.cx, wc.cy), wc.cx * CHUNK * s, wc.cy * CHUNK * s - H); }
    }

    /* ---------- decals ---------- */
    drawDecals(ctx) {
      for (const d of this.fx.decals) {
        if (!this.visible(d.x, d.y, 60)) continue;
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
        if (d.kind === 'blood') {
          ctx.fillStyle = 'rgba(74,10,14,.62)';
          ctx.beginPath();
          for (let i = 0; i < 7; i++) {
            const ang = (i / 7) * TAU + d.seed, rr = d.r * (0.5 + hash(i, d.seed | 0) * 0.7);
            ctx[i ? 'lineTo' : 'moveTo'](Math.cos(ang) * rr, Math.sin(ang) * rr * 0.7);
          }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(120,16,20,.4)';
          for (let i = 0; i < 4; i++) { const ang = hash(i + 9, d.seed | 0) * TAU, rr = d.r * (1 + hash(i, d.seed | 0)); ctx.beginPath(); ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr * .7, d.r * .18, 0, TAU); ctx.fill(); }
        } else if (d.kind === 'scorch') {
          ctx.fillStyle = 'rgba(12,10,10,.5)'; ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * .72, 0, 0, TAU); ctx.fill();
        } else if (d.kind === 'acid') {
          ctx.fillStyle = 'rgba(120,190,60,.16)'; ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * .7, 0, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ---------- hazards ---------- */
    drawHazards(ctx, list) {
      for (const h of list) {
        if (!this.visible(h.x, h.y, h.r + 60)) continue;
        const a = clamp(h.l / 3, 0, 1);
        if (h.k === 'fire') {
          const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
          g.addColorStop(0, 'rgba(255,220,120,' + (0.5 * a) + ')');
          g.addColorStop(0.4, 'rgba(255,120,30,' + (0.32 * a) + ')');
          g.addColorStop(1, 'rgba(120,20,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.72, 0, 0, TAU); ctx.fill();
          // flames
          for (let i = 0; i < 9; i++) {
            const t = this.time * 4 + i * 1.7;
            const fx = h.x + Math.cos(i * 2.3 + this.time) * h.r * 0.55;
            const fy = h.y + Math.sin(i * 1.9 + this.time * .8) * h.r * 0.4;
            const hh = (16 + Math.sin(t) * 9) * a;
            const fg = ctx.createLinearGradient(fx, fy, fx, fy - hh);
            fg.addColorStop(0, 'rgba(255,110,20,.85)'); fg.addColorStop(0.55, 'rgba(255,190,60,.6)'); fg.addColorStop(1, 'rgba(255,240,180,0)');
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.moveTo(fx - 6, fy); ctx.quadraticCurveTo(fx + Math.sin(t) * 4, fy - hh * .6, fx, fy - hh); ctx.quadraticCurveTo(fx + 6, fy - hh * .4, fx + 6, fy); ctx.closePath(); ctx.fill();
          }
        } else if (h.k === 'acid') {
          const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
          g.addColorStop(0, 'rgba(150,255,90,' + (0.34 * a) + ')');
          g.addColorStop(0.6, 'rgba(80,180,50,' + (0.24 * a) + ')');
          g.addColorStop(1, 'rgba(40,90,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.7, 0, 0, TAU); ctx.fill();
          for (let i = 0; i < 5; i++) {
            const t = this.time * 2 + i;
            const bx = h.x + Math.cos(t * .9 + i) * h.r * .5, by = h.y + Math.sin(t * 1.1 + i) * h.r * .35;
            ctx.fillStyle = 'rgba(190,255,140,' + (0.4 * a * Math.abs(Math.sin(t))) + ')';
            ctx.beginPath(); ctx.arc(bx, by, 2 + Math.abs(Math.sin(t)) * 3, 0, TAU); ctx.fill();
          }
        } else if (h.k === 'blood') {
          ctx.fillStyle = 'rgba(96,12,18,' + (0.4 * a) + ')';
          ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * .7, 0, 0, TAU); ctx.fill();
        }
      }
    }

    /* ---------- items ---------- */
    drawItems(ctx, list) {
      for (const it of list) {
        if (!this.visible(it.x, it.y)) continue;
        const bob = Math.sin(it.b) * 3;
        const def = D.lootInfo(it.k);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(it.x, it.y + 4, 11, 5, 0, 0, TAU); ctx.fill();
        // slotted loot (weapons / armour / throwables) needs USE, so ring it
        if (it.s) {
          ctx.strokeStyle = hexA(def.color, .38 + .22 * Math.sin(this.time * 4 + it.b));
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.ellipse(it.x, it.y + 4, 14, 6.5, 0, 0, TAU); ctx.stroke();
        }
        ctx.translate(it.x, it.y - 8 + bob);
        // glow
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 26);
        g.addColorStop(0, hexA(def.color, .34)); g.addColorStop(1, hexA(def.color, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        if (it.k === 'ammo') {
          ctx.fillStyle = '#3b3a24'; ctx.fillRect(-9, -7, 18, 14);
          ctx.fillStyle = '#5c5a34'; ctx.fillRect(-9, -7, 18, 4);
          ctx.strokeStyle = '#c9b45a'; ctx.lineWidth = 1.4; ctx.strokeRect(-9, -7, 18, 14);
          ctx.fillStyle = '#e8d47a'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.fillText('AMMO', 0, 4);
        } else if (it.k === 'medkit') {
          ctx.fillStyle = '#e8ecef'; ctx.fillRect(-10, -8, 20, 16);
          ctx.fillStyle = '#c62838'; ctx.fillRect(-2.5, -6, 5, 12); ctx.fillRect(-8, -2.5, 16, 5);
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(-10, -8, 20, 16);
        } else if (it.k === 'pills') {
          ctx.fillStyle = '#d8e6f0'; ctx.fillRect(-6, -8, 12, 16);
          ctx.fillStyle = '#5fa8d3'; ctx.fillRect(-6, -8, 12, 4);
          ctx.fillStyle = '#2f6f96'; ctx.fillRect(-3, -2, 6, 6);
        } else if (it.k === 'adrenaline') {
          ctx.fillStyle = '#ffd9f2'; ctx.fillRect(-3, -9, 6, 14);
          ctx.fillStyle = '#ff4fb0'; ctx.fillRect(-3, -9, 6, 5);
          ctx.strokeStyle = '#c9d6dd'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, 10); ctx.stroke();
        } else if (it.k === 'armor') {
          ctx.fillStyle = '#33405c';
          ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(9, -8); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
          ctx.fillStyle = def.color; ctx.fillRect(-9, -8, 18, 3);
          ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 7); ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(-12, -6, 3, 7); ctx.fillRect(9, -6, 3, 7);
        } else if (it.k.indexOf('w:') === 0) {
          ctx.save(); ctx.rotate(-0.34);
          ctx.fillStyle = '#2b2f36'; ctx.fillRect(-11, -3, 22, 6);
          ctx.fillStyle = def.color; ctx.fillRect(-11, -3, 22, 2.2);
          ctx.fillStyle = '#22262c'; ctx.fillRect(-3, 2, 5, 6);
          ctx.fillRect(9, -2, 4, 3);
          ctx.restore();
        } else if (it.k.indexOf('t:') === 0) {
          if (it.k === 't:molotov') {
            ctx.fillStyle = '#3a5a2a'; ctx.beginPath(); ctx.ellipse(0, 1, 5, 7.5, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = def.color; ctx.fillRect(-1.6, -10, 3.2, 5);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255,190,80,.85)'; ctx.beginPath(); ctx.arc(0, -11, 3.2 + Math.sin(this.time * 12) * .6, 0, TAU); ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = '#3d4148'; ctx.fillRect(-4, -8, 8, 16);
            ctx.fillStyle = def.color; ctx.fillRect(-4, -8, 8, 3);
            ctx.strokeStyle = '#c9b45a'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(5, -13, 2, -16); ctx.stroke();
            const sp = .5 + .5 * Math.sin(this.time * 18);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255,' + Math.round(150 + 80 * sp) + ',60,.9)';
            ctx.beginPath(); ctx.arc(2, -16, 2.2 + sp, 0, TAU); ctx.fill(); ctx.restore();
          }
        } else {
          ctx.fillStyle = def.color; ctx.fillRect(-7, -7, 14, 14);
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(-7, -7, 14, 14);
        }
        ctx.restore();
      }
    }

    drawCorpses(ctx, list) {
      for (const c of list) {
        if (!this.visible(c.x, c.y)) continue;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a + Math.PI / 2);
        ctx.globalAlpha = 0.85;
        if (c.t === 'survivor') {
          ctx.fillStyle = 'rgba(80,8,12,.5)'; ctx.beginPath(); ctx.ellipse(0, 0, 24, 15, 0, 0, TAU); ctx.fill();
          const hd = D.SURVIVORS[c.h] || D.SURVIVORS.berto;
          ctx.fillStyle = shade(hd.color, -0.45); roundRect(ctx, -7, -16, 14, 30, 6); ctx.fill();
          ctx.fillStyle = shade(hd.skin, -0.4); ctx.beginPath(); ctx.arc(0, -19, 7, 0, TAU); ctx.fill();
        } else {
          const def = D.ENEMIES[c.t]; if (!def) { ctx.restore(); continue; }
          ctx.fillStyle = 'rgba(70,8,12,.45)'; ctx.beginPath(); ctx.ellipse(0, 2, def.radius * 1.8, def.radius, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = shade(def.color, -0.5);
          roundRect(ctx, -def.radius * .8, -def.radius * .5, def.radius * 1.6, def.radius * 1.9, def.radius * .6); ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ---------- SURVIVORS ---------- */
    drawSurvivor(ctx, s) {
      const hero = D.SURVIVORS[s.hero] || D.SURVIVORS.berto;
      const x = s.x, y = s.y;
      const down = !!s.dn, dead = !!s.dd;
      const walk = s.wk || 0, mv = s.mv || 0;
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, 15, 7, 0, 0, TAU); ctx.fill();
      if (dead) { ctx.restore(); return; }
      ctx.translate(x, y);
      if (down) {
        // lying pose + blood pool
        ctx.fillStyle = 'rgba(96,10,16,.5)'; ctx.beginPath(); ctx.ellipse(0, 2, 22, 12, 0, 0, TAU); ctx.fill();
        ctx.rotate(Math.PI / 2 + Math.sin(this.time * 2) * 0.03);
        ctx.scale(0.92, 0.92);
      }
      const faceLeft = Math.cos(s.a) < 0;
      const bob = Math.sin(walk * 2) * (mv > .2 ? 1.6 : 0.5);
      const legSwing = Math.sin(walk) * (mv > .2 ? 6.5 : 0.6);
      const H = 40;
      // legs
      ctx.fillStyle = '#25282e';
      roundRect(ctx, -7 + legSwing * .4, -6, 6, 12 - bob * .3, 3); ctx.fill();
      roundRect(ctx, 1 - legSwing * .4, -6, 6, 12 + bob * .3, 3); ctx.fill();
      ctx.fillStyle = '#15171b';
      ctx.fillRect(-8 + legSwing * .4, 4, 8, 4); ctx.fillRect(0 - legSwing * .4, 4, 8, 4);
      // torso
      ctx.save();
      ctx.translate(0, -18 + bob);
      ctx.fillStyle = shade(hero.color, -0.12);
      roundRect(ctx, -10, -8, 20, 22, 6); ctx.fill();
      // vest / detail
      ctx.fillStyle = shade(hero.color, 0.16);
      roundRect(ctx, -8, -6, 16, 9, 3); ctx.fill();
      ctx.fillStyle = hero.accent;
      ctx.fillRect(-8, 4, 16, 2.2);
      // shoulders
      ctx.fillStyle = shade(hero.color, -0.28);
      ctx.beginPath(); ctx.arc(-9, -4, 4.6, 0, TAU); ctx.arc(9, -4, 4.6, 0, TAU); ctx.fill();
      // backpack
      ctx.fillStyle = '#2c2f36'; roundRect(ctx, -7, -2, 14, 11, 3); ctx.fill();
      ctx.restore();
      // head
      ctx.save();
      ctx.translate(0, -30 + bob);
      ctx.fillStyle = hero.skin;
      ctx.beginPath(); ctx.arc(0, 0, 7.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.arc(faceLeft ? 1.6 : -1.6, 1.6, 7.2, 0, TAU); ctx.fill();
      ctx.fillStyle = hero.skin; ctx.beginPath(); ctx.arc(faceLeft ? -1.4 : 1.4, -0.6, 6.6, 0, TAU); ctx.fill();
      // hair / headgear per hero
      if (s.hero === 'berto') { ctx.fillStyle = '#1d2a3d'; ctx.beginPath(); ctx.arc(0, -1.4, 7.6, Math.PI, TAU); ctx.fill(); ctx.fillStyle = '#2f6fb5'; ctx.fillRect(-8, -2.4, 16, 3); }
      else if (s.hero === 'rhea') { ctx.fillStyle = '#241a16'; ctx.beginPath(); ctx.arc(0, -1, 7.8, Math.PI * 0.95, TAU * 1.02); ctx.fill(); ctx.fillStyle = '#241a16'; roundRect(ctx, faceLeft ? 3 : -7, 0, 4, 11, 2); ctx.fill(); }
      else if (s.hero === 'junjun') { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, -1.6, 7.7, Math.PI, TAU); ctx.fill(); ctx.fillStyle = '#a5322a'; roundRect(ctx, faceLeft ? -12 : 2, -3.2, 10, 3.4, 1.6); ctx.fill(); }
      else { ctx.fillStyle = '#3d3226'; ctx.beginPath(); ctx.arc(0, -1.2, 7.7, Math.PI, TAU); ctx.fill(); ctx.fillStyle = '#8a2b2b'; ctx.fillRect(-7.6, -2.6, 15.2, 3.2); }
      // eyes
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      const eo = faceLeft ? -2.4 : 2.4;
      ctx.fillRect(eo - 1.6, -0.4, 1.6, 1.6); ctx.fillRect(eo + 0.6, -0.4, 1.6, 1.6);
      ctx.restore();
      // arms + weapon (aim-driven)
      ctx.save();
      ctx.translate(0, -20 + bob);
      ctx.rotate(s.a + (faceLeft ? Math.PI : 0));
      if (faceLeft) ctx.scale(1, -1);
      const w = D.WEAPONS[hero.weapon];
      ctx.fillStyle = shade(hero.skin, -0.08);
      roundRect(ctx, 3, -3.2, 13, 5, 2.4); ctx.fill();
      ctx.fillStyle = '#1b1d22';
      if (hero.weapon === 'shotgun') { ctx.fillRect(8, -2.6, 26, 4.6); ctx.fillStyle = '#5b3a20'; ctx.fillRect(2, -2.4, 9, 5.2); ctx.fillStyle = '#2b2e35'; ctx.fillRect(30, -2, 5, 3.4); }
      else if (hero.weapon === 'burst') { ctx.fillRect(8, -2.2, 24, 4); ctx.fillStyle = '#3a3d45'; ctx.fillRect(12, -4.4, 8, 2.6); ctx.fillStyle = '#2b2e35'; ctx.fillRect(2, -1.6, 8, 4.6); }
      else if (hero.weapon === 'smg') { ctx.fillRect(7, -2, 15, 3.6); ctx.fillRect(7, 2.4, 15, 3.6); ctx.fillStyle = '#3a3d45'; ctx.fillRect(10, 0.6, 5, 3); }
      else { ctx.fillRect(8, -2.4, 28, 4.4); ctx.fillStyle = '#4a3520'; ctx.fillRect(2, -2, 8, 4.6); ctx.fillStyle = '#3a3d45'; ctx.fillRect(16, -5, 9, 2.8); }
      // melee on back
      ctx.restore();
      // muzzle flash
      if (s.mz) {
        ctx.save();
        ctx.translate(Math.cos(s.a) * 34, -20 + Math.sin(s.a) * 10);
        ctx.rotate(s.a);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 26);
        g.addColorStop(0, 'rgba(255,246,200,.95)'); g.addColorStop(.35, 'rgba(255,170,60,.6)'); g.addColorStop(1, 'rgba(255,120,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,190,.9)';
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(20, 0); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // hurt flash
      if (s.ht) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,60,60,.30)'; ctx.beginPath(); ctx.ellipse(0, -18, 15, 26, 0, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
      // i-frames
      if (s.pn <= 0 && s.abA > 0 && s.hero === 'junjun') {
        ctx.strokeStyle = 'rgba(90,209,255,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -14, 18, 26, 0, 0, TAU); ctx.stroke();
      }
      if (down) {
        ctx.rotate(-(Math.PI / 2));
        // bleedout ring
        const p = clamp(s.bl / 32, 0, 1);
        ctx.strokeStyle = 'rgba(255,40,60,.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, -46, 15, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p)); ctx.stroke();
        ctx.fillStyle = '#ff5566'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('DOWN', 0, -42);
      }
      if (s.pn > 0) {
        ctx.fillStyle = 'rgba(255,60,60,.95)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText('PINNED — MASH E', 0, -50);
      }
      if (s.rv > 0) {
        ctx.strokeStyle = 'rgba(120,255,170,.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, -52, 13, -Math.PI / 2, -Math.PI / 2 + TAU * s.rv); ctx.stroke();
      }
      ctx.restore();
      // nameplate
      if (!down) {
        ctx.save();
        ctx.font = '600 10px ui-monospace,monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = s.bot ? 'rgba(160,200,255,.62)' : 'rgba(255,255,255,.82)';
        ctx.fillText(s.name.slice(0, 14).toUpperCase(), x, y - 46);
        // hp pip
        const hpf = clamp(s.hp / s.mhp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 15, y - 42, 30, 3);
        ctx.fillStyle = hpf > .55 ? '#4ade80' : hpf > .25 ? '#ffb02e' : '#e0263f';
        ctx.fillRect(x - 15, y - 42, 30 * hpf, 3);
        ctx.restore();
      }
      // medic aura
      if (s.adb) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(s.adb.x, s.adb.y, 10, s.adb.x, s.adb.y, s.adb.r);
        g.addColorStop(0, 'rgba(120,255,190,.16)'); g.addColorStop(.7, 'rgba(80,220,160,.08)'); g.addColorStop(1, 'rgba(60,200,140,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.adb.x, s.adb.y, s.adb.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(140,255,200,' + (0.35 + 0.2 * Math.sin(this.time * 5)) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.adb.x, s.adb.y, s.adb.r * (0.7 + 0.3 * Math.abs(Math.sin(this.time * 2))), 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    /* ---------- ENEMIES ---------- */
    drawEnemy(ctx, e) {
      const def = D.ENEMIES[e.t]; if (!def) return;
      const x = e.x, y = e.y, z = e.z || 0;
      const big = e.b ? 1.35 : 1;
      const walk = e.w || 0;
      const flash = e.f;
      ctx.save();
      // shadow
      const shScale = clamp(1 - z / 220, 0.35, 1);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.42 * shScale) + ')';
      ctx.beginPath(); ctx.ellipse(x, y + 3, def.radius * 1.05 * shScale, def.radius * 0.5 * shScale, 0, 0, TAU); ctx.fill();
      ctx.translate(x, y - z);
      const faceLeft = Math.cos(e.a) < 0;
      const bodyC = flash ? '#ffffff' : def.color;
      const darkC = flash ? '#ffdddd' : shade(def.color, -0.42);
      const lightC = flash ? '#ffffff' : shade(def.color, 0.18);
      const scale = (def.height / 44) * big;
      ctx.scale(faceLeft ? -scale : scale, scale);

      if (e.t === 'manananggal' && !e.ib) this.drawManananggalTorso(ctx, e, bodyC, darkC, lightC, def);
      else if (e.t === 'manananggal' && e.ib) this.drawManananggalBody(ctx, e, bodyC, darkC, lightC, def);
      else if (e.t === 'batibat') this.drawBatibat(ctx, e, walk, bodyC, darkC, lightC, def);
      else if (e.t === 'tiyanak') this.drawTiyanak(ctx, e, walk, bodyC, darkC, lightC, def);
      else if (e.t === 'mangkukulam') this.drawKulam(ctx, e, walk, bodyC, darkC, lightC, def);
      else if (e.t === 'pugot') this.drawPugot(ctx, e, walk, bodyC, darkC, lightC, def);
      else if (e.t === 'spitter') this.drawSpitter(ctx, e, walk, bodyC, darkC, lightC, def);
      else this.drawInfected(ctx, e, walk, bodyC, darkC, lightC, def);

      ctx.restore();

      // eyes glow (additive, unscaled)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const eg = ctx.createRadialGradient(x, y - z - def.height * 0.72, 1, x, y - z - def.height * 0.72, def.radius * 1.5);
      eg.addColorStop(0, hexA(def.eye, 0.5)); eg.addColorStop(1, hexA(def.eye, 0));
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(x, y - z - def.height * 0.72, def.radius * 1.5, 0, TAU); ctx.fill();
      ctx.restore();

      // health bar
      if (!e.b && e.hp < e.mhp) {
        const w = def.radius * 2.2, f = clamp(e.hp / e.mhp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - w / 2, y - z - def.height * scale - 12, w, 3);
        ctx.fillStyle = e.special ? '#ffb02e' : '#e0263f'; ctx.fillRect(x - w / 2, y - z - def.height * scale - 12, w * f, 3);
      }
      if (e.s === 'wind' || e.s === 'cast' || e.s === 'leap') {
        ctx.strokeStyle = 'rgba(255,60,60,' + (0.4 + 0.4 * Math.sin(this.time * 22)) + ')';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, def.radius + 10, 0, TAU); ctx.stroke();
      }
      if (e.s === 'charge') {
        ctx.strokeStyle = 'rgba(255,120,40,.5)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(e.a) * 60, y - Math.sin(e.a) * 60); ctx.lineTo(x, y); ctx.stroke();
      }
    }

    /* generic infected humanoid */
    drawInfected(ctx, e, walk, bodyC, darkC, lightC, def) {
      const sw = Math.sin(walk) * 5;
      const lean = e.t === 'runner' ? 0.22 : 0.08;
      ctx.save(); ctx.rotate(lean * (Math.cos(e.a) < 0 ? -1 : 1));
      // legs
      ctx.fillStyle = darkC;
      roundRect(ctx, -6 + sw * .5, -8, 5, 13, 2); ctx.fill();
      roundRect(ctx, 1 - sw * .5, -8, 5, 13, 2); ctx.fill();
      // torso (hunched)
      ctx.fillStyle = bodyC;
      roundRect(ctx, -8, -26, 16, 20, 5); ctx.fill();
      // torn clothing
      ctx.fillStyle = 'rgba(20,22,26,.55)';
      roundRect(ctx, -8, -20, 16, 8, 3); ctx.fill();
      ctx.fillStyle = 'rgba(90,10,14,.5)';
      ctx.beginPath(); ctx.arc(3, -16, 3, 0, TAU); ctx.fill();
      // ribs / miasma veins
      ctx.strokeStyle = hexA(def.eye, .35); ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(-5, -22); ctx.lineTo(4, -18); ctx.moveTo(-5, -18); ctx.lineTo(4, -14); ctx.stroke();
      // arms reaching forward
      ctx.fillStyle = lightC;
      const reach = e.s === 'attack' ? 12 : 4;
      roundRect(ctx, 2, -25, 12 + reach, 4.4, 2); ctx.fill();
      roundRect(ctx, -2, -21, 10 + reach * .7, 4, 2); ctx.fill();
      // claws
      ctx.strokeStyle = '#d8d2c0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(14 + reach, -25); ctx.lineTo(18 + reach, -28); ctx.moveTo(14 + reach, -23); ctx.lineTo(18 + reach, -22); ctx.stroke();
      // head
      ctx.fillStyle = shade(bodyC, 0.1);
      ctx.beginPath(); ctx.arc(1, -31, 6.4, 0, TAU); ctx.fill();
      // jaw
      ctx.fillStyle = 'rgba(30,10,12,.8)';
      ctx.beginPath(); ctx.ellipse(4, -28, 3.4, 2.2 + (e.s === 'attack' ? 2 : 0), 0, 0, TAU); ctx.fill();
      // eyes
      ctx.fillStyle = def.eye;
      ctx.beginPath(); ctx.arc(3, -32.5, 1.5, 0, TAU); ctx.arc(-0.6, -32.5, 1.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
    drawSpitter(ctx, e, walk, bodyC, darkC, lightC, def) {
      const sw = Math.sin(walk) * 3;
      ctx.fillStyle = darkC;
      roundRect(ctx, -7 + sw, -6, 6, 10, 2); ctx.fill(); roundRect(ctx, 1 - sw, -6, 6, 10, 2); ctx.fill();
      // bloated sac body
      const pulse = 1 + Math.sin(this.time * 3 + e.x) * 0.05;
      ctx.fillStyle = bodyC;
      ctx.beginPath(); ctx.ellipse(0, -20, 15 * pulse, 17 * pulse, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = hexA(def.eye, .35);
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(Math.cos(i * 1.6) * 8, -22 + Math.sin(i * 2.1) * 9, 2.6 + Math.sin(this.time * 4 + i) * .8, 0, TAU); ctx.fill(); }
      // small head
      ctx.fillStyle = shade(bodyC, .12); ctx.beginPath(); ctx.arc(2, -37, 5.4, 0, TAU); ctx.fill();
      ctx.fillStyle = def.eye; ctx.beginPath(); ctx.arc(4, -38, 1.4, 0, TAU); ctx.arc(0.4, -38, 1.2, 0, TAU); ctx.fill();
      // mouth drip
      if (e.s === 'cast') { ctx.fillStyle = '#c9ff70'; ctx.beginPath(); ctx.ellipse(6, -33, 3.4, 4.4, 0, 0, TAU); ctx.fill(); }
      // stubby arms
      ctx.fillStyle = lightC; roundRect(ctx, 8, -26, 9, 4, 2); ctx.fill(); roundRect(ctx, -16, -24, 9, 4, 2); ctx.fill();
    }
    drawTiyanak(ctx, e, walk, bodyC, darkC, lightC, def) {
      const sw = Math.sin(walk * 1.6) * 4;
      const leap = e.s === 'leap';
      ctx.save(); if (leap) ctx.rotate(-0.5);
      ctx.fillStyle = darkC;
      roundRect(ctx, -5 + sw, -6, 4, 10, 2); ctx.fill(); roundRect(ctx, 1 - sw, -6, 4, 10, 2); ctx.fill();
      // small body
      ctx.fillStyle = bodyC; roundRect(ctx, -7, -20, 14, 16, 5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)'; roundRect(ctx, -6, -18, 12, 6, 3); ctx.fill();
      // oversized head
      ctx.fillStyle = shade(bodyC, .14);
      ctx.beginPath(); ctx.arc(0, -27, 10, 0, TAU); ctx.fill();
      // long arms
      ctx.strokeStyle = lightC; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(5, -18); ctx.quadraticCurveTo(14, -12 + (leap ? -8 : 0), 16, -2 + (leap ? -6 : 0));
      ctx.moveTo(-5, -18); ctx.quadraticCurveTo(-14, -12, -16, -2);
      ctx.stroke();
      // claws
      ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(16, -2); ctx.lineTo(19, 2); ctx.moveTo(16, -2); ctx.lineTo(19, -3); ctx.stroke();
      // face: gaping mouth + red eyes
      ctx.fillStyle = '#2a0409';
      ctx.beginPath(); ctx.ellipse(2, -24, 4.6, 3.4 + (e.s === 'attack' || leap ? 2.4 : 0), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) ctx.fillRect(-1 + i * 2, -26, 1, 1.6);
      ctx.fillStyle = def.eye;
      ctx.beginPath(); ctx.arc(-3, -30, 2, 0, TAU); ctx.arc(4, -30, 2, 0, TAU); ctx.fill();
      ctx.restore();
    }
    drawBatibat(ctx, e, walk, bodyC, darkC, lightC, def) {
      const sw = Math.sin(walk * .8) * 5;
      const br = 1 + Math.sin(this.time * 2) * 0.03;
      ctx.fillStyle = darkC;
      roundRect(ctx, -14 + sw, -14, 12, 20, 4); ctx.fill(); roundRect(ctx, 2 - sw, -14, 12, 20, 4); ctx.fill();
      // massive torso
      ctx.fillStyle = bodyC;
      ctx.beginPath(); ctx.ellipse(0, -34 * br, 22 * br, 26 * br, 0, 0, TAU); ctx.fill();
      // shadowy tendrils
      ctx.strokeStyle = 'rgba(20,8,30,.75)'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = this.time * 1.4 + i * 1.05;
        ctx.beginPath(); ctx.moveTo(Math.cos(i) * 14, -40 + Math.sin(i) * 10);
        ctx.quadraticCurveTo(Math.cos(a) * 26, -50 + Math.sin(a) * 16, Math.cos(a + 1) * 30, -34 + Math.sin(a) * 20);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.beginPath(); ctx.ellipse(-6, -44, 12, 14, 0, 0, TAU); ctx.fill();
      // heavy arms
      ctx.fillStyle = lightC;
      roundRect(ctx, 14, -46 + sw, 12, 30, 6); ctx.fill();
      roundRect(ctx, -26, -46 - sw, 12, 30, 6); ctx.fill();
      // head sunk in shoulders
      ctx.fillStyle = shade(bodyC, .1);
      ctx.beginPath(); ctx.arc(0, -58, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a0a20'; ctx.beginPath(); ctx.ellipse(3, -55, 5, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = def.eye;
      ctx.beginPath(); ctx.arc(-4, -60, 2.2, 0, TAU); ctx.arc(4, -60, 2.2, 0, TAU); ctx.fill();
    }
    drawKulam(ctx, e, walk, bodyC, darkC, lightC, def) {
      const float = Math.sin(this.time * 2.2 + e.x * 0.01) * 3;
      ctx.translate(0, float);
      // robe
      ctx.fillStyle = bodyC;
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.quadraticCurveTo(-11, -30, 0, -34); ctx.quadraticCurveTo(11, -30, 14, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.quadraticCurveTo(-6, -18, 0, -30); ctx.quadraticCurveTo(6, -18, 14, 4); ctx.closePath(); ctx.fill();
      // tattered hem
      ctx.fillStyle = darkC;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 4, 4); ctx.lineTo(i * 4 + 2, 10 + Math.abs(i)); ctx.lineTo(i * 4 + 4, 4); ctx.fill(); }
      // hood + face
      ctx.fillStyle = shade(bodyC, .12);
      ctx.beginPath(); ctx.arc(0, -38, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0b0f0c'; ctx.beginPath(); ctx.arc(1, -37, 6.4, 0, TAU); ctx.fill();
      ctx.fillStyle = def.eye;
      ctx.beginPath(); ctx.arc(-1.6, -38, 1.6, 0, TAU); ctx.arc(3.4, -38, 1.6, 0, TAU); ctx.fill();
      // staff + orb
      ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(12, 6); ctx.lineTo(16, -44); ctx.stroke();
      const cast = e.s === 'cast';
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(16, -48, 1, 16, -48, cast ? 20 : 12);
      g.addColorStop(0, 'rgba(190,255,120,.95)'); g.addColorStop(.4, 'rgba(120,220,70,.5)'); g.addColorStop(1, 'rgba(80,180,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(16, -48, cast ? 20 : 12, 0, TAU); ctx.fill();
      ctx.restore();
      // arms
      ctx.fillStyle = lightC; roundRect(ctx, 4, -30, 12, 4, 2); ctx.fill();
    }
    drawPugot(ctx, e, walk, bodyC, darkC, lightC, def) {
      const sw = Math.sin(walk) * 7;
      const charging = e.s === 'charge';
      ctx.save(); if (charging) ctx.rotate(0.26);
      ctx.fillStyle = darkC;
      roundRect(ctx, -10 + sw, -12, 9, 18, 3); ctx.fill(); roundRect(ctx, 1 - sw, -12, 9, 18, 3); ctx.fill();
      // thick torso, no head
      ctx.fillStyle = bodyC;
      roundRect(ctx, -14, -44, 28, 34, 8); ctx.fill();
      // neck stump (bleeding)
      ctx.fillStyle = '#5c1010';
      ctx.beginPath(); ctx.ellipse(0, -45, 8, 4.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8e1b1b';
      ctx.beginPath(); ctx.ellipse(0, -46, 5, 3, 0, 0, TAU); ctx.fill();
      // blood drip
      const drip = (this.time * 30 + e.x) % 26;
      ctx.fillStyle = 'rgba(140,20,20,.85)';
      ctx.beginPath(); ctx.ellipse(2, -44 + drip, 2, 3.4, 0, 0, TAU); ctx.fill();
      // chest scars
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-8, -36); ctx.lineTo(6, -30); ctx.moveTo(-6, -26); ctx.lineTo(8, -20); ctx.stroke();
      // arms — one carries its own head
      ctx.fillStyle = lightC;
      roundRect(ctx, 12, -42, 10, 26, 4); ctx.fill();
      roundRect(ctx, -22, -40 + (charging ? -6 : 0), 10, 24, 4); ctx.fill();
      // the severed head in hand
      ctx.save();
      ctx.translate(-20, -14 + Math.sin(this.time * 3) * 2);
      ctx.fillStyle = shade(bodyC, .18); ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a0409'; ctx.beginPath(); ctx.ellipse(2, 2, 4, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = def.eye; ctx.beginPath(); ctx.arc(-2, -2, 1.8, 0, TAU); ctx.arc(3, -2, 1.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8e1b1b'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-3, 7); ctx.lineTo(3, 7); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
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

    drawProjectiles(ctx, list) {
      for (const p of list) {
        if (!this.visible(p.x, p.y, 60)) continue;
        ctx.save();
        ctx.translate(p.x, p.y - (p.z || 0));
        if (p.k === 'molotov') {
          ctx.fillStyle = '#3a5a2a'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 7, this.time * 8, 0, TAU); ctx.fill();
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, -4, 1, 0, -4, 16);
          g.addColorStop(0, 'rgba(255,200,90,.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -4, 16, 0, TAU); ctx.fill(); ctx.restore();
        } else if (p.k === 'bomb') {
          ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, (p.z || 0) + 4, 6, 3, 0, 0, TAU); ctx.fill();
          ctx.save(); ctx.rotate(this.time * 11);
          ctx.fillStyle = '#3d4148'; ctx.fillRect(-4, -7, 8, 14);
          ctx.fillStyle = '#c0392b'; ctx.fillRect(-4, -1.5, 8, 3);
          ctx.restore();
          const sp = .5 + .5 * Math.sin(this.time * 22);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,' + Math.round(140 + 90 * sp) + ',60,.92)';
          ctx.beginPath(); ctx.arc(0, -9, 2.4 + sp * 1.7, 0, TAU); ctx.fill(); ctx.restore();
        } else if (p.k === 'bile' || p.k === 'viscera') {
          const c = p.k === 'bile' ? 'rgba(150,230,80,.95)' : 'rgba(200,40,70,.95)';
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.ellipse(0, 0, 7, 9, this.time * 6, 0, TAU); ctx.fill();
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = p.k === 'bile' ? 'rgba(160,255,90,.35)' : 'rgba(255,80,110,.35)';
          ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill(); ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, (p.z || 0) + 4, 6, 3, 0, 0, TAU); ctx.fill();
        } else if (p.k === 'curse') {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 22);
          g.addColorStop(0, 'rgba(190,255,120,.9)'); g.addColorStop(1, 'rgba(90,200,50,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
          ctx.restore();
          // ground telegraph
          ctx.strokeStyle = 'rgba(150,255,90,' + (0.4 + 0.3 * Math.sin(this.time * 18)) + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, (p.z || 0), 88, 62, 0, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
    }
    drawTracers(ctx, list) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const t of list) {
        const a = clamp(t.l, 0, 1);
        ctx.strokeStyle = 'rgba(255,236,170,' + (0.85 * a) + ')';
        ctx.lineWidth = t.w || 2;
        ctx.beginPath(); ctx.moveTo(t.x, t.y - 18); ctx.lineTo(t.x2, t.y2 - 8); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,150,60,' + (0.4 * a) + ')';
        ctx.lineWidth = (t.w || 2) * 2.4;
        ctx.beginPath(); ctx.moveTo(t.x, t.y - 18); ctx.lineTo(t.x2, t.y2 - 8); ctx.stroke();
      }
      ctx.restore();
    }
    drawParticles(ctx) {
      ctx.save();
      for (const p of this.fx.p) {
        const a = clamp(p.life / p.max, 0, 1);
        if (p.kind === 'smoke') {
          ctx.globalAlpha = a * 0.32;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.r * (2.2 - a), 0, TAU); ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.c; ctx.lineWidth = p.r * 0.7;
          ctx.beginPath(); ctx.moveTo(p.x, p.y - p.z); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.z - p.vy * 0.02); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.globalAlpha = a;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.r * (0.4 + a * 0.8), 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      // rings
      for (const r of this.fx.rings) {
        const t = 1 - r.life / r.max;
        ctx.strokeStyle = hexA(r.c, (1 - t) * 0.8);
        ctx.lineWidth = r.w * (1 - t * .6);
        ctx.beginPath(); ctx.ellipse(r.x, r.y, lerp(r.r0, r.r1, t), lerp(r.r0, r.r1, t) * 0.7, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    drawFloatingText(ctx) {
      ctx.save(); ctx.textAlign = 'center';
      for (const t of this.fx.txt) {
        const a = clamp(t.life / t.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.font = (t.big ? '900 17px ' : '700 12px ') + 'ui-monospace,monospace';
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText(t.s, t.x + 1, t.y + 1);
        ctx.fillStyle = t.c; ctx.fillText(t.s, t.x, t.y);
      }
      ctx.restore();
    }

    /* ---------- objective world markers ---------- */
    drawObjectiveMarkers(ctx, snap) {
      const o = snap.obj; if (!o || !o.x) return;
      if (o.type === 'hold' || o.type === 'extract') {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
        ctx.save();
        ctx.strokeStyle = o.type === 'extract' ? 'rgba(120,255,180,' + (0.35 + pulse * 0.35) + ')' : 'rgba(255,190,80,' + (0.3 + pulse * 0.3) + ')';
        ctx.lineWidth = 3; ctx.setLineDash([16, 12]); ctx.lineDashOffset = -this.time * 30;
        ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.62, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(o.x, o.y, 10, o.x, o.y, o.r);
        g.addColorStop(0, o.type === 'extract' ? 'rgba(80,255,160,.10)' : 'rgba(255,180,60,.10)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * .62, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // generators
      for (const g of (snap.gn || [])) {
        if (g.d) continue;
        ctx.save(); ctx.translate(g.x, g.y);
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, 4, 22, 10, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3c4149'; roundRect(ctx, -16, -26, 32, 30, 3); ctx.fill();
        ctx.fillStyle = '#22262c'; roundRect(ctx, -12, -20, 24, 14, 2); ctx.fill();
        ctx.fillStyle = g.p > 0 ? '#ffb02e' : '#5c1f22';
        ctx.beginPath(); ctx.arc(0, -13, 4 + Math.sin(this.time * 6) * (g.p > 0 ? 1.4 : 0), 0, TAU); ctx.fill();
        ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-10, -26); ctx.lineTo(-10, -34); ctx.lineTo(10, -34); ctx.lineTo(10, -26); ctx.stroke();
        // progress
        if (g.p > 0) {
          ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, -40, 12, -Math.PI / 2, -Math.PI / 2 + TAU * g.p); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '700 9px ui-monospace,monospace'; ctx.textAlign = 'center';
        ctx.fillText('GENERATOR', 0, 18);
        ctx.restore();
      }
    }

    /* ---------- LIGHTING ---------- */
    drawLighting(ctx, ents, snap) {
      const stage = snap && snap._stage;
      const ambient = this.ambient === undefined ? 0.2 : this.ambient;
      const lc = this.light, lx = this.lightCtx;
      const scale = this.q.lightScale;
      const lw = Math.max(1, Math.ceil(this.w * scale)), lh = Math.max(1, Math.ceil(this.h * scale));
      if (lc.width !== lw || lc.height !== lh) { lc.width = lw; lc.height = lh; }
      lx.setTransform(1, 0, 0, 1, 0, 0);
      lx.globalCompositeOperation = 'source-over';
      // darkness colour depends on biome
      const dark = this.biome === 'station' ? 'rgba(3,4,9,' : this.biome === 'skyway' ? 'rgba(6,7,14,' : 'rgba(4,5,11,';
      lx.fillStyle = dark + (1 - ambient) + ')';
      lx.fillRect(0, 0, lc.width, lc.height);
      lx.globalCompositeOperation = 'destination-out';
      const z = this.cam.zoom * (this.w < 700 ? 0.82 : 1);
      const toL = (wx, wy) => ({ x: (wx - this.cam.x) * z * scale + lc.width / 2, y: (wy - this.cam.y) * z * scale + lc.height / 2 });
      const punch = (wx, wy, r, strength) => {
        const p = toL(wx, wy); const rr = r * z * scale;
        if (p.x < -rr || p.y < -rr || p.x > lc.width + rr || p.y > lc.height + rr) return;
        const g = lx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
        g.addColorStop(0.45, 'rgba(0,0,0,' + (strength * 0.72) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        lx.fillStyle = g; lx.beginPath(); lx.arc(p.x, p.y, rr, 0, TAU); lx.fill();
      };
      // static level lights
      for (const l of (this.level.lights || [])) {
        if (!this.visible(l.x, l.y, l.r + 120)) continue;
        const fl = l.flicker ? (0.72 + 0.28 * Math.abs(Math.sin(this.time * (l.emergency ? 3.4 : 7.1) + l.x * 0.05)) * (hash(Math.floor(this.time * 9), l.x | 0) > 0.14 ? 1 : 0.35)) : 1;
        punch(l.x, l.y, l.r * fl, (l.f || 0.8) * fl);
      }
      // survivors carry light
      for (const s of ents.surv) {
        if (s.dd) continue;
        punch(s.x, s.y, s.dn ? 105 : 190, s.dn ? 0.55 : 0.92);
        if (s.mz) punch(s.x + Math.cos(s.a) * 26, s.y + Math.sin(s.a) * 26, 240, 1);
        if (s.adb) punch(s.adb.x, s.adb.y, s.adb.r * 1.3, 0.9);
      }
      // hazards + projectiles glow
      for (const h of ents.hz) { if (h.k === 'fire') punch(h.x, h.y, h.r * 2.1, 0.95); else if (h.k === 'acid') punch(h.x, h.y, h.r * 1.2, 0.4); }
      for (const p of ents.pr) { if (p.k === 'molotov') punch(p.x, p.y, 130, 0.9); else if (p.k === 'curse' || p.k === 'bile') punch(p.x, p.y, 90, 0.5); }
      // lightning
      if (this.lightning && this.lightning.on > 0) {
        lx.globalCompositeOperation = 'destination-out';
        lx.fillStyle = 'rgba(0,0,0,' + (this.lightning.on * 0.9) + ')';
        lx.fillRect(0, 0, lc.width, lc.height);
      }
      // composite
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(lc, 0, 0, this.w, this.h);
      ctx.restore();
      // additive colour glow pass (skipped on the low tier)
      if (!this.q.glow) return;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(this.w / 2, this.h / 2); ctx.scale(z, z); ctx.translate(-this.cam.x, -this.cam.y);
      for (const l of (this.level.lights || [])) {
        if (!this.visible(l.x, l.y, l.r + 120)) continue;
        const fl = l.flicker ? (0.7 + 0.3 * Math.abs(Math.sin(this.time * 7 + l.x * .05))) : 1;
        const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r * 0.9);
        g.addColorStop(0, hexA(l.c, 0.20 * fl * (l.f || 1)));
        g.addColorStop(1, hexA(l.c, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, l.y, l.r * .9, 0, TAU); ctx.fill();
      }
      for (const h of ents.hz) if (h.k === 'fire') {
        const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r * 1.5);
        g.addColorStop(0, 'rgba(255,150,50,.22)'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 1.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    /* ---------- weather & screen effects ---------- */
    drawWeather(ctx, dt, snap) {
      const amb = this.ambientKind || 'rain_heavy';
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // fog
      if (amb !== 'dark_indoor') {
        ctx.globalCompositeOperation = 'lighter';
        for (const f of this.fog) {
          f.x += f.vx * dt; if (f.x - f.r > this.w) { f.x = -f.r; f.y = Math.random() * this.h; }
          const g = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, f.r);
          g.addColorStop(0, 'rgba(120,140,160,' + f.o + ')'); g.addColorStop(1, 'rgba(120,140,160,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // indoor dust motes
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 26; i++) {
          const x = (i * 137.5 + this.time * 12) % this.w, y = (i * 89.3 + Math.sin(this.time * .6 + i) * 40) % this.h;
          ctx.fillStyle = 'rgba(180,200,220,.06)'; ctx.fillRect(x, y, 2, 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      // rain
      if (amb !== 'dark_indoor') {
        ctx.strokeStyle = 'rgba(190,215,235,.30)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        const heavy = amb === 'rain_storm' ? 1.4 : 1;
        for (const d of this.rain) {
          d.y += d.s * dt * heavy; d.x -= d.s * dt * 0.24 * heavy;
          if (d.y > this.h) { d.y = -20; d.x = Math.random() * (this.w + 200); }
          if (d.x < -20) d.x = this.w + 20;
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.24, d.y + d.l);
        }
        ctx.stroke();
      }
      // lightning
      if (this.lightning) {
        this.lightning.t -= dt;
        if (this.lightning.t <= 0) {
          this.lightning.t = 5 + Math.random() * 11;
          this.lightning.on = 1;
          if (AU.ready && amb !== 'dark_indoor') setTimeout(() => AU.SFX.thunder(), 220 + Math.random() * 700);
        }
        if (this.lightning.on > 0) {
          this.lightning.on -= dt * 3.4;
          ctx.fillStyle = 'rgba(200,220,255,' + (this.lightning.on * 0.24) + ')';
          ctx.fillRect(0, 0, this.w, this.h);
        }
      }
      // vignette
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.34, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
      // low-health pulse
      if (this.lowHp > 0) {
        const p = 0.25 + 0.25 * Math.sin(this.time * 5);
        const g2 = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.22, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.62);
        g2.addColorStop(0, 'rgba(150,0,10,0)'); g2.addColorStop(1, 'rgba(160,0,16,' + (this.lowHp * p) + ')');
        ctx.fillStyle = g2; ctx.fillRect(0, 0, this.w, this.h);
      }
      // film grain (skipped entirely on the low tier)
      if (this.q.grain > 0) {
        ctx.globalAlpha = 0.035;
        for (let i = 0; i < this.q.grain; i++) { ctx.fillStyle = Math.random() > .5 ? '#fff' : '#000'; ctx.fillRect(Math.random() * this.w, Math.random() * this.h, 2, 2); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    drawOverlayFx(ctx, snap, dt) {
      if (this.hurtFlash > 0) {
        this.hurtFlash -= dt * 3;
        const el = document.getElementById('vignette');
        if (el) el.style.opacity = clamp(this.hurtFlash, 0, 1) * 0.85;
      }
    }

    /* ---------- FX events from the sim ---------- */
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
            this.fx.burst(f.x, f.y - 18, w === 'shotgun' ? 9 : 4, { a: f.a, spread: .5, sp: 190, life: .16, r: 1.8, c: '#ffd27a', kind: 'spark', grav: 60 });
            this.fx.burst(f.x, f.y - 18, 2, { a: f.a, spread: .3, sp: 60, life: .5, r: 5, c: '#6b6b6b', kind: 'smoke', vz: 26, grav: -10 });
            // shell casing
            if (w !== 'smg') this.fx.burst(f.x, f.y - 16, 1, { a: f.a + 1.7, sp: 90, life: .7, r: 1.6, c: '#d8b45a', vz: 90, grav: 300 });
            break;
          }
          case 'blood':
            this.fx.burst(f.x, f.y - 14, f.n || 6, { a: f.a, spread: 1.1, sp: 130, life: .5, r: 2.6, c: f.c || '#a01820', vz: 60, grav: 320 });
            this.fx.decal(f.x, f.y, 8 + (f.n || 5) * 1.6, 'rgba(80,10,14,.6)', 'blood');
            AU.SFX.hit(pos, cam, this.viewW, (f.n || 0) > 7);
            if (this.opts.dmg) this.fx.text(f.x, f.y - 34, '', '#fff');
            break;
          case 'spark':
            this.fx.burst(f.x, f.y - 6, 7, { a: f.a + Math.PI, spread: 1.2, sp: 150, life: .3, r: 1.5, c: '#ffe6a0', kind: 'spark', grav: 220 });
            this.fx.decal(f.x, f.y, 5, 'rgba(20,20,20,.5)', 'scorch');
            break;
          case 'die':
            this.fx.burst(f.x, f.y - 12, f.boss ? 40 : 14, { sp: f.boss ? 260 : 130, life: .8, r: 3.2, c: '#8e1b1b', vz: 90, grav: 300 });
            this.fx.decal(f.x, f.y, (f.r || 16) * 1.9, 'rgba(74,10,14,.55)', 'blood');
            AU.SFX.die(pos, cam, this.viewW, f.type);
            if (f.boss) { this.fx.ring(f.x, f.y, 20, 340, '#ff4d6d', 1.1, 6); AU.SFX.roar(pos, cam, this.viewW); }
            break;
          case 'hurt':
            this.hurtFlash = 1;
            // remember WHERE the hit came from so FP can point at it
            if (f.id === this.youId && f.sx !== undefined && f.sy !== undefined) {
              this.hurtDir = Math.atan2(f.sy - f.y, f.sx - f.x);
              this.hurtDirT = 0.9;
            }
            this.fx.burst(f.x, f.y - 20, 6, { sp: 90, life: .4, r: 2.4, c: '#b01820', vz: 40, grav: 260 });
            break;
          case 'down':
            AU.SFX.down(pos, cam, this.viewW);
            this.fx.ring(f.x, f.y, 10, 90, '#e0263f', .8, 4);
            this.fx.burst(f.x, f.y - 10, 20, { sp: 150, life: .9, r: 3, c: '#8e1b1b', vz: 90, grav: 300 });
            this.fx.decal(f.x, f.y, 30, 'rgba(80,8,12,.5)', 'blood');
            break;
          case 'death': AU.SFX.down(pos, cam, this.viewW); this.fx.decal(f.x, f.y, 40, 'rgba(70,6,10,.6)', 'blood'); break;
          case 'revive': AU.SFX.revive(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 8, 80, '#4ade80', .7, 3); break;
          case 'breakfree': this.fx.ring(f.x, f.y, 8, 70, '#5ad1ff', .5, 3); AU.SFX.smash(pos, cam, this.viewW); break;
          case 'ability': {
            const hero = f.hero;
            AU.SFX.ability(hero, pos, cam, this.viewW);
            if (hero === 'berto') { this.fx.ring(f.x, f.y, 20, 150, '#ffd24a', .5, 7); this.fx.burst(f.x, f.y - 16, 26, { sp: 320, life: .45, r: 3, c: '#ffe6a0', kind: 'spark', grav: 40 }); }
            else if (hero === 'rhea') { this.fx.ring(f.x, f.y, 10, 150, '#8ef0c0', .9, 3); this.fx.burst(f.x, f.y - 10, 22, { sp: 90, life: 1.4, r: 3, c: '#8ef0c0', vz: 60, grav: -20 }); }
            else if (hero === 'junjun') { this.fx.burst(f.x, f.y - 8, 14, { a: f.a + Math.PI, spread: .8, sp: 200, life: .4, r: 3, c: '#9ad7ff', kind: 'smoke', grav: -10 }); }
            else { this.fx.burst(f.x, f.y - 16, 12, { a: f.a, spread: .5, sp: 130, life: .5, r: 3, c: '#ff9a3c', vz: 90, grav: 200 }); }
            break;
          }
          case 'aura': this.fx.ring(f.x, f.y, f.r * .3, f.r, '#8ef0c0', .6, 2); break;
          case 'explode': {
            const fire = f.kind === 'fire', hot = fire || f.kind === 'boom';
            const col = fire ? '#ff9a3c' : (f.kind === 'boom' ? '#ffb02e' : '#a8ff60');
            AU.SFX.explode(pos, cam, this.viewW, f.r > 90);
            this.fx.ring(f.x, f.y, 10, f.r * 1.5, col, .55, 5);
            this.fx.burst(f.x, f.y, 26, { sp: 250, life: .8, r: 4, c: fire ? '#ff8b3a' : col, vz: 120, grav: 240 });
            this.fx.burst(f.x, f.y, 14, { sp: 90, life: 1.6, r: 9, c: hot ? '#4a4a4a' : '#5a7a3a', kind: 'smoke', vz: 50, grav: -14 });
            this.fx.decal(f.x, f.y, f.r * .8, hot ? 'rgba(15,12,10,.55)' : 'rgba(90,150,50,.3)', hot ? 'scorch' : 'acid');
            break;
          }
          case 'flame':
            this.fx.burst(f.x, f.y, 1, { sp: 20, life: .8, r: 3.4, c: '#ff9a3c', vz: 60, grav: -30 });
            break;
          case 'haz_end': break;
          case 'spit': AU.SFX.spit(pos, cam, this.viewW); break;
          case 'cry': AU.SFX.cry(pos, cam, this.viewW); this.fx.text(f.x, f.y - 40, '♪', '#c9a7e0'); break;
          case 'leap': AU.SFX.screech(pos, cam, this.viewW); this.fx.burst(f.x, f.y, 10, { sp: 120, life: .5, r: 3, c: '#b9a7c9', kind: 'smoke', grav: -10 }); break;
          case 'tackle': AU.SFX.smash(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 10, 90, '#6d4a7a', .5, 4); break;
          case 'charge_warn': AU.SFX.charge(pos, cam, this.viewW); break;
          case 'charge_go': this.fx.burst(f.x, f.y, 12, { a: f.a + Math.PI, spread: 1, sp: 200, life: .5, r: 4, c: '#8c4a3a', kind: 'smoke', grav: -8 }); break;
          case 'smash': AU.SFX.smash(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 12, 110, '#ffb02e', .5, 5); this.fx.burst(f.x, f.y, 20, { sp: 240, life: .7, r: 4, c: '#6b6b6b', vz: 120, grav: 320 }); break;
          case 'curse_warn': this.fx.ring(f.x, f.y, 20, 92, '#a8ff60', .8, 2); break;
          case 'swipe': this.fx.burst(f.x + Math.cos(f.a) * 22, f.y + Math.sin(f.a) * 22 - 16, 5, { a: f.a, spread: 1.1, sp: 140, life: .28, r: 2, c: '#e8e0d0', kind: 'spark', grav: 60 }); break;
          case 'pin': this.fx.ring(f.x, f.y, 8, 60, '#e0263f', .5, 3); break;
          case 'reload': AU.SFX.reload(pos, cam, this.viewW); break;
          case 'reload_end': AU.SFX.ui('click'); break;
          case 'dry': AU.SFX.dry(pos, cam, this.viewW); break;
          case 'pickup': AU.SFX.pickup(pos, cam, this.viewW, f.kind); this.fx.text(f.x, f.y - 40, f.txt, f.kind === 'medkit' ? '#5cff9d' : f.kind === 'ammo' ? '#ffcc44' : f.kind === 'weapon' ? '#ffd27a' : f.kind === 'throw' ? '#ff9a3c' : f.kind === 'armor' ? '#8fb4ff' : '#9ad7ff'); this.fx.ring(f.x, f.y, 6, 40, '#fff', .35, 2); break;
          case 'boss_spawn': AU.SFX.roar(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 30, 460, '#ff2d55', 1.4, 8); this.fx.burst(f.x, f.y, 50, { sp: 320, life: 1.4, r: 5, c: '#5a2436', vz: 160, grav: 260 }); break;
          case 'boss_split': AU.SFX.screech(pos, cam, this.viewW); AU.SFX.roar(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 20, 380, '#ff5f7a', 1.1, 6); this.fx.burst(f.x, f.y - 40, 60, { sp: 300, life: 1.2, r: 4, c: '#8e1b1b', vz: 180, grav: 300 }); break;
          case 'boss_die': AU.SFX.roar(pos, cam, this.viewW); AU.SFX.explode(pos, cam, this.viewW, true); this.fx.ring(f.x, f.y, 20, 520, '#ff2d55', 1.6, 9); this.fx.burst(f.x, f.y - 30, 90, { sp: 380, life: 1.8, r: 5, c: '#a01820', vz: 220, grav: 260 }); break;
          case 'boss_part': AU.SFX.explode(pos, cam, this.viewW, true); this.fx.ring(f.x, f.y, 20, 300, '#c58cff', 1, 6); break;
          case 'summon': AU.SFX.screech(pos, cam, this.viewW); this.fx.ring(f.x, f.y, 20, 200, '#c58cff', .8, 4); break;
          case 'dive_warn': this.fx.ring(f.x, f.y, 10, 80, '#ff2d55', .7, 3); break;
          case 'dive_hit': AU.SFX.smash(pos, cam, this.viewW); this.fx.burst(f.x, f.y, 30, { sp: 260, life: .8, r: 4, c: '#8e1b1b', vz: 150, grav: 300 }); break;
          case 'boss_cast': AU.SFX.spit(pos, cam, this.viewW); break;
          case 'horde': AU.SFX.horde(cam); break;
          case 'horde_spawn': this.fx.burst(f.x, f.y, 10, { sp: 120, life: 1.2, r: 6, c: '#3a3a3a', kind: 'smoke', vz: 40, grav: -12 }); break;
          case 'special_spawn': this.fx.ring(f.x, f.y, 8, 70, '#ffb02e', .6, 3); break;
          case 'fall': AU.SFX.smash(pos, cam, this.viewW); break;
          case 'gen_on': AU.SFX.ui('start'); this.fx.ring(f.x, f.y, 10, 220, '#ffe6a8', 1, 4); break;
          case 'wrench': AU.SFX.ui('click'); this.fx.burst(f.x, f.y - 20, 3, { sp: 70, life: .3, r: 1.6, c: '#ffe6a8', kind: 'spark', grav: 200 }); break;
          case 'flow_done': AU.SFX.ui('start'); break;
          case 'objective': AU.SFX.ui('click'); break;
          case 'victory': AU.SFX.ui('win'); break;
          case 'defeat': AU.SFX.ui('lose'); break;
          case 'break':
            AU.SFX.smash(pos, cam, this.viewW);
            this.fx.burst(f.x, f.y - 10, f.n || 9, { sp: 175, life: .7, r: 3.2, c: f.c || '#a9762f', vz: 155, grav: 430 });
            this.fx.ring(f.x, f.y, 4, 34, hexA(f.c || '#a9762f', .85), .3, 2);
            this.fx.decal(f.x, f.y, 17, 'rgba(20,18,16,.4)', 'scorch');
            break;
          case 'swap': AU.SFX.reload(pos, cam, this.viewW); this.fx.text(f.x, f.y - 46, 'SWAP', '#ffd27a'); break;
          case 'deny': AU.SFX.dry(pos, cam, this.viewW); break;
          case 'throw':
            AU.SFX.ui('click');
            this.fx.burst(f.x + Math.cos(f.a) * 14, f.y - 18 + Math.sin(f.a) * 14, 3, { sp: 60, life: .3, r: 1.6, c: '#d8d2c0', kind: 'spark', grav: 120 });
            break;
          case 'armor': this.fx.text(f.x, f.y - 44, '-' + f.v, '#8fb4ff'); break;
          case 'armor_break':
            AU.SFX.smash(pos, cam, this.viewW);
            this.fx.text(f.x, f.y - 48, 'VEST SHREDDED', '#ff8080');
            this.fx.ring(f.x, f.y, 8, 60, '#8fb4ff', .45, 3);
            this.fx.burst(f.x, f.y - 14, 12, { sp: 150, life: .6, r: 2.6, c: '#8fb4ff', vz: 120, grav: 380 });
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
      for (const e of ents.en) sprites.push({ x: e.x, y: e.y, k: 'en', t: e.t, b: e.b, f: e.f });
      for (const sv of ents.surv) if (sv.id !== this.youId && !sv.dd) sprites.push({ x: sv.x, y: sv.y, k: 'ally', t: sv.hero });
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
        if (sp.k === 'en') {
          const c = sp.b ? '#ff2d55' : sp.t === 'tiyanak' ? '#e0263f' : sp.t === 'batibat' ? '#8b5cf6'
            : sp.t === 'mangkukulam' ? '#3ddc84' : sp.t === 'pugot' ? '#9aa0ab' : sp.t === 'spitter' ? '#2dd4bf' : '#b7c05a';
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.ellipse(sp.sx, top + hh * 0.62, ww * 0.5, hh * 0.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(sp.sx, top + hh * 0.16, ww * 0.34, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff2'; ctx.beginPath(); ctx.arc(sp.sx - ww * 0.12, top + hh * 0.14, ww * 0.07, 0, Math.PI * 2); ctx.arc(sp.sx + ww * 0.12, top + hh * 0.14, ww * 0.07, 0, Math.PI * 2); ctx.fill();
          if (sp.f) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(sp.sx, top + hh * 0.5, ww * 0.5, hh * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
        } else if (sp.k === 'ally') {
          ctx.fillStyle = '#5ad1ff';
          ctx.beginPath(); ctx.ellipse(sp.sx, top + hh * 0.62, ww * 0.45, hh * 0.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(sp.sx, top + hh * 0.16, ww * 0.3, 0, Math.PI * 2); ctx.fill();
        } else if (sp.k === 'item') {
          ctx.fillStyle = '#ffb02e';
          ctx.fillRect(sp.sx - ww * 0.5, top, ww, hh);
        } else {
          ctx.fillStyle = '#7a6a52';
          ctx.fillRect(sp.sx - ww * 0.5, top, ww, hh);
        }
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

      // ---- weapon viewmodel ----
      const sway = Math.sin(this.fpBob * 0.5) * (this.fpMoving ? 8 : 2);
      const gx = W / 2 + sway, gy = H - H * 0.06 + Math.abs(Math.cos(this.fpBob)) * (this.fpMoving ? 5 : 2);
      ctx.fillStyle = '#171a22';
      ctx.fillRect(gx - W * 0.035, gy - H * 0.14, W * 0.07, H * 0.22);
      ctx.fillStyle = '#262a35';
      ctx.fillRect(gx - W * 0.018, gy - H * 0.34, W * 0.036, H * 0.22);
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(gx - W * 0.008, gy - H * 0.36, W * 0.016, H * 0.05);
      if (this.fpMuzzle > 0) {
        this.fpMuzzle -= dt;
        ctx.fillStyle = 'rgba(255,196,90,' + (this.fpMuzzle * 8).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(gx, gy - H * 0.31, W * 0.03, 0, Math.PI * 2); ctx.fill();
      }

      // vignette for the horror mood
      g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    /* Edge-of-screen placement for an off-view bearing (view space: +x forward,
       +y right). Pure so tests can pin the geometry. */
    static threatMarker(bear, W, H, m) {
      const vx = Math.cos(bear), vy = Math.sin(bear);   // view space: +x fwd, +y right
      const behind = vx < 0;
      const kx = Math.abs(vy) < 1e-4 ? Infinity : (W / 2 - m) / Math.abs(vy);
      const ky = Math.abs(vx) < 1e-4 ? Infinity : (H / 2 - m) / Math.abs(vx);
      const K = Math.min(kx, ky);
      return { px: W / 2 + vy * K, py: H / 2 - vx * K, side: vy >= 0 ? 1 : -1, behind };
    }

    /* First-person awareness: off-view threat chevrons + proximity pulse +
       a directional damage ring. FP has no peripheral vision; this is yours. */
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

  root.ABAW_RENDER = { Renderer, drawPortrait, roundRect, shade, hexA, hex2rgb, Fx };
})(typeof self !== 'undefined' ? self : this);
