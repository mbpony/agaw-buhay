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
