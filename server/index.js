/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  server/index.js
   HTTP static host + authoritative WebSocket co-op server.
   One process, one port: serves the client AND upgrades /ws.
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const DATA = require('../core/data.js');
const LV = require('../core/level.js');
const { Sim } = require('../core/sim.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const TICK = 1 / 60;            // simulation step
const SNAP_HZ = 24;             // snapshots per second per room
const REJOIN_GRACE = 90;        // seconds a run stays frozen waiting for a reconnect
const MAX_ROOMS = 24;

/* ---------------- static ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json'
};
function serve(res, file, code) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(code || 404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, v: DATA.VERSION })); return; }
  if (u === '/api/rooms') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ rooms: roomList() })); return; }
  // index.html uses RELATIVE script paths (../core/*.js, audio.js) so the folder
  // also works when opened straight off disk via file://. Serving it at "/" makes
  // a browser resolve "audio.js" to "/audio.js" -> 404, and the game then sits
  // silently on the title screen because main.js never loads. Redirect instead so
  // the document URL always lives inside /client/.
  if (u === '/' || u === '/index.html' || u === '/client' || u === '/client/') {
    res.writeHead(302, { Location: '/client/index.html', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const rel = u;
  // Only the two folders the browser actually loads are public. ROOT is the repo
  // top level, so without this a static handler here serves EVERYTHING in it --
  // server source, tests, the .git directory, and any .env added later. Verified
  // before the fix: GET /.env returned 200 with the file contents.
  const seg = rel.split('/');
  if (seg[1] !== 'client' && seg[1] !== 'core') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  if (seg.some(x => x.startsWith('.'))) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  serve(res, file);
});

/* ---------------- rooms ---------------- */
const rooms = new Map();
let roomSeq = 1;
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return rooms.has(s) ? makeCode() : s;
}
function roomList() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.cfg.privacy === 'private') continue;
    out.push({
      code: r.code, host: r.hostName, players: r.players.length, max: 4,
      stage: r.cfg.stage, stageName: (DATA.stageById(r.cfg.stage) || {}).name || r.cfg.stage,
      act: r.cfg.act, difficulty: r.cfg.difficulty, ff: r.cfg.ff ? 1 : 0,
      state: r.state, playstyle: r.cfg.playstyle || 'casual', ping: 0,
      progress: r.sim ? Math.round(r.sim.squadProgress() * 100) : 0
    });
  }
  return out.sort((a, b) => a.state.localeCompare(b.state) || b.players - a.players);
}

class Room {
  constructor(code, cfg, hostConn) {
    this.code = code;
    this.cfg = Object.assign({ stage: '1-1', act: 1, difficulty: 'normal', ff: false, privacy: 'public', playstyle: 'casual', bots: true }, cfg);
    this.players = [];            // conns in this room
    this.state = 'lobby';
    this.hostConn = hostConn;
    this.hostName = hostConn.profile.name;
    this.sim = null;
    this.acc = 0;
    this.snapAcc = 0;
    this.created = Date.now();
    this.levelCache = null;
    this.log = [];
  }
  host() { return this.hostConn; }
  setHost(c) {
    this.hostConn = c; this.hostName = c ? c.profile.name : '?';
    for (const p of this.players) this.send(p, { t: 'host', name: this.hostName, you: p === c, id: c ? c.pid : null });
  }
  add(conn) {
    if (this.players.length >= 4 && this.state === 'lobby') return false;
    conn.room = this;
    this.players.push(conn);
    this.abandonedAt = 0;
    return true;
  }
  remove(conn) {
    this.players = this.players.filter(p => p !== conn);
    conn.room = null;
    if (this.hostConn === conn) this.setHost(this.players[0] || null);
    // Hand the survivor to the AI FIRST — this is also what marks the seat as
    // reclaimable when the same person reconnects (see joinRoom).
    if (this.sim) {
      const s = this.sim.survivors.find(x => x.id === conn.pid);
      if (s && !s.isBot) {
        s.isBot = true;
        s.bot = s.bot || { state: 'follow', t: 0, strafe: 1, think: 0 };
        s.name = s.name + ' (AI)';
        s.seatPid = conn.pid;
        s.seatToken = conn.token;
      }
    }
    if (!this.players.length) {
      // Hold the seats: a phone dropping into a lift or through a wifi handoff
      // should not delete a 3-minute run. The sim freezes here and the main loop
      // reaps the room after a grace period if nobody comes back.
      this.abandonedAt = Date.now();
      if (this.state === 'playing') console.log('[room ' + this.code + '] everyone dropped — freezing the run for ' + REJOIN_GRACE + 's');
      return;
    }
    this.abandonedAt = 0;
    this.broadcastLobby();
  }
  pickedHeroes() { return this.players.map(p => p.hero).filter(Boolean); }
  broadcastLobby() {
    const heroes = DATA.SURVIVOR_ORDER.map(h => ({ id: h, taken: this.pickedHeroes().includes(h) }));
    for (const p of this.players) {
      this.send(p, {
        t: 'lobby', code: this.code, host: this.hostName, state: this.state, cfg: this.cfg,
        you: p.pid, amHost: p === this.hostConn,
        players: this.players.map(q => ({ id: q.pid, name: q.profile.name, hero: q.hero, ready: !!q.ready, host: q === this.hostConn, you: q === p, ping: q.rtt || 0 })),
        heroes
      });
    }
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players) if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  send(conn, msg) { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg)); }

  updateCfg(patch) {
    Object.assign(this.cfg, patch);
    if (this.state === 'lobby') this.broadcastLobby();
  }

  start() {
    const stage = DATA.stageById(this.cfg.stage) || DATA.STAGES[0];
    const level = LV.generate(stage);
    this.levelCache = LV.serialize(level);
    const sim = new Sim({
      stage, level, difficulty: this.cfg.difficulty, friendlyFire: !!this.cfg.ff,
      seed: (stage.seed + Date.now() % 9999) | 0
    });
    // human survivors
    const used = new Set();
    for (const p of this.players) {
      let hero = p.hero && !used.has(p.hero) ? p.hero : DATA.SURVIVOR_ORDER.find(h => !used.has(h));
      used.add(hero); p.hero = hero;
      sim.addSurvivor({ id: p.pid, name: p.profile.name, hero, isBot: false });
    }
    // fill up to 4 with AI teammates (GDD: Single Player w/ 3 AI bots)
    if (this.cfg.bots !== false) {
      for (const h of DATA.SURVIVOR_ORDER) {
        if (used.has(h)) continue;
        if (sim.survivors.length >= 4) break;
        used.add(h);
        sim.addSurvivor({ id: 'bot_' + h, name: DATA.SURVIVORS[h].name, hero: h, isBot: true });
      }
    }
    if (this.carry) { sim.importCarry(this.carry); this.carry = null; }
    this.sim = sim;
    this.state = 'playing';
    this.startedAt = Date.now();
    for (const p of this.players) {
      this.send(p, { t: 'level', stage: stage.id, data: this.levelCache, you: p.pid, hero: p.hero, cfg: this.cfg });
    }
    this.broadcastLobby();
    this.broadcast({ t: 'start', stage: stage.id, name: stage.name });
    console.log(`[room ${this.code}] started ${stage.id} with ${sim.survivors.length} survivors (${this.players.length} human)`);
  }

  step(dtReal) {
    if (this.state !== 'playing' || !this.sim) return;
    this.acc += Math.min(dtReal, 0.25);
    const inputs = {};
    for (const p of this.players) if (p.input) { inputs[p.pid] = p.input; if (p.input.seq) p.lastSeq = p.input.seq; }
    let guard = 0;
    while (this.acc >= TICK && guard++ < 6) {
      this.sim.update(TICK, inputs);
      const fx = this.sim.takeFx();
      if (fx.length) for (const p of this.players) p._fx = (p._fx || []).concat(fx);
      this.acc -= TICK;
    }
    this.snapAcc += dtReal;
    if (this.snapAcc >= 1 / SNAP_HZ) {
      this.snapAcc = 0;
      const snap = this.sim.snapshot();
      for (const p of this.players) {
        snap.you = p.pid;
        // phase 2: tell this client which of its inputs we have already simulated,
        // so it can replay only the un-acknowledged ones on top of this position
        const mySv = snap.surv.find(sv => sv.id === p.pid);
        if (mySv) mySv.isq = p.lastSeq || 0;
        snap.fxp = (p._fx || []).slice(0, 90);
        p._fx = [];
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'snap', s: snap }));
        if (mySv) delete mySv.isq;
      }
      if (this.sim.phase === 'victory' || this.sim.phase === 'defeat') {
        this.state = 'ended';
        const res = {
          t: 'end', phase: this.sim.phase, reason: this.sim.defeatReason || '',
          score: this.sim.score, kills: this.sim.kills, time: Math.round(this.sim.time),
          stage: this.sim.stage.id,
          survivors: this.sim.survivors.map(s => ({ name: s.name, hero: s.hero, kills: s.kills, dmg: Math.round(s.dmg), downs: s.downs, revives: s.revives, dead: s.dead ? 1 : 0, bot: s.isBot ? 1 : 0 }))
        };
        this.broadcast(res);
        const next = DATA.STAGES[DATA.STAGES.findIndex(s => s.id === this.sim.stage.id) + 1];
        this.nextStage = (this.sim.phase === 'victory' && next) ? next.id : null;
      }
    }
  }
}

/* ---------------- connections ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
let pidSeq = 1;

process.on('uncaughtException', e => console.error('[server] uncaught (ignored):', e && e.message));
process.on('unhandledRejection', e => console.error('[server] unhandled rejection (ignored):', e && e.message));

wss.on('connection', (ws, req) => {
  const conn = {
    ws, pid: 'p' + (pidSeq++), token: 'tok_' + Math.random().toString(36).slice(2, 12),
    profile: { name: 'Survivor' + (pidSeq), guest: true },
    room: null, input: null, hero: null, ready: false, rtt: 0, lastPing: Date.now(), lastSeq: 0, _fx: []
  };
  ws.send(JSON.stringify({ t: 'welcome', id: conn.pid, token: conn.token, v: DATA.VERSION, stages: DATA.STAGES.map(s => ({ id: s.id, name: s.name, theme: s.theme, obj: s.objective })), acts: DATA.ACTS, heroes: DATA.SURVIVORS, diffs: DATA.DIFFICULTIES, rooms: roomList() }));

  ws.on('pong', () => { ws._abDead = false; conn.lastPing = Date.now(); });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (conn.room) conn.room._idleT = 0;          // any traffic keeps a lobby alive
    try { handle(conn, m); } catch (e) { console.error('[server] handler error:', e && e.message); err(conn, 'Server hiccup — try again'); }
  });
  ws.on('close', () => {
    if (conn.room) { const r = conn.room; r.remove(conn); }
  });
  ws.on('error', () => {});
});

function send(c, m) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); }
function err(c, msg) { send(c, { t: 'err', msg }); }

function handle(c, m) {
  switch (m.t) {
    case 'profile':
      if (m.name) c.profile.name = String(m.name).slice(0, 18);
      c.profile.provider = m.provider || 'guest';
      if (c.room) c.room.broadcastLobby();
      send(c, { t: 'profile_ok', name: c.profile.name });
      break;

    case 'ping': send(c, { t: 'pong', c: m.c }); break;

    case 'browse': send(c, { t: 'rooms', rooms: roomList() }); break;

    case 'leave':
      if (c.room) { const r = c.room; r.remove(c); c.hero = null; c.ready = false; send(c, { t: 'left' }); }
      break;

    case 'quick': {
      if (m.token) c.seatToken = String(m.token).slice(0, 40);
      // immediate matchmaking into an active public session
      const open = [...rooms.values()].filter(r => r.cfg.privacy !== 'private' && r.players.length < 4 && r.state !== 'ended')
        .sort((a, b) => (a.state === 'playing' ? -1 : 1) - (b.state === 'playing' ? -1 : 1) || b.players.length - a.players.length);
      const target = open[0];
      if (target) { joinRoom(c, target); send(c, { t: 'note', msg: 'Quick Join — dropped into session ' + target.code }); }
      else {
        const r = new Room(makeCode(), { stage: '1-1', difficulty: 'normal', privacy: 'public', playstyle: 'quick' }, c);
        rooms.set(r.code, r); joinRoom(c, r);
        send(c, { t: 'note', msg: 'No active sessions — you are now hosting ' + r.code });
      }
      break;
    }

    case 'host': {
      if (rooms.size >= MAX_ROOMS) return err(c, 'Server full — try Quick Join');
      if (c.room) c.room.remove(c);
      const cfg = {
        stage: DATA.stageById(m.stage) ? m.stage : '1-1',
        act: m.act || 1,
        difficulty: DATA.DIFFICULTIES[m.difficulty] ? m.difficulty : 'normal',
        ff: !!m.ff, privacy: m.privacy === 'private' ? 'private' : 'public',
        playstyle: m.playstyle || 'casual', bots: m.bots !== false
      };
      const r = new Room(makeCode(), cfg, c);
      rooms.set(r.code, r);
      joinRoom(c, r);
      break;
    }

    case 'join': {
      if (m.token) c.seatToken = String(m.token).slice(0, 40);
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return err(c, 'Session ' + m.code + ' not found');
      if (r.players.length >= 4 && r.state === 'lobby') return err(c, 'Session is full');
      if (r.state === 'ended') return err(c, 'That run already ended');
      joinRoom(c, r);
      break;
    }

    case 'cfg':
      if (!c.room) return err(c, 'Not in a session');
      if (c.room.hostConn !== c) return err(c, 'Only the host can change session settings');
      c.room.updateCfg({
        stage: DATA.stageById(m.stage) ? m.stage : undefined,
        difficulty: DATA.DIFFICULTIES[m.difficulty] ? m.difficulty : undefined,
        ff: m.ff === undefined ? undefined : !!m.ff,
        privacy: m.privacy === undefined ? undefined : (m.privacy === 'private' ? 'private' : 'public'),
        playstyle: m.playstyle === undefined ? undefined : m.playstyle,
        bots: m.bots === undefined ? undefined : m.bots !== false
      });
      break;

    case 'pick': {
      if (!c.room) return err(c, 'Not in a session');
      const hero = DATA.SURVIVORS[m.hero] ? m.hero : null;
      if (!hero) return err(c, 'Unknown survivor');
      const taken = c.room.pickedHeroes().filter(h => h !== c.hero);
      if (taken.includes(hero)) return err(c, DATA.SURVIVORS[hero].name + ' is already chosen');
      c.hero = hero;
      c.room.broadcastLobby();
      break;
    }

    case 'ready':
      if (!c.room) break;
      c.ready = !!m.v;
      c.room.broadcastLobby();
      break;

    case 'start':
      if (!c.room) return err(c, 'Not in a session');
      if (c.room.hostConn !== c) return err(c, 'Only the host can start');
      if (c.room.state === 'playing') return err(c, 'Already running');
      if (!c.hero) c.hero = DATA.SURVIVOR_ORDER.find(h => !c.room.pickedHeroes().includes(h)) || 'berto';
      c.room.start();
      break;

    case 'restart':
      if (!c.room || c.room.hostConn !== c) break;
      // advancing after a VICTORY keeps everything the squad is carrying;
      // a defeat wipes the loadout so the retry starts clean
      c.room.carry = (c.room.sim && c.room.sim.phase === 'victory') ? c.room.sim.exportCarry() : null;
      c.room.state = 'lobby'; c.room.sim = null;
      c.room.cfg.stage = DATA.stageById(m.stage) ? m.stage : c.room.cfg.stage;
      c.room.broadcastLobby();
      break;

    case 'input': c.input = m.i || null; break;

    case 'chat':
      if (!c.room) break;
      c.room.broadcast({ t: 'chat', from: c.profile.name, text: String(m.text || '').slice(0, 140) });
      break;

    default: break;
  }
}

function joinRoom(c, r) {
  if (c.room && c.room !== r) c.room.remove(c);
  if (!r.add(c)) return err(c, 'Session full');
  if (!c.hero) c.hero = DATA.SURVIVOR_ORDER.find(h => !r.pickedHeroes().includes(h)) || null;
  send(c, { t: 'joined', code: r.code, cfg: r.cfg, host: r === r.hostConn });
  r.broadcastLobby();
  // late join into a running session
  if (r.state === 'playing' && r.sim) {
    const taken = h => r.sim.survivors.some(s => s.hero === h && !s.isBot);
    let hero = (c.hero && !taken(c.hero)) ? c.hero
      : (DATA.SURVIVOR_ORDER.find(h => !taken(h)) || DATA.SURVIVOR_ORDER.find(h => !r.sim.survivors.some(s => s.hero === h)));
    hero = hero || 'berto'; c.hero = hero;
    const alive = r.sim.aliveSurvivors();
    const anchor = alive.length ? alive[0] : { x: r.sim.level.spawn.x, y: r.sim.level.spawn.y };

    // Reconnecting? Reclaim the survivor this seat left behind (it kept fighting
    // as an AI) instead of spawning a fifth body.
    const orphans = r.sim.survivors.filter(x => x.isBot && !/^bot_/.test(String(x.id)) && /\(AI\)/.test(x.name));
    const orphan = (c.seatToken && orphans.find(x => x.seatToken === c.seatToken))
      || orphans.find(x => x.hero === c.hero) || orphans[0];
    let s;
    if (orphan) {
      hero = c.hero = orphan.hero;
      s = orphan;
      s.id = c.pid; s.isBot = false; s.name = c.profile.name; s.hero = hero;
      s.iframe = Math.max(s.iframe, 2.5);
      s.seatPid = null; s.seatToken = null;
      if (s.dead) {
        // they died while disconnected — bring them back downed next to the squad
        // with ~12s on the bleed-out clock so a teammate can pick them up
        s.dead = false; s.down = true; s.hp = 1; s.bleed = 28; s.reviveP = 0; s.pin = 0;
        const rp = r.sim.findWalkable(anchor.x + (Math.random() - .5) * 80, anchor.y + (Math.random() - .5) * 80);
        s.x = rp.x; s.y = rp.y;
      }
      send(c, { t: 'level', stage: r.sim.stage.id, data: r.levelCache, you: c.pid, hero, cfg: r.cfg, late: true, rejoin: true });
      r.sim.setAnnounce(c.profile.name + ' RECONNECTED', 2.4);
    } else {
      if (r.sim.survivors.length >= 4) {
        // drop an AI teammate to make room for the human
        const bot = r.sim.survivors.find(x => x.isBot);
        if (bot) r.sim.survivors = r.sim.survivors.filter(x => x !== bot);
      }
      s = r.sim.addSurvivor({ id: c.pid, name: c.profile.name, hero, isBot: false });
      const p = r.sim.findWalkable(anchor.x + (Math.random() - .5) * 90, anchor.y + (Math.random() - .5) * 90);
      s.x = p.x; s.y = p.y; s.iframe = 2.5;
      send(c, { t: 'level', stage: r.sim.stage.id, data: r.levelCache, you: c.pid, hero, cfg: r.cfg, late: true });
      r.sim.setAnnounce(c.profile.name + ' JOINED', 2.4);
    }
  }
  broadcastRooms();
}

function broadcastRooms() {
  const list = roomList();
  const s = JSON.stringify({ t: 'rooms', rooms: list });
  for (const c of wss.clients) { /* clients not in a room get lists on demand; send to all is cheap here */ }
  wss.clients.forEach(cl => { if (cl.readyState === 1) cl.send(s); });
}

/* ---------------- main loop ---------------- */
let last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Number(now - last) / 1e9; last = now;
  for (const r of [...rooms.values()]) {
    const humans = r.players.length;
    // nobody connected: freeze (never simulate for an empty room) and reap later
    if (humans === 0) {
      if (!r.abandonedAt) r.abandonedAt = Date.now();
      const grace = r.state === 'playing' ? REJOIN_GRACE : 25;
      if (Date.now() - r.abandonedAt > grace * 1000) {
        rooms.delete(r.code);
        console.log('[room ' + r.code + '] reaped (' + r.state + ', nobody came back)');
      }
      continue;
    }
    r.abandonedAt = 0;
    if (r.state === 'ended') {
      if (Date.now() - (r.endedAt || (r.endedAt = Date.now())) > 1000 * 60 * 6) { rooms.delete(r.code); console.log('[room ' + r.code + '] reaped (finished)'); }
      continue;
    }
    if (r.state === 'lobby') {
      r._idleT = (r._idleT || 0) + dt;
      if (r._idleT > 60 * 20) { rooms.delete(r.code); console.log('[room ' + r.code + '] reaped (idle lobby)'); }
      continue;
    }
    r._idleT = 0;
    try { r.step(dt); } catch (e) { console.error('[room ' + r.code + '] step error', e); }
  }
}, 1000 / 40);

// heartbeat: reap sockets that vanished without a FIN (crash, sleep, dropped wifi)
setInterval(() => {
  wss.clients.forEach(cl => {
    if (cl._abDead) { try { cl.terminate(); } catch (e) {} return; }
    cl._abDead = true;
    try { cl.ping(); } catch (e) {}
  });
}, 20000);

function shutdown(sig) {
  console.log('[server] ' + sig + ' — closing ' + wss.clients.size + ' socket(s), ' + rooms.size + ' room(s)');
  for (const r of rooms.values()) {
    try { r.broadcast({ t: 'note', msg: 'Server is restarting — reconnecting…' }); } catch (e) {}
  }
  try { wss.clients.forEach(cl => { try { cl.close(1001, 'server restart'); } catch (e) {} }); } catch (e) {}
  try { wss.close(); } catch (e) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => {
  console.log('=========================================================');
  console.log('  AGAW-BUHAY: SURVIVAL  —  co-op host server v' + DATA.VERSION);
  console.log('  http://0.0.0.0:' + PORT + '   (ws://' + PORT + '/ws)');
  console.log('  Act 1 vertical slice · ' + DATA.STAGES.length + ' stages · server-authoritative sim @ 60Hz');
  console.log('=========================================================');
});
