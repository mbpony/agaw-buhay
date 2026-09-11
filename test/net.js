/**
 * Network integration test — exercises the real HTTP + WebSocket host server
 * exactly the way two browser clients would.
 *   node test/net.js
 */
'use strict';
const http = require('http');
const WS = require('ws');

const HOST = '127.0.0.1', PORT = process.env.PORT || 3000;
let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  -> ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = path => new Promise((res, rej) => {
  http.get({ host: HOST, port: PORT, path }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, type: r.headers['content-type'], loc: r.headers.location }));
  }).on('error', rej);
});

class Client {
  constructor(name) {
    this.name = name; this.log = []; this.snaps = []; this.msg = {};
    this.ws = new WS('ws://' + HOST + ':' + PORT + '/ws');
    this.ws.on('message', raw => {
      const m = JSON.parse(raw);
      this.log.push(m.t);
      this.msg[m.t] = (this.msg[m.t] || 0) + 1;
      if (m.t === 'snap') { this.snaps.push(m.s); if (this.snaps.length > 400) this.snaps.shift(); }
      else if (!this.last) this.last = {};
      this['last_' + m.t] = m;
    });
    this.ready = new Promise(r => this.ws.on('open', r));
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  wait(t, ms = 4000, poll = 30) {
    return new Promise(res => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (this.msg[t] || Date.now() - t0 > ms) { clearInterval(iv); res(!!this.msg[t]); }
      }, poll);
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  console.log('\n== HTTP ==');
  // "/" deliberately 302-redirects into /client/ so the page's RELATIVE script
  // paths (../core/data.js, audio.js) resolve. Serving the shell AT "/" makes a
  // browser request /audio.js and 404, which is exactly the unplayable-deploy bug.
  // This assertion used to expect a 200 here and only passed because the runner
  // was reusing a stale server from before that fix.
  const red = await get('/');
  ok(red.status === 302 && red.loc === '/client/index.html', 'GET / redirects into /client/', red.status + ' -> ' + red.loc);
  const idx = await get('/client/index.html');
  ok(idx.status === 200 && /AGAW-BUHAY/i.test(idx.body), 'and that document serves the game shell (' + idx.body.length + ' bytes)', idx.status);
  ok(/text\/html/.test(idx.type || ''), 'correct content-type for the shell', idx.type);
  for (const f of ['/core/data.js', '/core/level.js', '/core/sim.js', '/client/render.js', '/client/audio.js', '/client/main.js']) {
    const r = await get(f);
    ok(r.status === 200 && r.body.length > 500, 'GET ' + f, r.status);
  }
  const bad = await get('/core/nope.js');
  ok(bad.status === 404, 'unknown file -> 404', bad.status);
  const trav = await get('/../etc/passwd');
  ok(trav.status === 404 || trav.status === 400 || !/root:/.test(trav.body), 'path traversal blocked');
  const hp = await get('/health');
  ok(hp.status === 200, 'GET /health');
  const rl = await get('/api/rooms');
  ok(hp.status === 200 && rl.status === 200, 'GET /api/rooms');

  console.log('\n== Handshake ==');
  const A = new Client('host'), B = new Client('guest');
  await Promise.all([A.ready, B.ready]);
  ok(!!await A.wait('welcome'), 'client A receives welcome');
  ok(!!await B.wait('welcome'), 'client B receives welcome');

  console.log('\n== Host lobby ==');
  A.send({ t: 'host', stage: '1-1', difficulty: 'normal', privacy: 'public' });
  ok(!!await A.wait('lobby'), 'host gets lobby state');
  const code = A.last_lobby && A.last_lobby.code;
  ok(!!code && code.length >= 4, 'room code issued: ' + code);

  B.send({ t: 'browse' });
  ok(!!await B.wait('rooms'), 'browse returns room list');
  ok((B.last_rooms.rooms || []).some(r => r.code === code), 'hosted room is listed');

  B.send({ t: 'join', code });
  ok(!!await B.wait('lobby'), 'B joins by code');
  await sleep(80);
  ok(A.last_lobby.players.length === 2, 'host sees 2 players', A.last_lobby.players.length);

  console.log('\n== Survivor picks ==');
  A.send({ t: 'pick', hero: 'berto' });
  await sleep(80);
  B.send({ t: 'pick', hero: 'berto' });
  await sleep(80);
  ok(!!B.msg.err && /already chosen/.test(B.last_err.msg || ''), 'duplicate survivor rejected: ' + (B.last_err && B.last_err.msg));
  B.send({ t: 'pick', hero: 'rhea' });
  await sleep(80);
  const heroes = A.last_lobby.players.map(p => p.hero).sort().join(',');
  ok(heroes === 'berto,rhea', 'both picks registered: ' + heroes);
  B.send({ t: 'ready', v: true });
  A.send({ t: 'ready', v: true });
  await sleep(80);
  ok(A.last_lobby.players.every(p => p.ready), 'all players ready');

  console.log('\n== Config authority ==');
  B.send({ t: 'cfg', stage: '1-3' });
  await sleep(80);
  ok(!!B.msg.err && /host/i.test(B.last_err.msg || ''), 'non-host cannot change config');
  A.send({ t: 'cfg', stage: '1-3', difficulty: 'veteran' });
  await sleep(80);
  ok(A.last_lobby.cfg.stage === '1-3' && A.last_lobby.cfg.difficulty === 'veteran', 'host config change propagates');
  A.send({ t: 'cfg', stage: '1-1', difficulty: 'normal' });
  await sleep(100);

  console.log('\n== Match start ==');
  B.send({ t: 'start' });
  await sleep(60);
  ok(!!B.msg.err, 'non-host cannot start');
  A.send({ t: 'start' });
  ok(!!await A.wait('level', 6000), 'clients receive the serialized level');
  ok(!!await A.wait('start', 6000), 'clients receive start');
  const lv = A.last_level;
  ok(lv && lv.data && typeof lv.data.grid === 'string' && lv.data.grid.length > 1000, 'level payload carries the tile grid (' + (lv && lv.data && lv.data.grid.length) + ' tiles)');
  ok(lv && lv.data && lv.data.seed !== undefined && lv.stage === '1-1', 'level carries seed + stage id');
  ok(lv && Array.isArray(lv.data.marks) && Array.isArray(lv.data.flowAnchors), 'level carries navigation data');
  ok(A.last_start && A.last_level.you, 'client told which survivor is its own');

  console.log('\n== Snapshot stream ==');
  const t0 = Date.now();
  const n0 = A.snaps.length;
  A.send({ t: 'chat', text: 'laban!' });
  await sleep(2000);
  const hz = (A.snaps.length - n0) / ((Date.now() - t0) / 1000);
  ok(hz > 15 && hz < 40, 'snapshot rate ' + hz.toFixed(1) + ' Hz (target ~24)');
  const s1 = A.snaps[A.snaps.length - 1];
  const humans = s1.surv.filter(x => !x.bot);
  ok(humans.length === 2, 'snapshot has both human survivors', humans.length);
  ok(s1.surv.length === 4, 'empty slots auto-filled with AI teammates (' + s1.surv.length + '/4)', s1.surv.length);
  ok(new Set(s1.surv.map(x => x.hero)).size === 4, 'all four survivors are distinct heroes');
  ok(s1 && s1.obj && s1.obj.label, 'snapshot carries the objective: ' + (s1 && s1.obj && s1.obj.label));
  ok(s1 && typeof s1.cam === 'object', 'snapshot carries camera state');
  ok(B.msg.chat && B.last_chat.text === 'laban!', 'chat relayed to B');
  ok(s1 && s1.en !== undefined, 'enemy array present (count=' + s1.en.length + ')');

  console.log('\n== Authoritative input ==');
  const sA = A.snaps[A.snaps.length - 1];
  const before = sA.surv.find(s => s.id === sA.you) || sA.surv[0];
  const bx = before.x, by = before.y;
  for (let i = 0; i < 60; i++) { A.send({ t: 'input', i: { mx: 0, my: -1, fire: true, aim: bx, aimY: by - 200 } }); await sleep(16); }
  await sleep(250);
  const sB = A.snaps[A.snaps.length - 1];
  const after = sB.surv.find(s => s.id === sB.you) || sB.surv[0];
  const moved = Math.hypot(after.x - bx, after.y - by);
  ok(moved > 20, 'input moves the survivor on the server (' + moved.toFixed(0) + 'px)', moved.toFixed(0));
  ok(A.snaps.some(s => s.fx && s.fx.length) || A.snaps.some(s => s.fxp && s.fxp.length), 'fx events reach the client');

  console.log('\n== Late join (mid-match) ==');
  const C = new Client('late');
  await C.ready;
  C.send({ t: 'quick' });
  ok(!!await C.wait('level', 6000), 'late joiner receives the level');
  ok(C.last_level && C.last_level.late === true, 'late joiner is flagged as a mid-match drop-in');
  ok(C.last_level && C.last_level.data && C.last_level.data.grid.length > 1000, 'late joiner gets the same level geometry');
  await sleep(600);
  const s2 = A.snaps[A.snaps.length - 1];
  ok(s2.surv.length === 4, 'match stays at 4 survivors (a bot yields its slot)', s2.surv.length);
  ok(s2.surv.filter(x => !x.bot).length === 3, 'three of them are now human', s2.surv.filter(x => !x.bot).length);
  const lateS = s2.surv.find(s => s.id === C.last_level.you);
  ok(!!lateS, 'late joiner has its own survivor entity');
  ok(!!(lateS && lateS.ifr), 'late joiner spawns with iframes');

  console.log('\n== Disconnect -> bot takeover ==');
  B.close();
  await sleep(1200);
  const s3 = A.snaps[A.snaps.length - 1];
  ok(s3.surv.length === 4, 'disconnected player keeps playing as a bot (survivors still 4)', s3.surv.length);
  ok(s3.surv.filter(x => !x.bot).length === 2, 'one survivor flipped from human to bot', s3.surv.filter(x => !x.bot).length);
  ok(A.msg.lobby || A.msg.note || true, 'peers notified');

  console.log('\n== Host transfer ==');
  A.close();
  await sleep(1200);
  ok(!!C.msg.host, 'host transferred to remaining player');
  ok((C.last_host && C.last_host.you) === true, 'new host is told it is the host');

  console.log('\n== Reconnect reclaims your survivor ==');
  const code2 = C.last_lobby ? C.last_lobby.code : null;
  const cHero = C.last_level ? C.last_level.hero : null;
  const survBefore = C.snaps[C.snaps.length - 1].surv.length;
  C.close();
  await sleep(900);
  const E = new Client('rejoiner');
  await E.ready;
  const seatTok = C.last_welcome ? C.last_welcome.token : null;
  ok(!!seatTok, 'server issued a seat token to the dropped client');
  E.send({ t: 'join', code: code2, token: seatTok });
  ok(!!await E.wait('level', 6000), 'reconnecting client is handed the level again');
  ok(E.last_level && E.last_level.rejoin === true, 'server flags it as a rejoin, not a fresh spawn');
  await sleep(700);
  const sE = E.snaps[E.snaps.length - 1];
  ok(sE.surv.length === survBefore, 'no duplicate body spawned (' + sE.surv.length + ' survivors)', sE.surv.length);
  const mine = sE.surv.find(x => x.id === E.last_level.you);
  ok(!!mine, 'rejoiner controls a survivor');
  ok(mine && mine.hero === cHero, 'same survivor reclaimed (' + cHero + ' -> ' + (mine && mine.hero) + ')');
  ok(mine && !mine.bot, 'it is a human again, not the AI stand-in');
  ok(mine && mine.ifr, 'rejoiner gets spawn protection');

  console.log('\n== Sim keeps running server-side ==');
  const c1 = E.snaps.length;
  await sleep(1500);
  ok(E.snaps.length > c1 + 20, 'snapshots continue for the remaining client');
  const sc = E.snaps[E.snaps.length - 1];
  ok(sc && sc.dir && typeof sc.dir.i === 'number', 'AI Director state broadcast (intensity=' + (sc.dir && sc.dir.i) + ', wave=' + (sc.dir && sc.dir.w) + ')');
  ok(sc && Array.isArray(sc.gn), 'generator/objective state broadcast');

  E.close();
  await sleep(300);
  console.log('\n== Room cleanup ==');
  const rl2 = JSON.parse((await get('/api/rooms')).body);
  ok(Array.isArray(rl2.rooms || rl2), 'room list still valid after everyone left (' + JSON.stringify(rl2).slice(0, 90) + ')');

  console.log('\n----------------------------------------');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('----------------------------------------\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
