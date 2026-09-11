/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  core/level.js
   Deterministic procedural level generation (shared client/server).
   Same seed => identical level on every peer.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.ABAW_LEVEL = factory(root.ABAW_DATA);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const T = D.TILE;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const idx = (L, x, y) => y * L.w + x;
  const inb = (L, x, y) => x >= 0 && y >= 0 && x < L.w && y < L.h;
  function walkable(t) { return t === T.FLOOR || t === T.WATER || t === T.RUBBLE || t === T.RAIL || t === T.ROAD; }

  /* ---------------------------------------------------------------
     Build a stage level
     --------------------------------------------------------------- */
  function generate(stage) {
    const rnd = mulberry32(stage.seed);
    const L = {
      id: stage.id, biome: stage.biome, seed: stage.seed,
      w: stage.w, h: stage.h, tile: stage.tile,
      grid: new Uint8Array(stage.w * stage.h),
      props: [], breakables: [], lights: [], spawns: [], nodes: [],
      objectives: [], hazards: []
    };
    L.g = L.grid;

    // 1. Base fill
    const base = stage.biome === 'station' ? T.FLOOR : T.ROAD;
    L.grid.fill(stage.biome === 'skyway' ? T.GAP : base);

    // 2. Spine path (tile coords) from start to end
    const path = makeSpine(L, rnd, stage);
    L.path = path;

    // 3. Carve world around spine depending on biome
    if (stage.biome === 'avenue') buildAvenue(L, rnd, path);
    else if (stage.biome === 'station') buildStation(L, rnd, path);
    else buildSkyway(L, rnd, path);

    // 4. Flood the low ground (Metro Manila typhoon flooding)
    if (stage.biome !== 'skyway') flood(L, rnd, stage.biome === 'station' ? 0.10 : 0.22);

    // 5. Guarantee connectivity: carve corridor along the whole spine
    carvePath(L, path, stage.biome === 'skyway' ? 6 : 5);


    // 6. Scatter props / cover / lights
    scatterProps(L, rnd, stage);

    // 6b. guarantee a walkable lane along the whole spine (clutter can never wall off the route)
    carvePath(L, path, 3);
    pruneLane(L, path, 1);

    // 7. Objective anchors
    placeObjectives(L, stage, rnd);

    // 8. Start & extract points
    const s0 = path[0], s1 = path[path.length - 1];
    // guarantee the start & extraction pads are open ground
    for (const pt of [s0, s1]) {
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const gx = pt.x + ox, gy = pt.y + oy;
        if (!inb(L, gx, gy)) continue;
        const t = L.g[idx(L, gx, gy)];
        if (!walkable(t)) L.g[idx(L, gx, gy)] = T.ROAD;
      }
    }
    L.spawn = { x: (s0.x + 0.5) * L.tile, y: (s0.y + 0.5) * L.tile };
    L.extract = { x: (s1.x + 0.5) * L.tile, y: (s1.y + 0.5) * L.tile };
    const s2 = path[Math.min(path.length - 1, 2)];
    L.startDir = Math.atan2(s2.y - s0.y, s2.x - s0.x) || 0;

    // progress markers along the path (used by director/objectives)
    L.marks = [];
    for (let i = 0; i < path.length; i++) {
      L.marks.push({ x: (path[i].x + 0.5) * L.tile, y: (path[i].y + 0.5) * L.tile, t: i / (path.length - 1) });
    }

    // 9. Route integrity: every path point, anchor and the extract must be reachable
    L.flowAnchorsTmp = L.flowAnchors;
    verifyConnectivity(L, path);
    delete L.flowAnchorsTmp;
    // 10. Skyway: seal every edge so nobody walks into the void
    if (stage.biome === 'skyway') { guardRails(L); guardRails(L); }
    // 10b. Loot containers. Runs LAST so the walkable set is final and a
    //      breakable can never be placed on a tile the guard rails just sealed.
    scatterBreakables(L, rnd, stage);
    // 11. director spawn nodes (needs the final walkable set)
    buildSpawnNodes(L, rnd);
    return L;
  }

  /* -------- spine: chain of waypoints across the map, rasterised -------- */
  function makeSpine(L, rnd, stage) {
    const vert = L.h > L.w;
    const M = 4;
    // start & goal on opposite ends of the map
    let sx, sy, tx, ty;
    if (vert) {
      sx = Math.floor(L.w * (0.2 + rnd() * 0.6)); sy = M + 1;
      tx = Math.floor(L.w * (0.2 + rnd() * 0.6)); ty = L.h - M - 2;
    } else {
      sx = M + 1; sy = Math.floor(L.h * (0.2 + rnd() * 0.6));
      tx = L.w - M - 2; ty = Math.floor(L.h * (0.2 + rnd() * 0.6));
    }
    // intermediate waypoints: advance along the dominant axis, jitter the other
    const legs = 5 + Math.floor(rnd() * 3);
    const wps = [{ x: sx, y: sy }];
    for (let i = 1; i < legs; i++) {
      const t = i / legs;
      let x = Math.round(lerp(sx, tx, t)), y = Math.round(lerp(sy, ty, t));
      const span = vert ? L.w : L.h;
      const jit = Math.round((rnd() - 0.5) * span * 0.5);
      if (vert) x = clamp(x + jit, M + 1, L.w - M - 2); else y = clamp(y + jit, M + 1, L.h - M - 2);
      wps.push({ x, y });
    }
    wps.push({ x: tx, y: ty });
    // rasterise waypoint chain into a 1-tile-step path
    const path = [{ x: wps[0].x, y: wps[0].y }];
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      let cx = a.x, cy = a.y, guard = 0;
      while ((cx !== b.x || cy !== b.y) && guard++ < 4000) {
        const dx = b.x - cx, dy = b.y - cy;
        // prefer the dominant axis, occasionally the other, for a street-like zig-zag
        if (dx !== 0 && dy !== 0 && rnd() < 0.42) cx += Math.sign(dx);
        else if (Math.abs(dx) >= Math.abs(dy)) cx += Math.sign(dx);
        else cy += Math.sign(dy);
        cx = clamp(cx, M, L.w - M - 1); cy = clamp(cy, M, L.h - M - 1);
        const last = path[path.length - 1];
        if (last.x !== cx || last.y !== cy) path.push({ x: cx, y: cy });
      }
    }
    // resample to a steady cadence so flow anchors land evenly
    const out = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const prev = out[out.length - 1];
      if (Math.abs(path[i].x - prev.x) + Math.abs(path[i].y - prev.y) >= 2) out.push(path[i]);
    }
    out.push(path[path.length - 1]);
    return out;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function carvePath(L, path, width) {
    const half = Math.floor(width / 2);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(a.x + (b.x - a.x) * (s / Math.max(1, steps)));
        const y = Math.round(a.y + (b.y - a.y) * (s / Math.max(1, steps)));
        for (let oy = -half; oy <= half; oy++) for (let ox = -half; ox <= half; ox++) {
          const gx = x + ox, gy = y + oy;
          if (!inb(L, gx, gy)) continue;
          if (gx < 1 || gy < 1 || gx > L.w - 2 || gy > L.h - 2) continue;
          const cur = L.g[idx(L, gx, gy)];
          if (cur === T.GAP) L.g[idx(L, gx, gy)] = T.ROAD;
          else if (!walkable(cur) && cur !== T.WATER && cur !== T.BLOCK) L.g[idx(L, gx, gy)] = (i % 7 === 0) ? T.RUBBLE : T.ROAD;
        }
      }
    }
  }

  /* ---------------- BIOME: flooded avenue (city blocks) ---------------- */
  function buildAvenue(L, rnd, path) {
    const g = L.g;
    // city blocks of buildings on a coarse lattice
    const bs = 9 + Math.floor(rnd() * 3);
    for (let by = 2; by < L.h - 2; by += bs) {
      for (let bx = 2; bx < L.w - 2; bx += bs) {
        if (rnd() < 0.16) continue;                       // plaza / parking
        const w = bs - 3 - Math.floor(rnd() * 2);
        const h = bs - 3 - Math.floor(rnd() * 2);
        for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) {
          if (!inb(L, x, y)) continue;
          const edge = (x === bx || y === by || x === bx + w - 1 || y === by + h - 1);
          if (edge) g[idx(L, x, y)] = T.WALL;
          else g[idx(L, x, y)] = T.BLOCK;                 // interior = solid mass
        }
        // doorways
        const doors = 1 + Math.floor(rnd() * 2);
        for (let d = 0; d < doors; d++) {
          const side = Math.floor(rnd() * 4);
          let dx = bx + Math.floor(rnd() * w), dy = by + Math.floor(rnd() * h);
          if (side === 0) dy = by; else if (side === 1) dy = by + h - 1;
          else if (side === 2) dx = bx; else dx = bx + w - 1;
          if (inb(L, dx, dy)) g[idx(L, dx, dy)] = T.FLOOR;
          if (inb(L, dx + 1, dy)) g[idx(L, dx + 1, dy)] = T.FLOOR;
          if (inb(L, dx, dy + 1)) g[idx(L, dx, dy + 1)] = T.FLOOR;
        }
        L.props.push({ t: 'building', x: (bx + w / 2) * L.tile, y: (by + h / 2) * L.tile, w: w * L.tile, h: h * L.tile, z: 150 + rnd() * 110 });
      }
    }
    // cross streets
    for (let y = 2; y < L.h - 2; y += bs) for (let x = 2; x < L.w - 2; x++) if (walkable(g[idx(L, x, y)]) || g[idx(L, x, y)] === T.WALL) g[idx(L, x, y)] = T.ROAD;
    for (let x = 2; x < L.w - 2; x += bs) for (let y = 2; y < L.h - 2; y++) if (walkable(g[idx(L, x, y)]) || g[idx(L, x, y)] === T.WALL) g[idx(L, x, y)] = T.ROAD;
    // map border walls
    border(L, T.WALL);
    // street lamps along the path
    path.forEach((p, i) => { if (i % 6 === 0) L.lights.push({ x: (p.x + 0.5) * L.tile, y: (p.y - 1.6) * L.tile, r: 190, c: '#ffd9a0', f: 0.85, flicker: true }); });
  }

  /* ---------------- BIOME: LRT station (interior) ---------------- */
  function buildStation(L, rnd, path) {
    const g = L.g;
    g.fill(T.FLOOR);
    border(L, T.WALL, 2);
    // platform walls with pillars
    const bs = 7;
    for (let by = 4; by < L.h - 4; by += bs) {
      for (let bx = 4; bx < L.w - 4; bx += bs) {
        const kind = rnd();
        if (kind < 0.34) {                                // service room
          const w = bs - 2, h = bs - 2;
          for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) {
            if (!inb(L, x, y)) continue;
            const edge = (x === bx || y === by || x === bx + w - 1 || y === by + h - 1);
            g[idx(L, x, y)] = edge ? T.WALL : T.FLOOR;
          }
          const side = Math.floor(rnd() * 4);
          let dx = bx + 1 + Math.floor(rnd() * (w - 2)), dy = by + 1 + Math.floor(rnd() * (h - 2));
          if (side === 0) dy = by; else if (side === 1) dy = by + h - 1; else if (side === 2) dx = bx; else dx = bx + w - 1;
          g[idx(L, dx, dy)] = T.FLOOR;
          L.props.push({ t: 'room', x: (bx + w / 2) * L.tile, y: (by + h / 2) * L.tile, w: w * L.tile, h: h * L.tile, z: 96 });
        } else if (kind < 0.66) {                          // pillars
          for (let y = by; y < by + bs - 2; y += 3) for (let x = bx; x < bx + bs - 2; x += 3) {
            if (!inb(L, x, y)) continue;
            g[idx(L, x, y)] = T.BLOCK;
            L.props.push({ t: 'pillar', x: (x + 0.5) * L.tile, y: (y + 0.5) * L.tile, r: L.tile * 0.55, z: 130 });
          }
        } else if (kind < 0.82) {                          // rail trench
          for (let x = bx; x < bx + bs - 2; x++) {
            if (!inb(L, x, by) || !inb(L, x, by + 1)) continue;
            g[idx(L, x, by)] = T.RAIL; g[idx(L, x, by + 1)] = T.RAIL;
          }
          L.props.push({ t: 'rail', x: (bx + (bs - 2) / 2) * L.tile, y: (by + 1) * L.tile, w: (bs - 2) * L.tile, h: 2 * L.tile });
        } else {                                           // turnstiles / benches
          for (let x = bx; x < bx + bs - 3; x++) { if (inb(L, x, by)) { g[idx(L, x, by)] = T.BLOCK; } }
          L.props.push({ t: 'turnstile', x: (bx + (bs - 3) / 2) * L.tile, y: (by + 0.5) * L.tile, w: (bs - 3) * L.tile, h: L.tile });
        }
      }
    }
    // train cars parked on rails
    for (let i = 0; i < 3; i++) {
      const p = path[Math.floor(path.length * (0.25 + i * 0.25))];
      if (!p) continue;
      L.props.push({ t: 'traincar', x: (p.x + 2.5) * L.tile, y: (p.y + 0.5) * L.tile, w: 5 * L.tile, h: 2.4 * L.tile, z: 108, rot: rnd() * 0.2 - 0.1 });
    }
    L.lights.push();
    // emergency lights
    path.forEach((p, i) => { if (i % 9 === 0) L.lights.push({ x: (p.x + 0.5) * L.tile, y: (p.y + 0.5) * L.tile, r: 150, c: '#7fd4ff', f: 0.5, flicker: true, emergency: true }); });
  }

  /* ---------------- BIOME: Skyway (elevated highway) ---------------- */
  function buildSkyway(L, rnd, path) {
    const g = L.g;
    g.fill(T.GAP);
    // wide elevated deck along the spine
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) || 1;
      const width = 9 + Math.floor(Math.sin(i * 0.18) * 1.8);
      const half = Math.floor(width / 2);
      for (let s = 0; s <= steps; s++) {
        const cx = Math.round(a.x + (b.x - a.x) * (s / steps));
        const cy = Math.round(a.y + (b.y - a.y) * (s / steps));
        const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        for (let o = -half; o <= half; o++) {
          const x = horiz ? cx : cx + o, y = horiz ? cy + o : cy;
          if (!inb(L, x, y) || x < 1 || y < 1 || x > L.w - 2 || y > L.h - 2) continue;
          g[idx(L, x, y)] = T.ROAD;
        }
        // concrete barriers on the deck edges
        for (const o of [-half - 1, half + 1]) {
          const x = horiz ? cx : cx + o, y = horiz ? cy + o : cy;
          if (inb(L, x, y) && g[idx(L, x, y)] === T.GAP) g[idx(L, x, y)] = T.BLOCK;
        }
      }
      // collapsed sections -> rubble / breaches
      if (i % 23 === 11) {
        for (let o = -3; o <= 3; o++) {
          const x = a.x + o, y = a.y + o;
          if (inb(L, x, y) && g[idx(L, x, y)] === T.ROAD && rnd() < 0.5) g[idx(L, x, y)] = T.RUBBLE;
        }
        L.props.push({ t: 'breach', x: (a.x + 0.5) * L.tile, y: (a.y + 0.5) * L.tile, r: L.tile * 2.2 });
      }
      // wrecked vehicles
      if (i % 8 === 4) {
        L.props.push({ t: rnd() < 0.4 ? 'jeepney' : 'car', x: (a.x + (rnd() * 4 - 2)) * L.tile, y: (a.y + (rnd() * 4 - 2)) * L.tile, r: L.tile * (rnd() < 0.4 ? 1.5 : 1.15), rot: rnd() * Math.PI * 2, z: 42 });
      }
      if (i % 11 === 0) L.lights.push({ x: (a.x + 0.5) * L.tile, y: (a.y + 0.5) * L.tile, r: 165, c: '#ffd9a0', f: 0.7, flicker: true });
    }
    // helipad / extraction plateau at the end
    const e = path[path.length - 1];
    for (let y = e.y - 6; y <= e.y + 6; y++) for (let x = e.x - 6; x <= e.x + 6; x++) {
      if (!inb(L, x, y)) continue;
      const d = Math.hypot(x - e.x, y - e.y);
      g[idx(L, x, y)] = d < 5.4 ? T.ROAD : (d < 6.4 ? T.BLOCK : T.GAP);
    }
    L.props.push({ t: 'helipad', x: (e.x + 0.5) * L.tile, y: (e.y + 0.5) * L.tile, r: 5.2 * L.tile });
    L.lights.push({ x: (e.x + 0.5) * L.tile, y: (e.y + 0.5) * L.tile, r: 420, c: '#ff6a4d', f: 1.0, flicker: false });
  }

  /* Guard rails: any void tile touching walkable deck becomes a concrete barrier.
     Must run AFTER carving/props so nothing re-opens the edge. */
  function guardRails(L) {
    const g = L.g, flip = [];
    for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 1; x++) {
      const i = y * L.w + x;
      if (g[i] !== T.GAP) continue;
      let touches = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = g[(y + oy) * L.w + (x + ox)];
        if (t === T.ROAD || t === T.RUBBLE || t === T.RAIL || t === T.FLOOR || t === T.WATER) { touches = true; break; }
      }
      if (touches) flip.push([x, y]);
    }
    flip.forEach(([x, y], n) => {
      g[y * L.w + x] = T.BLOCK;
      if (n % 2 === 0) L.props.push({ t: 'barrier', x: (x + 0.5) * L.tile, y: (y + 0.5) * L.tile, r: L.tile * 0.5, rot: (n % 4) * 0.7, z: 26 });
    });
    return flip.length;
  }

  function border(L, t, n) {
    n = n || 1;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (x < n || y < n || x >= L.w - n || y >= L.h - n) L.g[idx(L, x, y)] = t;
    }
  }

  function flood(L, rnd, amount) {
    // low-lying water collects in open road/floor clusters away from buildings
    for (let i = 0; i < Math.floor(L.w * L.h * amount * 0.035); i++) {
      const cx = 2 + Math.floor(rnd() * (L.w - 4)), cy = 2 + Math.floor(rnd() * (L.h - 4));
      const r = 2 + rnd() * 4.5;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!inb(L, x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > r) continue;
        const t = L.g[idx(L, x, y)];
        if (t === T.ROAD || t === T.FLOOR || t === T.RUBBLE) L.g[idx(L, x, y)] = T.WATER;
      }
    }
  }


  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  /* -------- breakable loot props --------
     Deliberately a SEPARATE layer from scatterProps: these never write to the
     pathing grid, so blowing one up can never strand an agent or invalidate a
     cached flow field. Placement is biased toward the spine path so they are
     actually found, but the target tile must be walkable, which keeps them from
     visually overlapping the blocking clutter. */
  const BREAKABLE_MIX = {
    avenue:  [['trash', 30], ['box', 22], ['crate', 22], ['barrel', 14], ['cabinet', 6], ['vending', 6]],
    station: [['box', 24], ['vending', 22], ['cabinet', 18], ['crate', 18], ['trash', 12], ['barrel', 6]],
    skyway:  [['crate', 34], ['barrel', 26], ['box', 22], ['trash', 12], ['cabinet', 6]]
  };
  function scatterBreakables(L, rnd, stage) {
    const mix = BREAKABLE_MIX[stage.biome] || BREAKABLE_MIX.avenue;
    let tot = 0; for (const m of mix) tot += m[1];
    const want = stage.biome === 'skyway' ? 24 : 30;
    const out = [];
    const minSep = L.tile * 1.5, minSep2 = minSep * minSep;
    let guard = 0;
    while (out.length < want && guard++ < want * 60) {
      // pick a point along the spine, then jitter off it
      const p = L.path[Math.floor(rnd() * L.path.length)];
      const ang = rnd() * Math.PI * 2;
      const rad = (0.9 + rnd() * 2.9) * L.tile;
      const wx = (p.x + 0.5) * L.tile + Math.cos(ang) * rad;
      const wy = (p.y + 0.5) * L.tile + Math.sin(ang) * rad;
      const tx = Math.floor(wx / L.tile), ty = Math.floor(wy / L.tile);
      if (!inb(L, tx, ty) || !walkable(L.g[idx(L, tx, ty)])) continue;
      // never drop loot in deadly water/void or right on the spawn/extract pad
      if (isDeadly(L.g[idx(L, tx, ty)])) continue;
      if (dist(wx, wy, L.spawn.x, L.spawn.y) < L.tile * 4) continue;
      if (dist(wx, wy, L.extract.x, L.extract.y) < L.tile * 3) continue;
      let clash = false;
      for (const b of out) if (dist2(b.x, b.y, wx, wy) < minSep2) { clash = true; break; }
      if (clash) continue;
      let r = rnd() * tot, t = mix[0][0];
      for (const m of mix) { if (r < m[1]) { t = m[0]; break; } r -= m[1]; }
      out.push({ id: 'br' + out.length, t, x: Math.round(wx), y: Math.round(wy), rot: rnd() * 0.6 - 0.3, seed: Math.floor(rnd() * 1e6) });
    }
    L.breakables = out;
    return out;
  }

  /* -------- props that are purely decorative + collidable clutter -------- */
  function scatterProps(L, rnd, stage) {
    const g = L.g, count = stage.biome === 'station' ? 70 : 120;
    const kinds = stage.biome === 'skyway'
      ? ['barrier', 'barrier', 'crate', 'debris', 'burning']
      : stage.biome === 'station'
        ? ['crate', 'bench', 'vending', 'debris', 'burning', 'locker']
        : ['car', 'jeepney', 'stall', 'dumpster', 'crate', 'barrier', 'debris', 'burning', 'balete'];
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 40) {
      const x = 3 + Math.floor(rnd() * (L.w - 6)), y = 3 + Math.floor(rnd() * (L.h - 6));
      if (g[idx(L, x, y)] !== T.ROAD && g[idx(L, x, y)] !== T.FLOOR && g[idx(L, x, y)] !== T.WATER) continue;
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const big = (kind === 'car' || kind === 'jeepney' || kind === 'dumpster' || kind === 'stall' || kind === 'balete' || kind === 'crate' || kind === 'barrier' || kind === 'vending' || kind === 'locker' || kind === 'bench' || kind === 'turnstile');
      // keep the spine lane clear: blocking props need 3 tiles of clearance
      const clearance = big ? 3 : 1;
      let near = false;
      for (const p of L.path) { if (Math.abs(p.x - x) <= clearance && Math.abs(p.y - y) <= clearance) { near = true; break; } }
      if (near && (big || rnd() < 0.72)) continue;
      if (big) {
        let ok = true;
        for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1 && ok; ox++) {
          const t = inb(L, x + ox, y + oy) ? g[idx(L, x + ox, y + oy)] : T.WALL;
          if (!walkable(t)) ok = false;
        }
        if (!ok) continue;
        g[idx(L, x, y)] = T.BLOCK;
        if (rnd() < 0.6) g[idx(L, x + 1, y)] = T.BLOCK;
      } else {
        if (rnd() < 0.35) g[idx(L, x, y)] = T.RUBBLE;
      }
      L.props.push({ t: kind, x: (x + 0.5) * L.tile, y: (y + 0.5) * L.tile, r: big ? L.tile * 1.15 : L.tile * 0.46, rot: rnd() * Math.PI * 2, z: big ? 46 : 30, seed: Math.floor(rnd() * 1e6) });
      if (kind === 'burning') L.lights.push({ x: (x + 0.5) * L.tile, y: (y + 0.5) * L.tile, r: 210, c: '#ff8b3a', f: 1.0, flicker: true });
      placed++;
    }
  }

  /* -------- generators / interactables + hold zones placed on the spine -------- */
  function placeObjectives(L, stage, rnd) {
    const p = L.path;
    L.flowAnchors = stage.flow.map((f, i) => {
      const t = f.dist;
      const pi = Math.min(p.length - 1, Math.max(0, Math.round(t * (p.length - 1))));
      const pt = p[pi];
      return {
        i, ...f,
        x: (pt.x + 0.5) * L.tile, y: (pt.y + 0.5) * L.tile,
        r: f.type === 'hold' || f.type === 'extract' ? L.tile * 7.5 : L.tile * 6
      };
    });
    // generators (stage 1-2)
    const gens = stage.flow.filter(f => f.kind === 'generator');
    if (gens.length) {
      const want = gens[0].count || 2;
      for (let i = 0; i < want; i++) {
        const t = 0.28 + i * (0.30 / want);
        const pi = Math.round(t * (p.length - 1));
        const pt = p[Math.min(p.length - 1, pi)];
        // find a nearby open tile offset from the path
        let ox = 3, oy = 0;
        for (let a = 0; a < 24; a++) {
          const cx = pt.x + Math.round(Math.cos(a) * 3), cy = pt.y + Math.round(Math.sin(a) * 3);
          if (inb(L, cx, cy) && walkable(L.g[idx(L, cx, cy)])) { ox = cx - pt.x; oy = cy - pt.y; break; }
        }
        L.objectives.push({ id: 'gen' + i, kind: 'generator', x: (pt.x + ox + 0.5) * L.tile, y: (pt.y + oy + 0.5) * L.tile, r: L.tile * 1.4, done: false, progress: 0 });
      }
    }
    // hold-zone barricades
    L.flowAnchors.forEach(f => {
      if (f.type === 'hold' || f.type === 'extract') L.props.push({ t: f.type === 'extract' ? 'chopper' : 'barricade', x: f.x, y: f.y, r: L.tile * 1.6, z: 60, anchor: f.i });
    });
  }

  /* -------- remove props that ended up inside the guaranteed lane -------- */
  function pruneLane(L, path, half) {
    const lane = new Set();
    for (const p of path) for (let oy = -half; oy <= half; oy++) for (let ox = -half; ox <= half; ox++) lane.add((p.x + ox) + ',' + (p.y + oy));
    const blocking = { car: 1, jeepney: 1, dumpster: 1, stall: 1, balete: 1, crate: 1, barrier: 1, vending: 1, locker: 1, bench: 1, turnstile: 1, pillar: 1 };
    L.props = L.props.filter(pr => {
      if (!blocking[pr.t]) return true;
      const gx = Math.floor(pr.x / L.tile), gy = Math.floor(pr.y / L.tile);
      return !lane.has(gx + ',' + gy);
    });
  }

  /* -------- BFS from the spawn; carve straight through anything that blocks the route -------- */
  function verifyConnectivity(L, path) {
    const reach = bfsFrom(L, L.spawn.x, L.spawn.y);
    const want = [{ x: L.extract ? L.extract.x : 0, y: L.extract ? L.extract.y : 0 }];
    (L.flowAnchorsTmp || []).forEach(a => want.push(a));
    // check every path point; if unreachable, carve a 2-wide channel to it
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const gi = idx(L, p.x, p.y);
      if (reach[gi]) continue;
      // carve from the nearest reachable earlier path point
      let from = null;
      for (let j = i - 1; j >= 0; j--) { if (reach[idx(L, path[j].x, path[j].y)]) { from = path[j]; break; } }
      from = from || path[0];
      const steps = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
      for (let s2 = 0; s2 <= steps; s2++) {
        const cx = Math.round(from.x + (p.x - from.x) * (s2 / Math.max(1, steps)));
        const cy = Math.round(from.y + (p.y - from.y) * (s2 / Math.max(1, steps)));
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox, gy = cy + oy;
          if (!inb(L, gx, gy) || gx < 1 || gy < 1 || gx > L.w - 2 || gy > L.h - 2) continue;
          const t = L.g[idx(L, gx, gy)];
          if (t === T.WALL || t === T.BLOCK) L.g[idx(L, gx, gy)] = T.ROAD;
        }
      }
      reach[idx(L, p.x, p.y)] = 1;
    }
    // final: extract + anchors must be reachable
    const reach2 = bfsFrom(L, L.spawn.x, L.spawn.y);
    return { extract: !!reach2[idx(L, Math.floor(L.extract.x / L.tile), Math.floor(L.extract.y / L.tile))] };
  }
  function bfsFrom(L, x0, y0) {
    const N = L.w * L.h, seen = new Uint8Array(N), q = new Int32Array(N);
    let sx = Math.floor(x0 / L.tile), sy = Math.floor(y0 / L.tile);
    sx = Math.max(0, Math.min(L.w - 1, sx)); sy = Math.max(0, Math.min(L.h - 1, sy));
    let head = 0, tail = 0;
    q[tail++] = idx(L, sx, sy); seen[idx(L, sx, sy)] = 1;
    while (head < tail) {
      const i = q[head++], x = i % L.w, y = (i / L.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!inb(L, nx, ny)) continue;
        const j = ny * L.w + nx;
        if (seen[j] || !walkable(L.g[j])) continue;
        seen[j] = 1; q[tail++] = j;
      }
    }
    return seen;
  }

  /* -------- director spawn nodes: walkable cells, graded by distance from path -------- */
  function buildSpawnNodes(L, rnd) {
    // only cells the horde can actually path out of
    const seen = bfsFrom(L, L.spawn.x, L.spawn.y);
    const cells = [];
    for (let y = 2; y < L.h - 2; y += 2) for (let x = 2; x < L.w - 2; x += 2) {
      if (!walkable(L.g[idx(L, x, y)])) continue;
      if (!seen[idx(L, x, y)]) continue;
      cells.push({ x, y });
    }
    // distance-from-spine map (cheap, sampled)
    const pathSet = L.path.map(p => p.x + ',' + p.y);
    const dmap = {};
    L.path.forEach((p, i) => { for (let o = -8; o <= 8; o++) for (let q = -8; q <= 8; q++) { const k = (p.x + o) + ',' + (p.y + q); const d = Math.hypot(o, q); if (!(k in dmap) || dmap[k] > d) dmap[k] = d; } });
    const far = [], near = [];
    cells.forEach(c => {
      const d = dmap[c.x + ',' + c.y];
      if (d === undefined || d > 7) far.push(c); else if (d > 4) near.push(c);
    });
    const pick = (arr, n) => { const out = []; for (let i = 0; i < n && arr.length; i++) out.push(arr.splice(Math.floor(rnd() * arr.length), 1)[0]); return out; };
    pick(far, 60).forEach(c => L.nodes.push({ x: (c.x + 0.5) * L.tile, y: (c.y + 0.5) * L.tile, kind: 'far' }));
    pick(near, 40).forEach(c => L.nodes.push({ x: (c.x + 0.5) * L.tile, y: (c.y + 0.5) * L.tile, kind: 'near' }));
    L.spawns = L.nodes.slice();
    if (!L.nodes.length) L.nodes.push({ x: L.spawn.x + 400, y: L.spawn.y + 400, kind: 'far' });
  }

  /* -------- flow field (multi-source BFS from survivors) for enemy nav -------- */
  function flowField(L, sources) {
    const N = L.w * L.h;
    if (!L._ff || L._ff.length !== N) { L._ff = new Int32Array(N); L._fq = new Int32Array(N); }
    const ff = L._ff, q = L._fq;
    ff.fill(-1);
    let head = 0, tail = 0;
    for (const s of sources) {
      const gx = Math.floor(s.x / L.tile), gy = Math.floor(s.y / L.tile);
      if (!inb(L, gx, gy)) continue;
      let i = idx(L, gx, gy);
      // find nearest walkable if inside a wall
      if (!walkable(L.g[i])) {
        let found = -1;
        for (let r = 1; r <= 3 && found < 0; r++)
          for (let oy = -r; oy <= r && found < 0; oy++) for (let ox = -r; ox <= r && found < 0; ox++) {
            const nx = gx + ox, ny = gy + oy;
            if (inb(L, nx, ny) && walkable(L.g[idx(L, nx, ny)])) found = idx(L, nx, ny);
          }
        i = found < 0 ? idx(L, gx, gy) : found;
      }
      if (ff[i] === -1) { ff[i] = 0; q[tail++] = i; }
    }
    while (head < tail) {
      const i = q[head++], d = ff[i] + 1;
      const x = i % L.w, y = (i / L.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!inb(L, nx, ny)) continue;
        const j = ny * L.w + nx;
        if (ff[j] !== -1 || !walkable(L.g[j])) continue;
        ff[j] = d; q[tail++] = j;
      }
    }
    return ff;
  }

  /* -------- helpers used by sim -------- */
  function tileAt(L, x, y) {
    const gx = Math.floor(x / L.tile), gy = Math.floor(y / L.tile);
    if (!inb(L, gx, gy)) return T.WALL;
    return L.g[gy * L.w + gx];
  }
  function isSolid(L, x, y) { const t = tileAt(L, x, y); return t === T.WALL || t === T.BLOCK; }
  function isDeadly(L, x, y) { return tileAt(L, x, y) === T.GAP; }
  function speedMul(L, x, y) {
    const t = tileAt(L, x, y);
    if (t === T.WATER) return 0.70;
    if (t === T.RUBBLE) return 0.86;
    if (t === T.RAIL) return 0.94;
    return 1;
  }
  function blocksSight(L, x, y) { return tileAt(L, x, y) === T.WALL; }

  function lineOfSight(L, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / (L.tile * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blocksSight(L, x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  /* -------- serialize the static level for network peers -------- */
  function serialize(L) {
    let s = '';
    for (let i = 0; i < L.grid.length; i++) s += L.grid[i].toString(8);
    return {
      id: L.id, biome: L.biome, seed: L.seed, w: L.w, h: L.h, tile: L.tile, grid: s,
      props: L.props, breakables: L.breakables || [], lights: L.lights, nodes: L.nodes, objectives: L.objectives,
      flowAnchors: L.flowAnchors, path: L.path, marks: L.marks,
      spawn: L.spawn, extract: L.extract, startDir: L.startDir
    };
  }
  function deserialize(o) {
    const L = Object.assign({}, o);
    L.grid = new Uint8Array(o.w * o.h);
    for (let i = 0; i < L.grid.length; i++) L.grid[i] = parseInt(o.grid[i], 8) || 0;
    L.g = L.grid;
    return L;
  }

  return { generate, serialize, deserialize, guardRails, verifyConnectivity, bfsFrom, flowField, tileAt, isSolid, isDeadly, speedMul, lineOfSight, walkable, mulberry32, inb, idx };
});
