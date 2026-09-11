/**
 * Phase 2 netcode unit tests — the client-side prediction integrator
 * (client/predict.js) must agree with the authoritative sim tick-for-tick, and
 * replay() must reconstruct the sim's own trajectory from an old position plus
 * the un-acknowledged inputs. Pure sim-level: no DOM, no sockets.
 *   node test/predict.js
 */
'use strict';
const D = require('../core/data.js');
const LV = require('../core/level.js');
const { Sim } = require('../core/sim.js');
const PK = require('../client/predict.js');

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  -> ' + extra : '')); }
};
const TICK = 1 / 60;

const mkSim = (stageId, seed) => {
  const sim = new Sim({ stage: D.stageById(stageId), difficulty: 'normal', seed: seed || 1234 });
  ['berto', 'rhea', 'junjun', 'sarge'].forEach((h, i) =>
    sim.addSurvivor({ id: i === 0 ? 'p1' : 'b' + i, name: D.SURVIVORS[h].name, hero: h, isBot: i !== 0 }));
  return sim;
};
const speedOf = s => D.SURVIVORS[s.hero].stats.speed;

console.log('== Prediction mirrors the authoritative sim ==');
{
  const sim = mkSim('1-1', 777);
  sim.enemies.length = 0;                       // isolate movement from combat knockback
  const s0 = sim.survivors[0];
  const sample = { mx: 0.7, my: -0.7, sprint: false };
  const st = { x: s0.x, y: s0.y, vx: 0, vy: 0 };
  let maxErr = 0;
  for (let i = 0; i < 120; i++) {
    sim.update(TICK, { p1: Object.assign({ aimx: 1, aimy: 0 }, sample) });
    PK.step(LV, sim.level, st, sample, speedOf(s0), TICK);
    maxErr = Math.max(maxErr, Math.hypot(st.x - s0.x, st.y - s0.y));
  }
  ok(maxErr < 2, '120 ticks of held movement stay within 2px of the sim (max ' + maxErr.toFixed(2) + 'px)', maxErr.toFixed(2));
  ok(sim.survivors[0].moving > 0.5, 'sanity: the survivor actually moved');
}
{
  const sim = mkSim('1-1', 778);
  sim.enemies.length = 0;
  const s0 = sim.survivors[0];
  const st = { x: s0.x, y: s0.y, vx: 0, vy: 0 };
  const mv = { mx: 1, my: 0.2, sprint: true };
  for (let i = 0; i < 30; i++) { sim.update(TICK, { p1: mv }); PK.step(LV, sim.level, st, mv, speedOf(s0), TICK); }
  let maxErr = 0;
  for (let i = 0; i < 40; i++) {                 // stick released: vx *= 0.72 slide must match
    sim.update(TICK, { p1: {} });
    PK.step(LV, sim.level, st, {}, speedOf(s0), TICK);
    maxErr = Math.max(maxErr, Math.hypot(st.x - s0.x, st.y - s0.y));
  }
  ok(maxErr < 2, 'sprint mult + idle decay (vx *= 0.72) match the sim (max ' + maxErr.toFixed(2) + 'px)', maxErr.toFixed(2));
}
{
  const sim = mkSim('1-1', 780);
  sim.enemies.length = 0;
  const L = sim.level, s0 = sim.survivors[0], TS = L.tile;
  let wx = -1, wy = -1;
  for (let ty = 1; ty < L.h - 3 && wx < 0; ty++) for (let tx = 1; tx < L.w - 1; tx++) {
    if (LV.isSolid(L, tx * TS + TS / 2, ty * TS + TS / 2) &&
      !LV.isSolid(L, tx * TS + TS / 2, (ty + 1) * TS + TS / 2) &&
      !LV.isSolid(L, tx * TS + TS / 2, (ty + 2) * TS + TS / 2)) { wx = tx * TS + TS / 2; wy = (ty + 1) * TS + TS / 2; break; }
  }
  ok(wx > 0, 'found a wall face to rub against');
  s0.x = wx; s0.y = wy + 30;
  const st = { x: s0.x, y: s0.y, vx: 0, vy: 0 };
  const mv = { mx: 0.35, my: -1 };               // grind into the wall while strafing
  let maxErr = 0;
  for (let i = 0; i < 90; i++) {
    sim.update(TICK, { p1: mv });
    PK.step(LV, L, st, mv, speedOf(s0), TICK);
    maxErr = Math.max(maxErr, Math.hypot(st.x - s0.x, st.y - s0.y));
  }
  ok(maxErr < 2, 'axis-separated wall slide + bounce stay within 2px (max ' + maxErr.toFixed(2) + 'px)', maxErr.toFixed(2));
}

console.log('\n== Replay reconstructs the trajectory from an old snapshot ==');
{
  const sim = mkSim('1-1', 779);
  sim.enemies.length = 0;
  const s0 = sim.survivors[0];
  const script = [
    { mx: 1, my: 0, n: 20 }, { mx: 0.4, my: -0.9, n: 20 }, { mx: -0.5, my: 0.5, n: 20 },
    { mx: 0, my: 0, n: 10 }, { mx: 0.2, my: 1, n: 20, sprint: true }
  ];
  const samples = [];
  let snapPos = null;
  for (let g = 0; g < script.length; g++) {
    const seg = script[g];
    const sample = { mx: seg.mx, my: seg.my, sprint: !!seg.sprint, hold: seg.n * TICK, seq: g + 1 };
    for (let i = 0; i < seg.n; i++) sim.update(TICK, { p1: sample });
    if (g === 1) snapPos = { x: s0.x, y: s0.y };      // "snapshot" taken here (server acked seq 2)
    samples.push(sample);
  }
  ok(!!snapPos, 'snapshot position captured mid-run');
  const rep = PK.replay(LV, sim.level, snapPos, samples.slice(2), speedOf(s0));
  const err = Math.hypot(rep.x - s0.x, rep.y - s0.y);
  ok(err < 2.5, 'replaying un-acked inputs lands within 2.5px of the sim (' + err.toFixed(2) + 'px)', err.toFixed(2));

  // a stale ack (server already consumed sample 3 too) must still converge
  const rep2 = PK.replay(LV, sim.level, snapPos, samples.slice(3), speedOf(s0));
  const err2 = Math.hypot(rep2.x - s0.x, rep2.y - s0.y);
  ok(err2 > err, 'dropping an acked sample from the replay diverges (proof seqs matter): ' + err2.toFixed(1) + 'px vs ' + err.toFixed(2) + 'px');
}

console.log('\n== Reconcile offset maths ==');
{
  // the decaying-offset smoothing must converge: err folded into predOff shrinks exp(-12dt)
  let off = 40;
  for (let i = 0; i < 30; i++) off *= Math.exp(-12 * (1 / 60));
  ok(off < 0.2, 'a 40px correction offset decays below 0.2px in half a second (' + off.toFixed(3) + 'px)', off.toFixed(3));
  ok(typeof PK.vel === 'function' && typeof PK.step === 'function' && typeof PK.replay === 'function', 'predict.js exports vel/step/replay');
}

console.log('\n' + (fail ? 'PREDICTION SUITE FAILED' : 'PREDICTION SUITE OK') + ' — pass ' + pass + ' fail ' + fail);
process.exit(fail ? 1 : 0);
