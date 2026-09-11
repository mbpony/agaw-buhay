/**
 * FP awareness tests — first person has no peripheral vision, so the game owes
 * the player: (1) directional damage cues, (2) off-view threat markers with
 * sane screen-edge geometry, (3) audio that pans by bearing relative to the
 * view yaw. Pure logic: no DOM, no sockets.
 *   node test/aware.js
 */
'use strict';
global.self = global;                       // UMD roots (same trick as fp-preview)
global.ABAW_DATA = require('../core/data.js');
global.ABAW_LEVEL = require('../core/level.js');
const { Sim } = require('../core/sim.js');
require('../client/audio.js');              // publishes self.ABAW_AUDIO (no WebAudio needed for spatial)
const AU = self.ABAW_AUDIO;
require('../client/render.js');             // reads ABAW_DATA/LEVEL/AUDIO off root at load
const Rend = self.ABAW_RENDER.Renderer;
const D = global.ABAW_DATA;

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  -> ' + extra : '')); }
};

console.log('== Damage carries its source (directional cue fuel) ==');
{
  const sim = new Sim({ stage: D.stageById('1-1'), difficulty: 'normal', seed: 5 });
  sim.addSurvivor({ id: 'p1', name: 'A', hero: 'berto' });
  const s = sim.survivors[0];
  const src = { isEnemy: true, x: s.x + 40, y: s.y + 10 };
  sim.damageSurvivor(s, 5, src, 'hit');
  const h = sim.takeFx().find(f => f.type === 'hurt');
  ok(!!h && h.id === 'p1', 'hurt fx fires for the damaged survivor');
  ok(h && Math.abs(h.sx - src.x) < 0.6 && Math.abs(h.sy - src.y) < 0.6,
    'hurt fx carries the attacker position (sx/sy)', h ? h.sx + ',' + h.sy : 'no fx');
  const sim2 = new Sim({ stage: D.stageById('1-1'), difficulty: 'normal', seed: 6 });
  sim2.addSurvivor({ id: 'p1', name: 'A', hero: 'berto' });
  sim2.damageSurvivor(sim2.survivors[0], 2, null, 'fire');   // hazard damage has no source
  const h2 = sim2.takeFx().find(f => f.type === 'hurt');
  ok(h2 && h2.sx === undefined, 'sourceless damage (fire) leaves sx undefined');
}

console.log('\n== FP audio pans by bearing, not screen space ==');
{
  AU.setListener(() => ({ fp: true, x: 0, y: 0, yaw: 0 }));
  let r = AU.spatial({ x: 200, y: 0 }, null, 800);
  ok(Math.abs(r.pan) < 0.01 && r.vol > 0.6, 'dead ahead → centre pan, loud (vol ' + r.vol.toFixed(2) + ')');
  r = AU.spatial({ x: 0, y: 200 }, null, 800);
  ok(r.pan > 0.99, '90° right → hard right pan (' + r.pan.toFixed(2) + ')');
  r = AU.spatial({ x: 0, y: -200 }, null, 800);
  ok(r.pan < -0.99, '90° left → hard left pan (' + r.pan.toFixed(2) + ')');
  r = AU.spatial({ x: -200, y: 0 }, null, 800);
  ok(Math.abs(r.pan) < 0.01, 'straight behind → centre pan (stereo limit; visuals cover rear)');
  const near = AU.spatial({ x: 100, y: 0 }, null, 800).vol;
  const far = AU.spatial({ x: 900, y: 0 }, null, 800).vol;
  ok(near > far + 0.3, 'volume falls off with distance (' + near.toFixed(2) + ' vs ' + far.toFixed(2) + ')');
  AU.setListener(() => ({ fp: true, x: 0, y: 0, yaw: Math.PI / 2 }));
  r = AU.spatial({ x: 0, y: 200 }, null, 800);
  ok(Math.abs(r.pan) < 0.01, 'turning to face a sound centres it (yaw-aware)');
  AU.setListener(() => null);
  r = AU.spatial({ x: 300, y: 0 }, { x: 0, y: 0 }, 800);
  ok(r.pan > 0.5, 'legacy screen-space panning still applies when listener opts out (' + r.pan.toFixed(2) + ')');
}

console.log('\n== Off-view threat marker geometry ==');
{
  const W = 640, H = 360, m = 26;
  let q = Rend.threatMarker(Math.PI / 2, W, H, m);
  ok(Math.abs(q.px - (W - m)) < 0.01 && Math.abs(q.py - H / 2) < 0.01 && !q.behind,
    'directly right → right edge, mid-height');
  q = Rend.threatMarker(-Math.PI / 2, W, H, m);
  ok(Math.abs(q.px - m) < 0.01 && Math.abs(q.py - H / 2) < 0.01, 'directly left → left edge, mid-height');
  q = Rend.threatMarker(Math.PI, W, H, m);
  ok(q.behind && Math.abs(q.px - W / 2) < 0.01 && Math.abs(q.py - (H - m)) < 0.01,
    'straight behind → bottom centre, flagged behind');
  q = Rend.threatMarker(Math.PI / 4, W, H, m);
  ok(!q.behind && q.px > W / 2 && q.py < H / 2, 'front-right (outside cone) → upper-right border');
  q = Rend.threatMarker(-Math.PI * 0.75, W, H, m);
  ok(q.behind && q.px < W / 2 && q.py > H / 2, 'behind-left → lower-left border, behind style');
  // markers must stay inside the safe margin for every bearing
  let inside = true;
  for (let a = 0; a < 6.28; a += 0.13) {
    const p = Rend.threatMarker(a, W, H, m);
    if (p.px < m - 0.01 || p.px > W - m + 0.01 || p.py < m - 0.01 || p.py > H - m + 0.01) inside = false;
  }
  ok(inside, 'every bearing lands on the border margin, never off-screen');
}

console.log('\n== Compass heading math ==');
{
  ok(Math.abs(Rend.degFromYaw(0) - 90) < 0.01, 'yaw 0 (world +x) reads EAST');
  ok(Math.abs(Rend.degFromYaw(Math.PI / 2) - 180) < 0.01, 'yaw +90deg reads SOUTH');
  ok(Math.abs(Rend.degFromYaw(-Math.PI / 2) - 0) < 0.01, 'yaw -90deg reads NORTH');
  ok(Rend.degFromYaw(Math.PI * 7) >= 0 && Rend.degFromYaw(Math.PI * 7) < 360, 'heading always normalised 0-360');
}

console.log('\n' + (fail ? 'AWARENESS SUITE FAILED' : 'AWARENESS SUITE OK') + ' — pass ' + pass + ' fail ' + fail);
process.exit(fail ? 1 : 0);
