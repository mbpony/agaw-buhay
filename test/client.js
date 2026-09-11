/**
 * Headless browser test (desktop) — boots the REAL client inside jsdom with a
 * stubbed canvas/WebAudio/WebSocket, then plays it:
 *   · offline single-player against the local sim
 *   · online co-op against the live host server
 * Mobile/landscape coverage lives in test/mobile.js.
 *   node test/client.js
 */
'use strict';
const { bootClient, T } = require('./env');
const ok = T.ok, sleep = T.sleep;

(async () => {
  const c = bootClient({ width: 1280, height: 800, dpr: 2 });
  const { $, win, doc, errors } = c;
  const drawCalls = c.stats;

  T.section('Boot');
  await sleep(500);
  ok(!!win.ABAW_DATA && !!win.ABAW_LEVEL && !!win.ABAW_SIM && !!win.ABAW_RENDER && !!win.ABAW_AUDIO, 'all five modules present on window');
  ok(errors.length === 0, 'no errors during boot', errors.slice(0, 3).join(' | '));
  ok(c.visible('sc-title'), 'title screen is showing');
  ok(!c.visible('hud'), 'HUD hidden on the title screen');
  ok($('btnSolo') && $('btnHost') && $('btnQuick') && $('btnFind'), 'GDD menu entries present (Quick Join / Host / Find Match / Single Player)');
  ok(!doc.body.classList.contains('touch'), 'desktop boot does not enable the touch layer');
  ok(win.ABAW_DEBUG.renderer.tier === 'high', 'desktop starts on the high tier');

  // The boot-error banner must stay SILENT when everything really loaded. It once
  // checked window.DATA, which nothing in the project defines, so it fired on
  // every single page load -- telling players the game had failed to start while
  // the title screen sat there working perfectly behind it.
  win.dispatchEvent(new win.Event('load'));
  await sleep(1900);
  const banner = doc.getElementById('booterr');
  ok(!banner || !banner.textContent.trim(), 'the boot-error banner stays hidden on a healthy boot',
    banner ? banner.textContent.replace(/\s+/g, ' ').slice(0, 200) : '');

  T.section('Server connection');
  await sleep(900);
  const netTxt = c.text('titleNet');
  ok(/online/i.test(netTxt), 'title screen shows co-op status: "' + netTxt + '"');
  ok($('titleNet').classList.contains('on'), 'status chip is green when connected');

  T.section('Menus');
  c.click('btnHow'); await sleep(60);
  ok(c.visible('sc-how'), 'how-to screen opens');
  ok(($('loreText') || {}).innerHTML.length > 200, 'lore text populated');
  ok(($('enemyList') || {}).children.length >= 8, 'enemy roster listed (' + $('enemyList').children.length + ')');
  ok(!/LEFT PAD/.test(($('howKeys') || {}).textContent || ''), 'How to Play shows keyboard controls on desktop (touch rows hidden)');
  c.click('btnHowBack'); await sleep(60);
  ok(c.visible('sc-title'), 'back to title');

  c.click('btnAuth'); await sleep(60);
  ok(c.visible('sc-auth'), 'auth screen (guest/OAuth) opens');
  ok($('btnGuest') && $('btnGoogle') && $('btnDiscord'), 'guest + OAuth buttons present');
  $('authName').value = 'TestPlayer';
  c.click('btnGuest'); await sleep(200);
  ok(!c.visible('sc-auth'), 'guest sign-in returns to the menu');

  T.section('Single player (local sim + 3 AI bots)');
  c.click('btnSolo'); await sleep(80);
  ok(c.visible('sc-solo'), 'solo screen opens');
  const heroOpts = $('sHero') ? $('sHero').options.length : 0;
  ok(heroOpts === 4, 'four survivors offered (GDD roster)', heroOpts);
  const names = [...($('sHero') ? $('sHero').options : [])].map(x => x.textContent).join(' / ');
  ok(/Berto/.test(names) && /Rhea/.test(names) && /Jun/.test(names) && /Sarge/.test(names), 'Berto / Rhea / Jun-Jun / Sarge all selectable');
  ok($('sStage') && $('sStage').options.length === 3, 'Act 1 has 3 stages to pick from', $('sStage').options.length);
  ok($('sDiff') && $('sDiff').options.length === 3, 'three difficulties selectable', $('sDiff').options.length);
  $('sHero').value = 'jun'; $('sStage').value = '1-3'; $('sDiff').value = 'normal';
  c.click('btnSoloStart'); await sleep(900);
  ok(c.visible('hud'), 'HUD is up');
  ok(!c.visible('sc-solo'), 'menu hidden once the run starts');
  const obj1 = c.text('objlabel');
  ok(obj1.length > 3 && obj1 !== '—', 'objective label rendered: "' + obj1 + '"');
  ok(($('squad') || {}).children.length > 0, 'squad HUD populated (' + $('squad').children.length + ' slots)');
  ok(/\d/.test(c.text('ammo')), 'ammo counter rendered: "' + c.text('ammo') + '"');
  ok(drawCalls.drawCalls > 50, 'renderer issued draw calls (' + drawCalls.drawCalls + ')');
  const t1 = c.text('timeVal');
  await sleep(1200);
  ok(t1 !== c.text('timeVal'), 'match clock is ticking (' + t1 + ' -> ' + c.text('timeVal') + ')');
  ok(errors.length === 0, 'no errors while playing solo', errors.slice(0, 3).join(' | '));

  T.section('Input');
  const canvas = $('game');
  canvas.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 300 }));
  c.key('w'); await sleep(400); c.key('w', 'keyup');
  canvas.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  await sleep(400);
  canvas.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  c.key(' '); await sleep(200);
  c.key('r'); await sleep(200);
  c.key('f'); await sleep(200);
  ok(errors.length === 0, 'WASD / aim / fire / ability / reload / melee handled', errors.slice(0, 3).join(' | '));

  T.section('Containers, loot and the loadout HUD');
  {
    const dbg = win.ABAW_DEBUG, sim = dbg.app.sim, rend = dbg.renderer;
    const me = () => sim.survivors.find(v => v.id === dbg.app.you);
    ok(sim.breaks.length > 0, 'the local sim seeded ' + sim.breaks.length + ' loot containers');
    ok(rend.breakByN && rend.breakByN.length === sim.breaks.length, 'the renderer indexed the same containers');

    // --- smash one open with the melee key ---
    const box = sim.breaks.find(b => !b.dead);
    const floorBefore = sim.items.length, iidBefore = sim._iid || 0;
    // Do NOT teleport the survivor: the camera lerps toward it, so a teleport
    // leaves the mouse-derived aim pointing the wrong way. Move the container in
    // front of the survivor instead, then aim the cursor at its true projected
    // screen position -- exactly the inverse of the client's aim maths.
    for (let i = 0; i < 16 && !box.dead; i++) {
      const sv = me();
      // 52px: inside the melee arc (58 + prop radius) but outside the 30px
      // auto-pickup radius, so a consumable drop still lands on the floor
      // instead of being instantly collected.
      box.x = sv.x + Math.cos(sv.aim) * 52; box.y = sv.y + Math.sin(sv.aim) * 52;
      const z = rend.cam.zoom * (rend.w < 700 ? 0.82 : 1);
      canvas.dispatchEvent(new win.MouseEvent('mousemove', {
        bubbles: true,
        clientX: rend.w / 2 + (box.x - rend.cam.x) * z,
        clientY: rend.h / 2 + (box.y - rend.cam.y) * z
      }));
      c.key('f'); await sleep(70); c.key('f', 'keyup'); await sleep(40);
    }
    ok(box.dead, 'melee (F) smashed the container open');
    // _iid is monotonic, so it proves a drop was created even if a survivor
    // auto-collected it; items.length proves this one stayed on the floor
    ok((sim._iid || 0) > iidBefore, 'it rolled a drop (item counter ' + iidBefore + ' -> ' + (sim._iid || 0) + ')');
    ok(sim.items.length > floorBefore, 'and that drop is lying on the floor');
    await sleep(260);
    const rb = rend.breakByN[box.n];
    ok(rb && rb.dead, 'the renderer was told the container is destroyed (snapshot bk delta)');

    // --- pick up a rifle with E ---
    const s1 = me();
    const gun = sim.spawnItem(s1.x + 8, s1.y, 'w:rifle');
    await sleep(220);
    ok(!gun.taken, 'walking over a rifle does not auto-equip it');
    c.key('e'); await sleep(200); c.key('e', 'keyup'); await sleep(260);
    ok(gun.taken && s1.alt && s1.alt.id === 'rifle', 'E picks the rifle up into slot 2');
    ok(!$('gslot2').classList.contains('empty'), 'the gear strip lights up slot 2');
    ok($('gslot2n').textContent.length > 1, 'slot 2 shows the weapon name: "' + $('gslot2n').textContent + '"');
    const wnameBefore = c.text('wname'), ammoBefore = c.text('ammo');

    // --- Q swaps, and the HUD must follow the ACTIVE gun ---
    c.key('q'); await sleep(320); c.key('q', 'keyup'); await sleep(260);
    ok(s1.wpn === 'rifle', 'Q swapped to the rifle');
    ok(c.text('wname') !== wnameBefore, 'the weapon readout changed: "' + wnameBefore + '" -> "' + c.text('wname') + '"');
    ok(c.text('wname').indexOf('Assault Rifle') === 0, 'it names the gun actually in hand');
    ok(/\d+\/\d+/.test($('gslot2a').textContent), 'slot 2 chip tracks that gun\'s own ammo: ' + $('gslot2a').textContent);
    ok($('gslot2n').textContent !== 'EMPTY', 'slot 2 now names the gun you swapped away from: ' + $('gslot2n').textContent);
    c.key('q'); await sleep(340); c.key('q', 'keyup'); await sleep(240);
    ok(s1.wpn !== 'rifle', 'Q swaps back to the hero weapon');

    // --- G throws ---
    const mol = sim.spawnItem(s1.x + 6, s1.y, 't:molotov');
    await sleep(200);
    c.key('e'); await sleep(200); c.key('e', 'keyup'); await sleep(240);
    ok(mol.taken && s1.thrKind === 'molotov' && s1.thrN === 1, 'E picks the molotov up');
    ok($('gthrown').textContent === 'x1', 'the throwable chip counts it: ' + $('gthrown').textContent);
    ok(!$('gthrow').classList.contains('empty'), 'the throwable chip is lit');
    const thrownNow = () => sim.proj.filter(q => q.thrown).length;
    const thrownBefore = thrownNow();
    c.key('g'); await sleep(180); c.key('g', 'keyup');
    ok(thrownNow() > thrownBefore, 'G threw it (' + thrownBefore + ' -> ' + thrownNow() + ' thrown projectiles in the air)');
    await sleep(120);
    ok(s1.thrN === 0, 'the stack emptied');
    await sleep(240);
    ok($('gthrow').classList.contains('empty'), 'the chip dims again when you are out');

    // --- armour ---
    const vest = sim.spawnItem(s1.x + 6, s1.y, 'armor');
    await sleep(200);
    c.key('e'); await sleep(200); c.key('e', 'keyup'); await sleep(260);
    ok(s1.armor > 0, 'E equips the kevlar vest (' + Math.round(s1.armor) + ')');
    ok(!$('garmor').classList.contains('empty') && +$('garmorn').textContent > 0, 'the vest chip shows ' + $('garmorn').textContent);
    const hp0 = s1.hp, ar0 = s1.armor;
    s1.iframe = 0; sim.damageSurvivor(s1, 30, null, 'hit');
    const eff = 30 * win.ABAW_DATA.DIFFICULTIES[dbg.app.diffId || 'normal'].dmgMul * (s1.hero === 'berto' ? 0.88 : 1);
    ok(s1.armor < ar0, 'the vest took damage instead of you (' + ar0 + ' -> ' + Math.round(s1.armor) + ')');
    ok(Math.abs((hp0 - s1.hp) - eff * 0.55) < 2, 'and soaked 45% of the hit (hp -' + (hp0 - s1.hp).toFixed(1) + ' of ' + eff.toFixed(1) + ' effective)');

    // --- how-to documents the new keys ---
    dbg.show('how');
    const how = $('howKeys').textContent;
    ok(/Q/.test(how) && /Swap weapon/i.test(how), 'How-to-Play documents Q = swap');
    ok(/G/.test(how) && /Throw/i.test(how), 'How-to-Play documents G = throw');
    dbg.show('game');
    ok(errors.length === 0, 'no errors across the whole loot flow', errors.slice(0, 3).join(' | '));
  }

  T.section('Per-player camera');
  {
    const dbg = win.ABAW_DEBUG, sim = dbg.app.sim, rend = dbg.renderer;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const alive = sim.aliveSurvivors();
    ok(alive.length >= 2, 'at least two survivors to separate (' + alive.length + ')');
    const A = alive[0], B = alive[1];

    // Drag B a long way from the rest of the squad. Two hazards when doing this
    // to a live sim: (1) the target must be walkable or the sim shoves B back,
    // and (2) bots have an anti-soft-lock recovery that teleports them to the
    // objective once stuckT passes 9 -- pinning a bot in place trips it. So find
    // real floor and hold stuckT at zero for the duration.
    let spot = null;
    for (let r = 2200; r >= 800 && !spot; r -= 150) {
      for (let k = 0; k < 32 && !spot; k++) {
        const ang = k / 32 * Math.PI * 2;
        const p = sim.findWalkable(A.x + Math.cos(ang) * r, A.y + Math.sin(ang) * r);
        if (p && Math.hypot(p.x - A.x, p.y - A.y) > 1000) spot = p;
      }
    }
    ok(!!spot, 'found walkable floor far from the squad to test separation');
    if (!spot) { rend.youId = A.id; throw new Error('no far spot'); }
    const AX = A.x, AY = A.y, BX = spot.x, BY = spot.y;
    const calm = v => { if (v.bot) { v.bot.stuckT = 0; v.bot.chkT = 0.5; } };
    const pin = async ms => { const t0 = Date.now(); while (Date.now() - t0 < ms) { A.x = AX; A.y = AY; B.x = BX; B.y = BY; calm(A); calm(B); await sleep(30); } };
    const squadCam = () => ({ x: sim.cam.x, y: sim.cam.y, z: sim.cam.zoom });

    await pin(700);
    const wasYou = rend.youId;
    rend.youId = A.id;
    await pin(600);
    const camA = { x: rend.cam.x, y: rend.cam.y, z: rend.cam.zoom };
    const posA = { x: A.x, y: A.y };

    rend.youId = B.id;
    await pin(600);
    const camB = { x: rend.cam.x, y: rend.cam.y, z: rend.cam.zoom };
    const posB = { x: B.x, y: B.y };
    const shared = squadCam();

    ok(dist(camA, posA) < 90, 'player A\'s camera sits on player A (' + Math.round(camA.x) + ',' + Math.round(camA.y) + ' vs ' + Math.round(posA.x) + ',' + Math.round(posA.y) + ')');
    ok(dist(camB, posB) < 90, 'player B\'s camera sits on player B (' + Math.round(camB.x) + ',' + Math.round(camB.y) + ' vs ' + Math.round(posB.x) + ',' + Math.round(posB.y) + ')');
    ok(dist(camA, camB) > 900, 'so the two players get genuinely different views (' + Math.round(dist(camA, camB)) + 'px apart)');
    ok(dist(camA, shared) > 200 && dist(camB, shared) > 200,
      'neither view is the shared squad centroid any more (sim cam is ' + Math.round(dist(camA, shared)) + 'px from A, ' + Math.round(dist(camB, shared)) + 'px from B)');
    ok(camA.z >= 0.95 && camB.z >= 0.95,
      'zoom stays readable when you split up (A ' + camA.z.toFixed(2) + ', B ' + camB.z.toFixed(2) + ') instead of collapsing to the shared ' + shared.z.toFixed(2));

    // the actual complaint: a player who runs off must still see themselves
    const seesSelf = (cam, p) => Math.abs(p.x - cam.x) < rend.viewW / 2 && Math.abs(p.y - cam.y) < rend.viewH / 2;
    ok(seesSelf(camB, posB), 'the player who ran far ahead can still see their own character');
    ok(seesSelf(camA, posA), 'and so can the one who stayed behind');

    // dead players should watch a living teammate rather than their own corpse
    B.hp = 0; B.dead = true; B.dd = 1;
    rend.youId = B.id;
    await sleep(700);
    const camDead = { x: rend.cam.x, y: rend.cam.y };
    ok(dist(camDead, { x: A.x, y: A.y }) < 400, 'a dead player\'s camera follows a living teammate instead of the corpse');
    B.dead = false; B.dd = 0; B.hp = B.maxHp;
    rend.youId = wasYou;
    ok(!dbg.app.errors || dbg.app.errors.length === 0, 'no errors while switching camera owners');
  }

  T.section('Pause / scoreboard / mute / settings');
  c.key('Escape'); await sleep(120);
  ok(c.visible('sc-pause'), 'Esc opens the pause menu');
  ok($('setQual') && $('setQual').options.length === 3, 'graphics quality selector in the pause menu');
  ok($('setAutoQ'), 'auto-quality toggle present');
  const tier0 = win.ABAW_DEBUG.renderer.tier;
  $('setQual').value = 'low';
  $('setQual').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(80);
  ok(win.ABAW_DEBUG.renderer.tier === 'low', 'quality selector applies (' + tier0 + ' → low)');
  $('setQual').value = tier0;
  $('setQual').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(80);
  c.click('btnResume'); await sleep(120);
  ok(!c.visible('sc-pause'), 'resume closes it');
  c.key('Tab'); await sleep(200);
  ok(c.visible('scoreboard'), 'Tab opens the scoreboard');
  ok(($('sbBody') || {}).innerHTML.length > 0, 'scoreboard rows rendered');
  c.key('Tab', 'keyup'); await sleep(120);
  ok(!c.visible('scoreboard'), 'Tab release hides it');
  c.key('m'); await sleep(120); c.key('m'); await sleep(120);
  ok(errors.length === 0, 'mute toggle is clean', errors.slice(0, 3).join(' | '));

  T.section('Quit to menu');
  c.key('Escape'); await sleep(120);
  c.click('btnQuit'); await sleep(400);
  ok(c.visible('sc-title') || c.visible('sc-solo'), 'quit returns to a menu');
  ok(!($('touch') || {}).classList.contains('on'), 'touch layer is not left on outside a run');

  T.section('Online co-op (host + live server)');
  c.click('btnHost'); await sleep(80);
  ok(c.visible('sc-host'), 'host screen opens');
  ok($('hStage') && $('hStage').options.length >= 3, 'Act 1 stages selectable (' + $('hStage').options.length + ')');
  c.click('btnCreate'); await sleep(1200);
  ok(c.visible('sc-lobby'), 'lobby screen opens after creating a session');
  const code = c.text('lbCode');
  ok(code.length >= 4, 'session code shown: ' + code);
  ok(($('playerList') || {}).children.length >= 1, 'player list rendered');
  ok(!($('btnStart') || {}).classList.contains('hidden'), 'host sees the Launch button');
  ok(doc.querySelectorAll('#heroGrid > *').length >= 4, 'survivor select grid rendered (' + doc.querySelectorAll('#heroGrid > *').length + ')');
  c.click('btnStart'); await sleep(1600);
  ok(c.visible('hud'), 'match started — HUD is up');
  const sess = c.text('sessVal');
  ok(sess && sess !== 'SOLO', 'session indicator shows co-op: "' + sess + '"');
  const objNet = c.text('objlabel');
  ok(objNet.length > 3 && objNet !== '—', 'networked objective rendered: "' + objNet + '"');
  await sleep(1500);
  ok(($('squad') || {}).children.length === 4, 'squad HUD shows all four survivors', $('squad').children.length);
  ok(errors.length === 0, 'no errors during networked play', errors.slice(0, 4).join(' | '));
  ok(/\d/.test(c.text('pingVal')), 'ping readout working: "' + c.text('pingVal') + '"');

  T.section('Chat');
  c.key('t'); await sleep(120);
  const chatOpen = $('chatinput') && !$('chatinput').classList.contains('hidden');
  ok(chatOpen, 'T opens squad chat');
  if (chatOpen) {
    $('chatinput').value = 'ingat kayo';
    $('chatinput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(400);
    ok(errors.length === 0, 'chat send handled', errors.slice(0, 2).join(' | '));
  }

  c.close();
  process.exit(T.report() ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
