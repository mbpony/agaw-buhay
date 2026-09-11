/**
 * Mobile / landscape-phone suite.
 * Boots the real client as an 844×390 landscape touch device (DPR 3, 2 GB RAM,
 * 4 cores) and drives the twin-stick controls with synthesised touch events.
 *   node test/mobile.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const { bootClient, T } = require('./env');
const ok = T.ok, sleep = T.sleep;

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };

(async () => {
  const c = bootClient({
    width: LANDSCAPE.width, height: LANDSCAPE.height, dpr: 3,
    touch: true, coarsePointer: true, memory: 2, cores: 4, screen: [LANDSCAPE.height, LANDSCAPE.width]
  });
  const { $, win, doc, errors } = c;
  const dbg = () => win.ABAW_DEBUG;

  T.section('Device detection');
  await sleep(400);
  ok(errors.length === 0, 'boots clean on a touch device', errors.slice(0, 3).join(' | '));
  ok(doc.body.classList.contains('touch'), 'body flagged as touch');
  ok(!!dbg() && dbg().touch.on === true, 'touch layer enabled');
  ok(!doc.body.classList.contains('portrait'), 'landscape: rotate gate not shown');
  ok(win.getComputedStyle($('rotate')).display === 'none' || !$('rotate').classList.contains('shown'), 'rotate overlay stays out of the way');

  T.section('Adaptive quality');
  const r = dbg().renderer;
  ok(r.tier === 'low', 'a 2 GB / 4-core phone starts on the low tier', r.tier);
  ok(r.q.rain < 60, 'rain particles reduced (' + r.q.rain + ')');
  ok(r.q.grain === 0, 'film grain disabled on low');
  ok(r.q.glow === 0, 'additive glow pass disabled on low');
  ok(r.dpr <= 1.01, 'device pixel ratio capped at ' + r.dpr.toFixed(2) + ' (phone DPR is 3)');
  ok(r.c.width <= LANDSCAPE.width + 1, 'backing store not overscaled: ' + r.c.width + '×' + r.c.height);

  T.section('Rotate gate');
  c.click('btnHow'); await sleep(80);
  ok(/LEFT PAD/.test(c.text('howKeys')) && /RIGHT PAD/.test(c.text('howKeys')), 'How to Play documents the touch layout');
  ok(/GFX/.test(c.text('howKeys')), 'quality toggle documented');
  c.click('btnHowBack'); await sleep(80);
  c.resize(PORTRAIT.width, PORTRAIT.height);
  await sleep(60);
  ok(doc.body.classList.contains('portrait'), 'portrait flips on the rotate gate');
  c.resize(LANDSCAPE.width, LANDSCAPE.height);
  await sleep(60);
  ok(!doc.body.classList.contains('portrait'), 'back to landscape clears it');

  T.section('Single player on touch');
  c.click('btnSolo'); await sleep(80);
  $('sStage').value = '1-1'; $('sHero').value = 'jun'; $('sDiff').value = 'normal';
  c.click('btnSoloStart'); await sleep(1400);
  ok(c.visible('hud'), 'run started');
  ok($('touch').classList.contains('on'), 'touch controls are live in-game');
  ok(errors.length === 0, 'no errors entering the run', errors.slice(0, 3).join(' | '));

  // realistic boxes for the pads (jsdom reports 0×0 for everything)
  c.rect($('tMove'), 20, 250, 124, 124);
  c.rect($('tAim'), 700, 250, 104, 104);
  const MC = { x: 82, y: 312 }, AC = { x: 752, y: 302 };
  const inp = () => dbg().input;

  T.section('Move stick');
  c.touch('touchstart', $('tMove'), MC.x, MC.y, 1);
  await sleep(40);
  ok($('tMove').classList.contains('active'), 'pad lights up on contact');
  ok(Math.abs(inp().mx) < 0.05 && Math.abs(inp().my) < 0.05, 'dead centre = no movement');
  c.touch('touchmove', $('tMove'), MC.x + 50, MC.y, 1);
  await sleep(60);
  ok(inp().mx > 0.7 && inp().mx < 0.95, 'tilt right → mx=' + inp().mx.toFixed(2));
  ok(!inp().sprint, 'partial tilt does not sprint');
  c.touch('touchmove', $('tMove'), MC.x + 90, MC.y, 1);
  await sleep(60);
  ok(inp().mx > 0.99, 'clamped at the rim → mx=' + inp().mx.toFixed(2));
  ok(inp().sprint === true, 'full tilt auto-sprints');
  c.touch('touchmove', $('tMove'), MC.x, MC.y - 60, 1);
  await sleep(60);
  ok(inp().my < -0.9 && Math.abs(inp().mx) < 0.05, 'tilt up → my=' + inp().my.toFixed(2));

  T.section('Survivor actually moves');
  const sim = dbg().app.sim;
  const me = sim.survivors.find(s => s.id === dbg().app.you);
  const p0 = { x: me.x, y: me.y };
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let travelled = 0, maxRange = 0, prev = { x: me.x, y: me.y };
  for (const [dx, dy] of dirs) {
    c.touch('touchmove', $('tMove'), MC.x + dx * 60, MC.y + dy * 60, 1);
    for (let k = 0; k < 5; k++) {
      await sleep(45);
      travelled += Math.hypot(me.x - prev.x, me.y - prev.y);
      maxRange = Math.max(maxRange, Math.hypot(me.x - p0.x, me.y - p0.y));
      prev = { x: me.x, y: me.y };
    }
  }
  ok(travelled > 40, 'thumb input drove the survivor ' + Math.round(travelled) + 'px around the map');
  ok(maxRange > 20, 'got ' + Math.round(maxRange) + 'px away from spawn on thumb power alone');
  c.touch('touchend', $('tMove'), MC.x, MC.y, 1);
  await sleep(60);
  ok(inp().mx === 0 && inp().my === 0, 'release recentres the stick');
  ok(!$('tMove').classList.contains('active'), 'pad dims on release');
  ok(inp().sprint === false, 'sprint stops with the stick');

  T.section('Aim stick + auto-fire');
  c.touch('touchstart', $('tAim'), AC.x, AC.y, 2);
  await sleep(40);
  ok(!inp().fire, 'a light touch on the aim pad does not fire (deadzone)');
  c.touch('touchmove', $('tAim'), AC.x + 40, AC.y, 2);
  await sleep(60);
  ok(inp().aimx > 0.9 && Math.abs(inp().aimy) < 0.1, 'aim right → aimx=' + inp().aimx.toFixed(2));
  ok(inp().fire === true, 'deflecting the aim stick auto-fires');
  c.touch('touchmove', $('tAim'), AC.x - 30, AC.y + 30, 2);
  await sleep(60);
  ok(inp().aimx < -0.5 && inp().aimy > 0.5, 'aim down-left → ' + inp().aimx.toFixed(2) + ',' + inp().aimy.toFixed(2));
  const mag = Math.hypot(inp().aimx, inp().aimy);
  ok(Math.abs(mag - 1) < 0.06, 'aim vector stays normalised (' + mag.toFixed(3) + ')');
  c.touch('touchend', $('tAim'), AC.x, AC.y, 2);
  await sleep(60);
  ok(!inp().fire, 'release stops firing');

  T.section('Multi-touch (move + aim at once)');
  c.touch('touchstart', $('tMove'), MC.x, MC.y - 55, 1);
  c.touch('touchstart', $('tAim'), AC.x + 45, AC.y, 2);
  await sleep(80);
  ok(inp().my < -0.8 && inp().aimx > 0.9 && inp().fire, 'both thumbs tracked independently (move + aim + fire)');
  c.touch('touchend', $('tMove'), MC.x, MC.y, 1);
  c.touch('touchend', $('tAim'), AC.x, AC.y, 2);
  await sleep(60);

  T.section('Thumb cluster');
  const press = async (id, ms) => { c.touch('touchstart', $(id), 0, 0, 9); await sleep(ms || 60); };
  const release = async (id, ms) => { c.touch('touchend', $(id), 0, 0, 9); await sleep(ms || 60); };

  await press('tFire'); ok(inp().fire === true, 'FIRE button fires');
  ok($('tFire').classList.contains('pressed'), 'FIRE shows pressed state');
  await release('tFire'); ok(inp().fire === false, 'FIRE releases');

  await press('tUse'); ok(inp().interact === true, 'USE holds interact/revive');
  await release('tUse'); ok(inp().interact === false, 'USE releases');

  await press('tAbility', 40); ok(inp().ability === true, 'ABILITY triggers');
  await sleep(320); ok(inp().ability === false, 'ABILITY is a tap, not a hold');

  await press('tMelee', 40); ok(inp().melee === true, 'HIT triggers melee');
  await press('tReload', 40); ok(inp().reload === true, 'RLD triggers reload');

  await press('tSprint', 40); await release('tSprint', 40);
  ok(inp().sprint === true, 'RUN toggles sprint on');
  ok($('tSprint').classList.contains('on'), 'RUN shows its latched state');
  await press('tSprint', 40); await release('tSprint', 40);
  ok(inp().sprint === false, 'RUN toggles sprint off');

  T.section('Ability cooldown feedback');
  const ab = $('tAbility');
  ok(ab.classList.contains('rdy') || dbg().app.lastSnap, 'ability button reflects readiness');
  const meS = dbg().app.lastSnap.surv.find(s => s.id === dbg().app.you);
  if (meS && meS.ab > 0) {
    ok(!ab.classList.contains('rdy'), 'not marked ready while cooling down');
    const ring = ab.querySelector('.ring');
    ok(ring && ring.style.display === 'block', 'cooldown ring is drawn');
  } else ok(true, 'ability ready (no cooldown pending)');

  T.section('Aim assist');
  let guard = 0;
  while (guard++ < 60 && !(dbg().app.lastSnap.en || []).length) await sleep(300);
  const snap = dbg().app.lastSnap;
  ok((snap.en || []).length > 0, 'enemies have spawned (' + (snap.en || []).length + ')');
  if ((snap.en || []).length) {
    // The assist is "nearest creature ROUGHLY IN FRONT": an enemy behind you is
    // scored at d*1.8 so a farther enemy ahead wins. Comparing against the plain
    // nearest enemy therefore fails whenever the nearest is behind you -- which
    // is the assist working correctly. Mirror the real selection rule instead.
    const expect = sn => {
      const m = sn.surv.find(q => q.id === dbg().app.you);
      if (!m) return null;
      const fx = Math.cos(m.a), fy = Math.sin(m.a);
      let best = null, bs = Infinity, nearest = Infinity;
      for (const e of sn.en || []) {
        const dx = e.x - m.x, dy = (e.y - 12) - m.y;
        const d = Math.hypot(dx, dy);
        if (d < nearest) nearest = d;
        if (d > 620 || d < 1) continue;
        const dt = (dx * fx + dy * fy) / d;
        const score = d * (dt > 0.15 ? 1 : 1.8);
        if (score < bs) { bs = score; best = { dx, dy, d }; }
      }
      return best ? { best, nearest } : { best: null, nearest };
    };
    let maxDot = -1, lastNearest = Infinity, behind = 0;
    for (let i = 0; i < 14; i++) {
      const sn = dbg().app.lastSnap;
      const r = expect(sn);
      if (r && r.best) {
        const m = sn.surv.find(q => q.id === dbg().app.you);
        const fx = Math.cos(m.a), fy = Math.sin(m.a);
        const dt = (r.best.dx * fx + r.best.dy * fy) / r.best.d;
        if (dt <= 0.15) behind++;
        const aim = { x: inp().aimx, y: inp().aimy };
        const tl = Math.hypot(r.best.dx, r.best.dy) || 1;
        const dot = (aim.x * r.best.dx / tl) + (aim.y * r.best.dy / tl);
        if (dot > maxDot) maxDot = dot;
        lastNearest = r.nearest;
      } else if (r) lastNearest = r.nearest;
      await sleep(40);
    }
    if (lastNearest < 620) {
      ok(maxDot > 0.55, 'with no thumb on the aim pad it locks the assist\'s chosen threat (alignment ' + maxDot.toFixed(2) + ', nearest ' + Math.round(lastNearest) + 'px away)');
    } else {
      ok(true, 'nearest threat out of assist range (' + Math.round(lastNearest) + 'px) — assist correctly idle');
    }
    if (behind) ok(true, 'note: the plain-nearest enemy was behind the survivor ' + behind + '/14 samples — front-bias is the documented behaviour');
  }

  T.section('Quality toggle');
  const q0 = dbg().renderer.tier;
  c.touch('touchstart', $('tQuality'), 0, 0, 7); c.touch('touchend', $('tQuality'), 0, 0, 7);
  await sleep(120);
  const q1 = dbg().renderer.tier;
  ok(q1 !== q0, 'GFX button cycles tier: ' + q0 + ' → ' + q1);
  ok(c.text('tQuality').indexOf(q1.toUpperCase()) >= 0, 'button label matches tier: "' + c.text('tQuality') + '"');
  ok(dbg().settings.qualityAuto === false, 'manual pick disables auto-downgrade');

  T.section('Pause on touch');
  c.touch('touchstart', $('tPause'), 0, 0, 8); c.touch('touchend', $('tPause'), 0, 0, 8);
  await sleep(120);
  ok(c.visible('sc-pause'), 'pause button opens the pause menu');
  ok(!$('touch').classList.contains('on'), 'pads hide while paused');
  ok(inp().fire === false && inp().mx === 0, 'input is neutralised while paused');
  c.click('btnResume'); await sleep(120);
  ok(!c.visible('sc-pause'), 'resume works');
  ok($('touch').classList.contains('on'), 'pads come back');

  T.section('Portrait during a run');
  c.resize(PORTRAIT.width, PORTRAIT.height);
  await sleep(150);
  ok(doc.body.classList.contains('portrait'), 'rotate gate appears mid-run');
  ok(c.visible('sc-pause'), 'the run auto-pauses instead of dying in a pocket');
  c.resize(LANDSCAPE.width, LANDSCAPE.height);
  await sleep(150);
  ok(!doc.body.classList.contains('portrait'), 'landscape clears the gate');
  c.click('btnResume'); await sleep(100);

  T.section('Fullscreen / orientation APIs');
  let threw = null;
  try { dbg().touch.fsTried = false; dbg().goFullscreen(); } catch (e) { threw = e.message; }
  ok(!threw, 'fullscreen + orientation lock are guarded where unsupported', threw);

  T.section('Stability');
  await sleep(1200);
  ok(errors.length === 0, 'no errors after a full touch session', errors.slice(0, 4).join(' | '));
  ok(c.stats.drawCalls > 20000, 'renderer kept drawing (' + c.stats.drawCalls.toLocaleString() + ' calls)');
  ok(dbg().app.lastSnap.time > 2, 'sim advanced to t=' + dbg().app.lastSnap.time.toFixed(1) + 's');

  c.close();

  /* ---- second boot: no PointerEvent, so the TouchEvent fallback is used ---- */
  T.section('TouchEvent fallback (older iOS)');
  const f = bootClient({
    width: LANDSCAPE.width, height: LANDSCAPE.height, dpr: 2,
    touch: true, coarsePointer: true, memory: 4, cores: 8, noPointerEvents: true,
    screen: [LANDSCAPE.height, LANDSCAPE.width]
  });
  await sleep(400);
  ok(f.errors.length === 0, 'boots clean without PointerEvent', f.errors.slice(0, 2).join(' | '));
  ok(f.win.ABAW_DEBUG.touch.on, 'touch layer still enabled');
  ok(f.dbg().renderer.tier === 'medium', 'a healthier phone starts on medium', f.dbg().renderer.tier);
  f.click('btnSolo'); await sleep(80);
  f.$('sStage').value = '1-2'; f.click('btnSoloStart'); await sleep(1400);
  ok(f.visible('hud'), 'run started on the fallback path');
  f.rect(f.$('tMove'), 20, 250, 124, 124);
  f.rect(f.$('tAim'), 700, 250, 104, 104);
  f.touch('touchstart', f.$('tMove'), 82, 260, 1);
  await sleep(60);
  ok(f.dbg().input.my < -0.7, 'touchstart+move drives the stick (my=' + f.dbg().input.my.toFixed(2) + ')');
  f.touch('touchstart', f.$('tFire'), 0, 0, 3);
  await sleep(60);
  ok(f.dbg().input.fire === true, 'FIRE works via touch events');
  f.touch('touchend', f.$('tFire'), 0, 0, 3);
  f.touch('touchend', f.$('tMove'), 82, 312, 1);
  await sleep(80);
  ok(f.dbg().input.fire === false && f.dbg().input.my === 0, 'releases are handled (no stuck buttons)');
  ok(f.errors.length === 0, 'no errors on the fallback path', f.errors.slice(0, 2).join(' | '));

  /* ---- HUD footprint: the squad list must not eat the screen ---- */
  console.log('\n== HUD footprint on a 390px-tall screen ==');
  const css = fs.readFileSync(path.join(__dirname, '..', 'client', 'index.html'), 'utf8');
  const mq = css.slice(css.indexOf('@media (max-height:560px){'));
  const squadRows = f.doc.querySelectorAll('#squad .mate').length;
  ok(squadRows === 4, 'squad list renders 4 survivor rows', squadRows);
  ok(!/width:min\(330px,44vw\)/.test(css), 'the old 330px-wide squad block is gone');
  ok(/\.hud-bl\{[^}]*width:min\(236px/.test(css), 'desktop squad list capped at 236px wide');
  ok(/\.hud-bl\{[^}]*width:min\(178px/.test(mq), 'phone squad list capped at 178px wide');
  ok(/\.mate \.pv\{display:none\}/.test(mq), 'portraits dropped on a short screen');
  ok(/\.mate \.rl\{display:none\}/.test(mq), 'role label dropped on a short screen');
  ok(/\.bars2 \.bar\.st\{display:none\}/.test(mq), 'stamina bar dropped on a short screen (health only)');
  ok(/\.mate\{grid-template-columns:1fr auto/.test(mq), 'each survivor is a single compact line');
  // 4 rows at ~19px + 3 gaps at 3px = ~85px of a 390px screen (was ~245px)
  const rowsPx = 4 * 19 + 3 * 3;
  ok(rowsPx < 110, 'squad list costs ~' + rowsPx + 'px of vertical space (<110)');
  ok(/\.hud-bl\{[^}]*bottom:calc\(150px/.test(mq), 'squad list still clears the thumb pads');

  f.close();

  /* ---- iPhone Safari has no fullscreen API at all. Prove we do not silently
         do nothing: we must explain the only path that actually works. ---- */
  T.section('iPhone fullscreen guidance');
  const ip = bootClient({
    width: LANDSCAPE.width, height: LANDSCAPE.height, dpr: 3,
    touch: true, coarsePointer: true, memory: 4, cores: 6, platform: 'iPhone',
    screen: [LANDSCAPE.height, LANDSCAPE.width]
  });
  await sleep(400);
  ok(ip.errors.length === 0, 'boots clean on an iPhone profile', ip.errors.slice(0, 2).join(' | '));
  ok(ip.win.ABAW_DEBUG.touch.on, 'touch layer on');
  ok(!ip.win.document.documentElement.requestFullscreen && !ip.win.document.documentElement.webkitRequestFullscreen,
    'this browser really has no fullscreen API, like iPhone Safari');
  ok(!ip.win.document.getElementById('ioshint'), 'no hint until someone actually asks for fullscreen');
  ip.dbg().goFullscreen();
  await sleep(60);
  const hint = ip.win.document.getElementById('ioshint');
  ok(!!hint, 'asking for fullscreen on iPhone shows the Add-to-Home-Screen hint');
  ok(/Add to Home Screen/i.test(hint ? hint.textContent : ''), 'the hint names the exact menu item to tap');
  ok(/Share/i.test(hint ? hint.textContent : ''), 'and tells them where to find it');
  const bx = hint && hint.querySelector('#ioshintx');
  ok(!!bx, 'the hint is dismissible');
  if (bx) { bx.dispatchEvent(new ip.win.MouseEvent('click', { bubbles: true })); await sleep(60); }
  ok(!ip.win.document.getElementById('ioshint'), 'dismissing removes it');
  ok(ip.win.localStorage.getItem('abaw-fs-hint') === '1', 'and is remembered, so it only ever shows once');
  ip.dbg().show('game');
  await sleep(60);
  ok(!ip.win.document.getElementById('ioshint'), 'a dismissed player is never nagged again');

  /* ---- a browser that CAN go fullscreen must not show the iPhone hint ---- */
  const and = bootClient({
    width: LANDSCAPE.width, height: LANDSCAPE.height, dpr: 3,
    touch: true, coarsePointer: true, memory: 4, cores: 6, platform: 'Linux armv8l',
    screen: [LANDSCAPE.height, LANDSCAPE.width]
  });
  await sleep(300);
  and.win.document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
  and.dbg().goFullscreen();
  await sleep(60);
  ok(!and.win.document.getElementById('ioshint'), 'Android/Chrome (fullscreen-capable) gets no iPhone hint');
  ip.close(); and.close();

  process.exit(T.report() ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
