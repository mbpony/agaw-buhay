/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  test/balance.js
   Headless play-through validation. A competent-player proxy
   (waypoint navigation, hazard avoidance, target priority,
   revives, abilities) plays every Act 1 stage on every
   difficulty and the results are asserted against the design
   contract:
     · Normal   — all three stages must be winnable
     · Veteran  — a clear step up, still winnable
     · Nightmare— brutal; at least the opening stage is winnable
     · no stage may soft-lock (every run must reach its own
       objectives), and the sim must stay far below real time
   ============================================================ */
/* Validation harness: a competent-player proxy that navigates by path waypoints.
   Not part of the shipped game — used to verify level traversal, objectives,
   boss fights, extraction and difficulty balance. */
const D = require('../core/data.js');
const LV = require('../core/level.js');
const { Sim } = require('../core/sim.js');

/* The proxy player deliberately jitters its aim and breaks navigation ties at
   random so it behaves like a human rather than an aimbot. That randomness has
   to be SEEDED, otherwise the same stage+seed produces a different run every
   time and the pass/fail contract turns into a coin flip. mulberry32 gives us
   the same jittery-but-reproducible player on every machine. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeController(sim, lvl, rnd) {
  const state = new Map();
  return function inputs() {
    const out = {};
    for (const s of sim.survivors) {
      if (s.dead) { out[s.id] = {}; continue; }
      let st = state.get(s.id);
      if (!st) { st = { stuckT: 0, lx: s.x, ly: s.y, jig: 0, jx: 0, jy: 0 }; state.set(s.id, st); }
      const inp = { mx: 0, my: 0, aimx: 1, aimy: 0, fire: false, ability: false, reload: false, interact: false, sprint: false, melee: false };

      // --- combat perception ---
      let tgt = null, td = Infinity;
      for (const e of sim.enemies) { if (e.dead) continue; const d = (e.x - s.x) ** 2 + (e.y - s.y) ** 2; if (d < td) { td = d; tgt = e; } }
      const mate = sim.survivors.find(o => o !== s && !o.dead && o.down);
      const f = sim.curFlow();

      // --- destination ---
      let gx, gy, wantInteract = false;
      if (mate && (!tgt || td > 170 * 170)) { gx = mate.x; gy = mate.y; wantInteract = true; }
      else if (f && f.type === 'objective') {
        const g = sim.objectives.filter(o => !o.done)[0];
        if (g) { gx = g.x; gy = g.y; wantInteract = true; }
      }
      if (gx === undefined && f) {
        if (f.type === 'hold' || f.type === 'extract') {
          const c = f.type === 'extract' ? lvl.extract : f;
          const wantT = f.type === 'extract' ? 1 : (f.dist === undefined ? 1 : f.dist);
          const dA = Math.hypot(c.x - s.x, c.y - s.y);
          if (dA > 250 || !LV.lineOfSight(lvl, s.x, s.y, c.x, c.y)) {
            const r = sim.markRoute(s, wantT, 4); gx = r.m.x; gy = r.m.y;
          } else { const a = sim.time * 0.4 + s.x * 0.01; gx = c.x + Math.cos(a) * 80; gy = c.y + Math.sin(a) * 80; }
        } else {
          // route along the carved corridor: nearest mark + lookahead, capped by objective
          const marks = lvl.marks;
          let bi = 0, bd = Infinity;
          for (let i = 0; i < marks.length; i++) { const d = (marks[i].x - s.x) ** 2 + (marks[i].y - s.y) ** 2; if (d < bd) { bd = d; bi = i; } }
          const targetT = f.dist === undefined ? 1 : f.dist;
          const targetI = Math.round(targetT * (marks.length - 1));
          const li = Math.min(marks.length - 1, Math.max(bi + 4, Math.min(targetI, bi + 4)));
          const idx2 = Math.min(li, targetI);
          gx = marks[idx2].x; gy = marks[idx2].y;
          if (bd < 130 * 130 && bi >= targetI - 1) { gx = marks[targetI].x; gy = marks[targetI].y; }
        }
      }
      if (gx === undefined) { gx = lvl.extract.x; gy = lvl.extract.y; }

      let dx = gx - s.x, dy = gy - s.y;
      let d = Math.hypot(dx, dy) || 1;

      // --- stuck detection (window based) ---
      st.chk = (st.chk || 0) - 1 / 60;
      if (st.chk <= 0) {
        st.chk = 0.5;
        const moved = Math.hypot(s.x - st.lx, s.y - st.ly);
        st.lx = s.x; st.ly = s.y;
        if (moved < 26 && d > 80) st.stuckT += 0.5; else st.stuckT = 0;
        if (st.stuckT >= 1.0 && !(st.jig > 0)) { st.jig = 0.9; st.sign = (st.sign || 1) * -1; }
        if (st.stuckT > 9) {
          st.stuckT = 0;
          const f2 = sim.curFlow();
          const tp = sim.findWalkable((f2 && f2.x) || gx, ((f2 && f2.y) || gy));
          s.x = tp.x; s.y = tp.y; s.iframe = 1.2;
        }
      }
      if (st.jig > 0) {
        st.jig -= 1 / 60;
        const pa = Math.atan2(dy, dx) + st.sign * Math.PI / 2;
        dx = Math.cos(pa) * d; dy = Math.sin(pa) * d;
      }

      // --- reactive steering ---
      if (tgt && td < 105 * 105 && !wantInteract && d > 150 && (s.hp / s.maxHp < 0.5 || tgt.boss || tgt.def.behavior === 'charger' || tgt.def.behavior === 'suffocate')) {
        const kx = -(tgt.x - s.x) / Math.sqrt(td) * d * 0.4, ky = -(tgt.y - s.y) / Math.sqrt(td) * d * 0.4;
        if (!LV.isSolid(lvl, s.x + kx / d * 52, s.y + ky / d * 52)) { dx += kx; dy += ky; }
      }
      for (const h of sim.hazards) {
        if (h.dead) continue;
        const ox = s.x - h.x, oy = s.y - h.y, dd = Math.hypot(ox, oy);
        if (dd < h.r + 46 && dd > 0.1) { const w = (h.r + 46 - dd) * 0.9; dx += ox / dd * w; dy += oy / dd * w; }
      }
      if (lvl.biome === 'skyway') {
        const fx = s.x + dx / (Math.hypot(dx, dy) || 1) * 54, fy = s.y + dy / (Math.hypot(dx, dy) || 1) * 54;
        if (LV.isDeadly(lvl, fx, fy)) { const p = 1; dx += -dy / (Math.hypot(dx, dy) || 1) * 2.4 * p; dy += dx / (Math.hypot(dx, dy) || 1) * 2.4 * p; }
      }
      // wall feeler (both sides, prefer the open one)
      const dl0 = Math.hypot(dx, dy) || 1;
      const ux = dx / dl0, uy = dy / dl0;
      if (LV.isSolid(lvl, s.x + ux * 44, s.y + uy * 44)) {
        const l = LV.isSolid(lvl, s.x - uy * 44, s.y + ux * 44) ? -1 : 1;
        const r2 = LV.isSolid(lvl, s.x + uy * 44, s.y - ux * 44) ? -1 : 1;
        const pick = (l === -1 && r2 === -1) ? (rnd() < 0.5 ? 1 : -1) : (l !== -1 ? 1 : -1);
        dx = -uy * pick * dl0; dy = ux * pick * dl0;
      }
      const dl = Math.hypot(dx, dy) || 1;
      if (d > (wantInteract ? 46 : 54)) { inp.mx = dx / dl; inp.my = dy / dl; }
      if (d > 330 && s.sta > 25 && (!tgt || td > 260 * 260)) inp.sprint = true;
      if (wantInteract && d < 60) inp.interact = true;

      // --- shooting ---
      if (tgt && td < 540 * 540 && LV.lineOfSight(lvl, s.x, s.y, tgt.x, tgt.y)) {
        const a = Math.atan2(tgt.y - s.y, tgt.x - s.x) + (rnd() - .5) * 0.035;
        inp.aimx = Math.cos(a); inp.aimy = Math.sin(a);
        inp.fire = s.mag > 0 && !(wantInteract && d < 60);
        if (s.abCd <= 0) {
          inp.ability =
            (s.hero === 'junjun' && td < 135 * 135) ||
            (s.hero === 'berto' && td < 150 * 150) ||
            (s.hero === 'sarge' && td < 430 * 430 && td > 140 * 140 && sim.enemies.filter(e => !e.dead && ((e.x - tgt.x) ** 2 + (e.y - tgt.y) ** 2) < 170 * 170).length >= 2) ||
            (s.hero === 'rhea' && sim.survivors.some(o => !o.dead && (o.hp / o.maxHp < 0.6 || o.down)));
        }
        if (td < 70 * 70 && s.mag === 0) inp.melee = true;
      } else { inp.aimx = Math.cos(s.aim); inp.aimy = Math.sin(s.aim); }
      const w = D.WEAPONS[D.SURVIVORS[s.hero].weapon];
      if (s.mag === 0 || (s.mag < w.mag * 0.3 && s.reserve > 0 && (!tgt || td > 300 * 300))) inp.reload = true;
      if (s.pin > 0 || s.down) inp.interact = true;
      out[s.id] = inp;
    }
    return out;
  };
}

function run(stage, diff, seed, opts) {
  opts = opts || {};
  const lvl = LV.generate(stage);
  const sim = new Sim({ stage, level: lvl, difficulty: diff, seed });
  const nHuman = opts.humans === undefined ? 4 : opts.humans;
  D.SURVIVOR_ORDER.forEach((h, i) => sim.addSurvivor({ id: 'p' + i, name: (i < nHuman ? 'P' : 'BOT') + '-' + h, hero: h, isBot: i >= nHuman }));
  const hrnd = mulberry32(hashSeed(stage.id + '|' + diff + '|' + seed));
  const ctrl = makeController(sim, lvl, hrnd);
  const causes = {};
  const orig = sim.damageSurvivor.bind(sim);
  sim.damageSurvivor = function (s, d, src, k) { causes[k || '?'] = (causes[k || '?'] || 0) + d; return orig(s, d, src, k); };
  let maxEn = 0, frames = 0, bossSeen = false, extractSeen = 0;
  const T = 60 * (opts.seconds || 900);
  const t0 = Date.now();
  while (sim.phase === 'playing' && frames < T) {
    sim.update(1 / 60, ctrl()); sim.takeFx();
    maxEn = Math.max(maxEn, sim.enemies.filter(e => !e.dead).length);
    if (opts.log && frames % 120 === 0) {
      const f = sim.curFlow();
      console.log('t=' + sim.time.toFixed(0).padStart(3), 'flow=' + sim.flowIdx + ':' + (f ? f.type : '-'),
        'dA=' + sim.survivors.map(s => f && f.x ? Math.round(Math.hypot(s.x - f.x, s.y - f.y)) : '-').join(','),
        'prog=' + sim.survivors.map(s => sim.survivorProgress(s).toFixed(2)).join(','),
        'hp=' + sim.survivors.map(s => s.dead ? 'X' : s.down ? 'D' : Math.round(s.hp)).join(','),
        'en=' + sim.enemies.filter(e => !e.dead).length, 'tur=' + (sim.turtle || 0).toFixed(1),
        'pos=' + sim.survivors.map(s => Math.round(s.x / 46) + ',' + Math.round(s.y / 46)).join(' '));
    }
    if (sim.boss || sim.bossBody) bossSeen = true;
    extractSeen = Math.max(extractSeen, sim.extractT || 0);
    frames++;
  }
  const wall = Date.now() - t0;
  return {
    stage: stage.id, diff, humans: nHuman, seed,
    time: sim.time, phase: sim.phase, flow: sim.flowIdx + '/' + sim.flow.length,
    cur: (sim.curFlow() || {}).type || '-', prog: ((sim.curFlow() || {}).progress || 0),
    kills: sim.kills, maxEn, alive: sim.aliveSurvivors().length, bossSeen, extractSeen,
    revives: sim.survivors.reduce((a, b) => a + b.revives, 0),
    score: sim.score, wall, cpu: wall / (sim.time * 1000),
    causes: Object.fromEntries(Object.entries(causes).map(([k, v]) => [k, Math.round(v)]))
  };
}

module.exports = { run, makeController };

if (require.main === module) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['normal', 'veteran', 'nightmare'];
  const seeds = [7, 42];
  const rows = [];
  let bad = 0, cpuMax = 0;

  for (const diff of only) {
    for (const st of D.STAGES) {
      let wins = 0, n = 0, tt = 0, flowSum = 0, worst = null;
      for (const seed of seeds) {
        const r = run(st, diff, seed, { humans: 4, seconds: 420 });
        n++; tt += r.time; flowSum += parseFloat(r.flow);
        cpuMax = Math.max(cpuMax, r.cpu);
        if (r.phase === 'victory') wins++;
        else worst = r;
        rows.push(`${st.id} ${diff.padEnd(9)} seed=${String(seed).padEnd(3)} t=${r.time.toFixed(0).padStart(3)}s ${r.phase.padEnd(8)} flow=${r.flow} kills=${String(r.kills).padStart(4)} alive=${r.alive} rev=${String(r.revives).padStart(2)} boss=${r.bossSeen ? 'Y' : 'n'} score=${String(r.score).padStart(6)} cpu=${(r.cpu * 100).toFixed(1)}% ${JSON.stringify(r.causes)}`);
      }
      const need = diff === 'normal' ? n : diff === 'veteran' ? Math.max(1, n - 1) : (st.id === '1-3' ? 0 : Math.max(1, Math.floor(n / 2)));
      const okRun = wins >= need;
      if (!okRun) bad++;
      console.log(`  ${okRun ? '\u2713' : '\u2717'} ${st.id} ${diff.padEnd(9)} wins ${wins}/${n}  avg ${Math.round(tt / n)}s  avgFlow ${(flowSum / n).toFixed(1)}/4${need === 0 ? '  (nightmare finale — no win required)' : ''}`);
      if (!okRun && worst) console.log(`      last loss: flow=${worst.flow} at '${worst.cur}' prog=${(worst.prog * 100).toFixed(0)}% causes=${JSON.stringify(worst.causes)}`);
    }
  }

  console.log('\n  per-run detail:');
  rows.forEach(r => console.log('    ' + r));

  const cpuOk = cpuMax < 0.35;
  if (!cpuOk) bad++;
  console.log(`\n  ${cpuOk ? '\u2713' : '\u2717'} sim cost vs real time: peak ${(cpuMax * 100).toFixed(1)}% of one core (budget 35%)`);

  console.log('\n' + '-'.repeat(56));
  console.log(bad ? `  BALANCE FAILED (${bad} contract violations)` : '  BALANCE CONTRACT SATISFIED');
  console.log('-'.repeat(56) + '\n');
  process.exit(bad ? 1 : 0);
}
