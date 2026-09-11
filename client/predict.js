/* Agaw-Buhay — client-side movement prediction + reconciliation (phase 2 netcode).
   The server stays authoritative (60 Hz sim, 24 Hz snapshots). Between snapshots the
   client integrates ITS OWN movement with the exact same rules the sim uses, so the
   first-person view responds to your stick/keys on the very same frame — zero felt
   latency. When a snapshot arrives we replay the inputs the server has not confirmed
   yet on top of the authoritative position; any leftover error is folded into a
   decaying offset so corrections glide instead of popping.
   UMD: browser global ABAW_PREDICT, Node module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ABAW_PREDICT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 14;                       // survivor collision radius (Sim.moveEntity default)
  var OFF = [[-R, 0], [R, 0], [0, -R], [0, R], [-R * .7, -R * .7], [R * .7, R * .7], [-R * .7, R * .7], [R * .7, -R * .7]];
  var TICK = 1 / 60;                // server sim step — replay integrates in these slices

  /* Mirror of Sim survivor velocity: normalised input * hero speed * sprint mult. */
  function vel(sample, speed) {
    var mx = sample.mx || 0, my = sample.my || 0;
    var m0 = Math.hypot(mx, my);
    var sprint = !!sample.sprint && m0 > 0.2;
    var sp = speed * (sprint ? 1.42 : 1);
    if (m0 > 0.08) { var len = Math.max(1, m0); return [mx / len * sp, my / len * sp]; }
    return [0, 0];
  }

  function blocked(LV, L, x, y) {
    for (var i = 0; i < OFF.length; i++) if (LV.isSolid(L, x + OFF[i][0], y + OFF[i][1])) return true;
    return false;
  }

  /* One integration slice. st = {x,y,vx,vy} mutated in place, exactly like the sim:
     velocity set from input (or decayed x0.72 when idle), speedMul terrain, then
     axis-separated collision with the -0.08 bounce. */
  function step(LV, L, st, sample, speed, dt) {
    var v = vel(sample, speed);
    if (v[0] || v[1]) { st.vx = v[0]; st.vy = v[1]; }
    else { st.vx *= 0.72; st.vy *= 0.72; }
    if (!st.vx && !st.vy) return st;
    var mul = LV.speedMul ? LV.speedMul(L, st.x, st.y) : 1;
    var nx = st.x + st.vx * dt * mul, ny = st.y + st.vy * dt * mul;
    if (!blocked(LV, L, nx, st.y)) st.x = nx; else st.vx *= -0.08;
    if (!blocked(LV, L, st.x, ny)) st.y = ny; else st.vy *= -0.08;
    return st;
  }

  /* Advance a state by `secs` of one held input sample, sliced at the server tick so
     replay lines up with what the server will compute for the same inputs. */
  function advance(LV, L, st, sample, speed, secs) {
    var t = 0;
    while (t < secs - 1e-9) { var h = Math.min(TICK, secs - t); step(LV, L, st, sample, speed, h); t += h; }
    return st;
  }

  /* Rebuild the predicted position from the authoritative one: apply every input the
     server had not confirmed at snapshot time (pend, oldest first, each with the wall
     time it was held) plus the sample currently in flight. */
  function replay(LV, L, serverPos, pend, speed) {
    var st = { x: serverPos.x, y: serverPos.y, vx: 0, vy: 0 };
    for (var i = 0; i < pend.length; i++) advance(LV, L, st, pend[i], speed, pend[i].hold || 0);
    return st;
  }

  return { vel: vel, step: step, advance: advance, replay: replay, blocked: blocked, TICK: TICK };
}));
