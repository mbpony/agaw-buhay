/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  client/main.js
   App shell: menus, matchmaking, netcode, input, HUD, game loop.
   Plays two ways off the SAME renderer:
     · WebSocket co-op  (server-authoritative sim)
     · Single player    (sim runs locally with 3 AI bots)
   ============================================================ */
(function () {
  'use strict';
  const D = window.ABAW_DATA, LV = window.ABAW_LEVEL, SIM = window.ABAW_SIM;
  const { Renderer, drawPortrait } = window.ABAW_RENDER;
  const AU = window.ABAW_AUDIO;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---------------- persistent profile (mock cloud save) ---------------- */
  const SAVE_KEY = 'agawbuhay.profile.v1';
  const SET_KEY = 'agawbuhay.settings.v1';
  let profile = load(SAVE_KEY, { name: 'Survivor' + Math.floor(Math.random() * 900 + 100), provider: 'guest', runs: 0, best: 0, kills: 0 });
  let settings = load(SET_KEY, { vol: 0.7, shake: true, dmg: true, fps: false });
  function load(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return d; } }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }

  /* ---------------- app state ---------------- */
  const app = {
    screen: 'title', mode: null, ws: null, net: 'offline', room: null, you: null, hero: null,
    lobby: null, rooms: [], stage: null, level: null, sim: null, localRun: null,
    ping: 0, pingT: 0, lastSnap: null, ended: false, chatOpen: false, paused: false,
    // phase 2 client-side prediction: un-acked input samples + predicted own state
    iseq: 0, pend: [], curSample: null, pred: null, predOff: null, predSpeed: 0,
    locked: false, lookDX: 0, lookDY: 0, pitch: 0, pitchDelta: 0, look: dx => { app.lookDX += dx; },
    dbg: /[?&]dbg=1/.test(location.search), lastDrawError: null,
    reconnecting: false, rejoinCode: null,
    yaw: 0, turn: 0, frameDt: 1 / 60, prevFire: false, yawInit: false
  };
  // 3D presentation layer (master doc): real Three.js scene when WebGL exists;
  // the raycast renderer stays as the no-WebGL / ?r2d debug fallback.
  const renderer = (window.ABAW_R3D && window.ABAW_R3D.webglAvailable() && !/[?&]r2d\b/.test(location.search))
    ? new window.ABAW_R3D.Renderer3D($('game'))
    : new Renderer($('game'));
  // FP audio: sounds pan by bearing relative to your view, not screen space
  AU.setListener(() => (renderer.fp && renderer.ownPos) ? { fp: true, x: renderer.ownPos.x, y: renderer.ownPos.y, yaw: renderer.yaw } : null);
  renderer.opts.shake = settings.shake; renderer.opts.dmg = settings.dmg; renderer.opts.fps = settings.fps;
  AU.setVolume(settings.vol);

  /* ================= NAVIGATION ================= */
  const SCREENS = ['sc-title', 'sc-auth', 'sc-host', 'sc-find', 'sc-lobby', 'sc-solo', 'sc-how'];
  function show(name) {
    SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== 'sc-' + name));
    $('hud').classList.toggle('hidden', name !== 'game');
    const tl = $('touch');
    if (tl) tl.classList.toggle('on', name === 'game' && touch.on && !app.paused);
    if (name === 'game' && touch.on) maybeIosHint();
    app.screen = name;
    if (name === 'game') goFullscreen();
    if (name !== 'game') { touch.fire = false; touch.use = false; touch.move.id = null; touch.aim.id = null; touch.move.x = touch.move.y = touch.aim.x = touch.aim.y = 0; }
  }
  function loading(on, title, sub) {
    $('sc-load').classList.toggle('hidden', !on);
    if (title) $('loadTitle').textContent = title;
    if (sub) $('loadSub').textContent = sub;
  }
  function toast(msg, bad) {
    const el = document.createElement('div');
    el.className = 'msg';
    if (bad) el.style.borderLeftColor = '#e0263f';
    el.textContent = msg;
    $('msgs').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(() => el.remove(), 3200);
  }

  /* ================= NETWORK ================= */
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }
  function connect() {
    if (app.ws && (app.ws.readyState === 0 || app.ws.readyState === 1)) return;
    let ws;
    try { ws = new WebSocket(wsUrl()); } catch (e) { setNet('offline'); return; }
    app.ws = ws;
    setNet('connecting');
    ws.onopen = () => {
      setNet('online');
      send({ t: 'profile', name: profile.name, provider: profile.provider });
      send({ t: 'browse' });
      // dropped mid-run (mobile network switch, tab sleep, server restart)?
      if (app.reconnecting && app.rejoinCode) send({ t: 'join', code: app.rejoinCode, token: seatToken() });
    };
    ws.onclose = () => {
      setNet('offline'); app.ws = null;
      const inMatch = app.mode === 'net' && app.screen === 'game' && !app.ended;
      if (inMatch) {
        app.reconnecting = true;
        app.rejoinCode = app.room;
        // freeze the view: the server keeps your survivor alive as an AI until you are back
        if (!app.paused) togglePause();
        toast('Connection lost — reconnecting to ' + (app.room || 'session') + '…', true);
        setTimeout(connect, 1200);
      } else setTimeout(connect, 2500);
    };
    ws.onerror = () => { setNet('offline'); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onNet(m);
    };
  }
  function setNet(s) {
    app.net = s;
    const el = $('sessVal');
    if (el) {
      el.textContent = app.room ? app.room : s === 'online' ? 'ONLINE' : s === 'connecting' ? '…' : 'OFFLINE';
      el.style.color = s === 'online' ? '#4ade80' : s === 'connecting' ? '#ffb02e' : '#e0263f';
    }
    const tn = $('titleNet');
    if (tn) {
      tn.className = 'conn ' + (s === 'online' ? 'on' : s === 'connecting' ? '' : 'off');
      const n = (app.rooms || []).filter(r => r.state !== 'ended').length;
      tn.lastChild.textContent = s === 'online'
        ? (n ? 'co-op online · ' + n + ' open session' + (n === 1 ? '' : 's') : 'co-op online · no open sessions')
        : s === 'connecting' ? 'connecting to co-op server…'
        : 'co-op offline · single player still works';
    }
  }
  function send(m) { if (app.ws && app.ws.readyState === 1) app.ws.send(JSON.stringify(m)); else return false; return true; }

  function onNet(m) {
    switch (m.t) {
      case 'welcome':
        app.pid = m.id;
        // A seat token survives a page refresh or a dropped radio link, so the
        // server can hand us back the exact survivor we were playing.
        if (m.token) {
          app.token = m.token;
          try { sessionStorage.setItem('agawbuhay.seat', m.token); } catch (e) {}
        }
        $('footVer').textContent = 'v' + m.v + ' · Act 1: Dilim sa Maynila · HTML5 canvas renderer · WebSocket co-op · ' + (m.stages ? m.stages.length : 0) + ' stages';
        fillSelects(m);
        setNet('online');
        break;
      case 'profile_ok': profile.name = m.name; save(); break;
      case 'rooms': app.rooms = m.rooms || []; if (app.screen === 'find') renderRooms(); break;
      case 'joined':
        app.room = m.code; setNet('online');
        $('lbCode').textContent = m.code;
        show('lobby');
        break;
      case 'lobby': applyLobby(m); break;
      case 'host':
        $('lbHost').textContent = m.name;
        if (m.you) toast('You are now the host');
        if (app.lobby) { app.lobby.amHost = !!m.you; app.lobby.host = m.name; applyLobby(app.lobby); }
        break;
      case 'level': onLevel(m); break;
      case 'start': break;
      case 'snap': onSnapshot(m.s); break;
      case 'end': onEnd(m); break;
      case 'err':
        toast(m.msg, true); AU.SFX.ui('error');
        if (app.reconnecting) {
          // the session we were in is gone (finished, reaped, or full)
          app.reconnecting = false; app.rejoinCode = null;
          onEnd({ phase: 'defeat', reason: 'Lost connection to the session: ' + m.msg, score: 0, kills: 0, time: 0, survivors: [] });
        }
        break;
      case 'note': toast(m.msg); break;
      case 'chat': addChat(m.from, m.text); break;
      case 'pong': app.ping = Math.round(performance.now() - m.c); break;
      case 'left': app.room = null; setNet('online'); show('title'); break;
      default: break;
    }
  }

  function fillSelects(w) {
    const stages = w.stages || D.STAGES.map(s => ({ id: s.id, name: s.name, theme: s.theme, obj: s.objective }));
    const acts = w.acts || D.ACTS;
    const heroes = w.heroes || D.SURVIVORS;
    const diffs = w.diffs || D.DIFFICULTIES;
    // host screen
    $('hAct').innerHTML = acts.map(a => `<option value="${a.id}" ${a.unlocked ? '' : 'disabled'}>Act ${a.id} — ${a.name}${a.unlocked ? '' : ' (locked · ' + (a.boss || '') + ')'}</option>`).join('');
    $('hStage').innerHTML = stages.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join('');
    $('hDiff').innerHTML = Object.keys(diffs).map(k => `<option value="${k}">${diffs[k].name}</option>`).join('');
    $('fStage').innerHTML = '<option value="">All stages</option>' + stages.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join('');
    $('sStage').innerHTML = stages.map(s => `<option value="${s.id}">${s.id} · ${s.name} — ${s.theme}</option>`).join('');
    $('sDiff').innerHTML = Object.keys(diffs).map(k => `<option value="${k}">${diffs[k].name}</option>`).join('');
    $('sHero').innerHTML = D.SURVIVOR_ORDER.map(h => `<option value="${h}">${heroes[h].name} — ${heroes[h].role}</option>`).join('');
    $('lbStageSel').innerHTML = stages.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join('');
    $('lbDiffSel').innerHTML = Object.keys(diffs).map(k => `<option value="${k}">${diffs[k].name}</option>`).join('');
    // acts list on solo screen
    $('actList').innerHTML = acts.map(a => `
      <div class="kv"><span>Act ${a.id} — <b style="color:${a.unlocked ? '#fff' : '#6b7280'}">${a.name}</b> <span class="hint">(${a.sub})</span></span>
      <b style="color:${a.unlocked ? '#4ade80' : '#e0263f'}">${a.unlocked ? a.stages.join(' · ') : 'LOCKED' + (a.boss ? ' — boss: ' + a.boss : '')}</b></div>`).join('');
    // how-to screen
    $('loreText').innerHTML = `In the humid heat of Metro Manila, an ancient subterranean anomaly known as <b>Ang Lason ng Lupa</b> (The Earth's Poison) ruptures beneath Quiapo Church during a catastrophic typhoon season. The cursed miasma transforms infected civilians into ravenous, mutated monsters reflecting ancient Filipino folklore horrors.<br><br>With Metro Manila designated as a locked-down <b>Red Zone</b>, radio broadcasts transmit a final message: an armored military extraction unit is stationed at the foot of <b>Mount Mayon</b> in Albay. Four survivors must combine their abilities to fight across flooded urban streets, dark provincial highways and ancient rainforests to reach the escape chopper before the island is firebombed.`;
    $('enemyList').innerHTML = Object.keys(D.ENEMIES).map(k => {
      const e = D.ENEMIES[k];
      const c = e.tier === 'boss' ? '#ff2d55' : e.tier === 'special' ? '#ffb02e' : '#8b8f99';
      return `<div class="kv"><span style="color:${c}"><b style="color:${c}">${e.name}</b> — ${e.variant}</span><span class="hint" style="max-width:56%;text-align:right">${e.desc}</span></div>`;
    }).join('');
    $('howKeys').innerHTML = [['WASD', 'Move'], ['Mouse', 'Aim'], ['LMB', 'Fire'], ['Shift', 'Sprint'], ['R', 'Reload'], ['Space', 'Ability'], ['E', 'Interact / Revive / Take loot'], ['F', 'Melee'], ['Q', 'Swap weapon (slot 2)'], ['G', 'Throw molotov / bomb'], ['T', 'Chat'], ['Esc', 'Pause'], ['M', 'Mute'], ['Tab', 'Scoreboard']]
      .concat(touch.on ? [['LEFT PAD', 'Move (full tilt sprints)'], ['RIGHT PAD', 'Aim + look — vertical tilts the camera, deflect to auto-fire'], ['FIRE / ABILITY / USE / RLD / HIT / RUN', 'Thumb cluster'], ['SWAP / THROW', 'Second weapon and grenades'], ['GFX', 'Cycle graphics quality']] : []).map(k => `<div class="key"><kbd>${k[0]}</kbd> ${k[1]}</div>`).join('');
  }

  /* ================= LOBBY ================= */
  function applyLobby(m) {
    app.lobby = m;
    $('lbCode').textContent = m.code;
    $('lbHost').textContent = m.host;
    const st = D.stageById(m.cfg.stage) || D.STAGES[0];
    $('lbStage').textContent = st.id + ' · ' + st.name;
    $('lbDiff').textContent = (D.DIFFICULTIES[m.cfg.difficulty] || {}).name || m.cfg.difficulty;
    $('lbFF').textContent = m.cfg.ff ? 'ON' : 'OFF';
    $('lbState').textContent = m.state.toUpperCase();
    app.isHost = !!m.amHost || (m.you ? m.players.some(p => p.id === m.you && p.host) : m.players.some(p => p.host && p.name === profile.name));
    const isHost = app.isHost;
    $('lbHostCtl').classList.toggle('hidden', !isHost);
    $('btnStart').classList.toggle('hidden', !isHost);
    $('btnStart').textContent = m.state === 'playing' ? 'Running…' : 'Launch';
    $('btnStart').disabled = m.state === 'playing';
    $('lbHint').textContent = isHost ? 'You are the host — pick the stage and launch.' : 'Waiting for the host to launch…';
    $('lbStageSel').value = m.cfg.stage;
    $('lbDiffSel').value = m.cfg.difficulty;
    $('lbFFtog').classList.toggle('on', !!m.cfg.ff);
    // players
    $('squadCount').textContent = '(' + m.players.length + '/4)';
    $('playerList').innerHTML = m.players.map(p => `
      <div class="prow ${p.host ? 'host' : ''}">
        <div class="dot ${p.hero ? 'on' : ''}"></div>
        <div style="flex:1"><div class="nm">${esc(p.name)}${p.host ? ' <span class="tag" style="margin-left:6px">HOST</span>' : ''}</div>
        <div class="pg">${p.hero ? '' : 'choosing…'}</div></div>
        <div class="hr">${p.hero ? D.SURVIVORS[p.hero].name.split(' ')[0] + ' · ' + D.SURVIVORS[p.hero].role : '—'}</div>
        <div class="pg">${p.ping ? p.ping + 'ms' : ''}</div>
      </div>`).join('') +
      (m.players.length < 4 ? `<div class="prow" style="opacity:.5"><div class="dot"></div><div class="nm">AI Teammate</div><div class="hr">auto-fill</div></div>` : '');
    // hero grid
    renderHeroGrid(m);
    if (app.screen !== 'lobby' && m.state === 'lobby') show('lobby');
  }
  function renderHeroGrid(m) {
    const taken = {};
    m.players.forEach(p => { if (p.hero) taken[p.hero] = p.name; });
    const me = m.players.find(p => p.name === profile.name);
    $('heroGrid').innerHTML = D.SURVIVOR_ORDER.map(h => {
      const hero = D.SURVIVORS[h];
      const isMe = me && me.hero === h;
      const other = taken[h] && !isMe;
      return `<div class="hero ${isMe ? 'sel' : ''} ${other ? 'taken' : ''}" data-hero="${h}" style="--hc:${hero.color}">
        ${other ? `<div class="taken-by">${esc(taken[h])}</div>` : ''}
        ${isMe ? `<div class="you">YOU</div>` : ''}
        <canvas id="pc-${h}"></canvas>
        <div class="rl">${hero.role}</div>
        <div class="nm">${hero.name}</div>
        <div class="tg">"${hero.tag}" · ${hero.weapon === 'shotgun' ? 'Shotgun' : hero.weapon === 'burst' ? 'Burst Rifle' : hero.weapon === 'smg' ? 'Dual SMGs' : 'Assault Rifle'} + ${hero.melee}</div>
        <ul><li>${hero.passive}</li><li>${hero.ability.name} — ${hero.ability.desc}</li><li>HP ${hero.stats.maxHp} · SPD ${hero.stats.speed} · STA ${hero.stats.stamina}</li></ul>
      </div>`;
    }).join('');
    D.SURVIVOR_ORDER.forEach(h => { const c = $('pc-' + h); if (c) drawPortrait(c, h, 150); });
    document.querySelectorAll('.hero').forEach(el => {
      el.onclick = () => {
        if (el.classList.contains('taken')) { AU.SFX.ui('error'); return; }
        AU.SFX.ui('click');
        app.hero = el.dataset.hero;
        send({ t: 'pick', hero: app.hero });
      };
      el.onmouseenter = () => {
        const hero = D.SURVIVORS[el.dataset.hero];
        $('heroDetail').innerHTML = `<b style="color:${hero.color}">${hero.name}</b> — ${hero.role}. Loadout: ${D.WEAPONS[hero.weapon].name} + ${hero.melee}. Passive: ${hero.passive}. Active: <b>${hero.ability.name}</b> (${hero.ability.cd}s CD) — ${hero.ability.desc}.`;
      };
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ================= LEVEL / RUN START ================= */
  function onLevel(m) {
    const rejoining = !!app.reconnecting;
    app.reconnecting = false; app.rejoinCode = null;
    loading(true, rejoining ? 'Reconnecting' : 'Deploying', rejoining ? 'Rejoining your squad…' : 'Syncing level geometry…');
    app.stage = D.stageById(m.stage) || D.STAGES[0];
    app.level = LV.deserialize(m.data);
    app.you = m.you; app.hero = m.hero; app.mode = 'net'; app.ended = false;
    renderer.setLevel(m.data);
    renderer.ambient = app.stage.light;
    renderer.ambientKind = app.stage.ambient;
    renderer.youId = m.you;
    renderer.buf.length = 0;
    AU.init(); AU.resume();
    AU.startAmbience(app.stage.ambient);
    buildSquadHud(m);
    setTimeout(() => {
      loading(false); show('game'); AU.SFX.ui('start');
      if (rejoining || m.rejoin) {
        if (app.paused) togglePause();          // un-freeze: we are back in the fight
        toast(m.rejoin ? 'Reconnected — your survivor held the line' : 'Reconnected', false);
      }
    }, 420);
  }

  function startSolo() {
    const stageId = $('sStage').value, diff = $('sDiff').value, hero = $('sHero').value, ff = $('sFF').classList.contains('on');
    loading(true, 'Deploying', 'Generating procedural Metro Manila…');
    setTimeout(() => {
      const stage = D.stageById(stageId);
      const level = LV.generate(stage);
      app.stage = stage; app.level = level; app.mode = 'local'; app.ended = false;
      app.sim = new SIM.Sim({ stage, level, difficulty: diff, friendlyFire: ff, seed: (stage.seed ^ (Date.now() & 0xffff)) | 0 });
      app.you = 'local_you';
      app.sim.addSurvivor({ id: app.you, name: profile.name, hero, isBot: false });
      for (const h of D.SURVIVOR_ORDER) { if (h === hero) continue; app.sim.addSurvivor({ id: 'bot_' + h, name: D.SURVIVORS[h].name, hero: h, isBot: true }); }
      // gear earned in the previous stage survives the transition
      if (app.carry) { app.sim.importCarry(app.carry); app.carry = null; }
      renderer.setLevel(LV.serialize(level));
      renderer.ambient = stage.light; renderer.ambientKind = stage.ambient; renderer.youId = app.you;
      renderer.buf.length = 0;
      AU.init(); AU.resume(); AU.startAmbience(stage.ambient);
      app.localAcc = 0;
      buildSquadHud({ cfg: { difficulty: diff, ff } });
      loading(false); show('game'); AU.SFX.ui('start');
      app.room = null; setNet(app.net);
      $('sessVal').textContent = 'SOLO +3 AI';
    }, 40);
  }

  function buildSquadHud(m) {
    $('squad').innerHTML = D.SURVIVOR_ORDER.map((h, i) => `
      <div class="mate" id="mate-${i}" style="--hc:${D.SURVIVORS[h].color}">
        <div class="pv"><canvas id="mh-${i}" width="68" height="68"></canvas></div>
        <div>
          <div class="nm" id="mn-${i}">—</div>
          <div class="rl" id="mr-${i}">${D.SURVIVORS[h].role}</div>
          <div class="bars2"><div class="bar"><i id="mhpb-${i}"></i></div><div class="bar st"><i id="mstb-${i}"></i></div></div>
        </div>
        <div style="text-align:right">
          <div class="stt" id="ms-${i}">READY</div>
          <div class="abring" style="margin-top:6px;margin-left:auto">
            <svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="rgba(0,0,0,.5)" stroke="rgba(255,255,255,.12)" stroke-width="2"/>
            <circle id="ab-${i}" cx="13" cy="13" r="11" fill="none" stroke="${D.SURVIVORS[h].accent}" stroke-width="2.4" stroke-dasharray="69.1" stroke-dashoffset="0" stroke-linecap="round"/></svg>
            <span id="abt-${i}"></span>
          </div>
        </div>
      </div>`).join('');
    D.SURVIVOR_ORDER.forEach((h, i) => drawPortrait($('mh-' + i), h, 68));
  }

  /* ================= SNAPSHOT ================= */
  const clampN = (v, m) => v > m ? m : v < -m ? -m : v;

  /* Phase 2 netcode: fold the authoritative position back into the prediction.
     Inputs the server had not confirmed yet (seq > sv.isq) are replayed on top of
     it; whatever error is left becomes a decaying offset so the view glides
     instead of popping. Big errors (knockback, teleports) snap immediately. */
  function reconcile(s) {
    const PK = window.ABAW_PREDICT;
    if (!PK || !app.pred || !renderer.level || !s.surv) return;
    const me = s.surv.find(x => x.id === app.you);
    if (!me || me.dd) return;
    const hero = D.SURVIVORS[me.hero];
    if (hero && hero.stats) app.predSpeed = hero.stats.speed;
    const isq = me.isq || 0;
    while (app.pend.length && app.pend[0].seq <= isq) app.pend.shift();
    const list = app.pend.slice();
    if (app.curSample && app.curSample.hold > 0) list.push(app.curSample);
    const rep = PK.replay(LV, renderer.level, me, list, app.predSpeed);
    const err = Math.hypot(app.pred.x - rep.x, app.pred.y - rep.y);
    if (err > 56) { app.pred = rep; app.predOff.x = 0; app.predOff.y = 0; }
    else {
      app.predOff.x = clampN(app.predOff.x + (app.pred.x - rep.x), 40);
      app.predOff.y = clampN(app.predOff.y + (app.pred.y - rep.y), 40);
      app.pred = rep;
    }
  }

  function onSnapshot(s) {
    app.lastSnap = s;
    renderer.push(s, false);
    reconcile(s);
    if (s.you) { app.you = s.you; renderer.youId = s.you; }
    if (s.phase === 'victory' || s.phase === 'defeat') { /* server sends 'end' */ }
  }

  function onEnd(m) {
    if (app.ended) return;
    app.ended = true;
    showResults(m);
  }

  function showResults(m) {
    const win = m.phase === 'victory';
    $('resTitle').textContent = win ? 'Extracted' : 'Overrun';
    $('resTitle').className = win ? 'win' : 'lose';
    $('resSub').textContent = win
      ? (app.stage ? app.stage.name : '') + ' cleared — the squad reached the chopper.'
      : (m.reason || 'The miasma took the squad.');
    const nextStage = win && app.stage ? D.STAGES[D.STAGES.findIndex(s => s.id === app.stage.id) + 1] : null;
    $('resStats').innerHTML = [
      ['Score', m.score || 0], ['Kills', m.kills || 0], ['Time', fmtTime(m.time || 0)], ['Difficulty', ((D.DIFFICULTIES[(app.lastSnap || {}).diff] || {}).name) || '—']
    ].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div></div>`).join('');
    $('resRows').innerHTML = (m.survivors || []).map(s => {
      const h = D.SURVIVORS[s.hero];
      return `<tr><td class="n" style="color:${h.color}">${esc(s.name)}${s.bot ? ' <span class="tag">AI</span>' : ''}</td>
      <td>${h.role}</td><td>${s.kills}</td><td>${s.dmg}</td><td>${s.revives}</td>
      <td style="color:${s.dead ? '#e0263f' : '#4ade80'}">${s.dead ? 'KIA' : 'SURVIVED'}</td></tr>`;
    }).join('');
    $('btnNext').classList.toggle('hidden', !nextStage);
    $('btnNext').textContent = nextStage ? 'Next: ' + nextStage.name : 'Next';
    $('btnNext').onclick = () => {
      $('sc-results').classList.add('hidden');
      if (app.mode === 'net') { send({ t: 'restart', stage: nextStage.id }); }
      else { app.carry = (app.sim && app.sim.phase === 'victory') ? app.sim.exportCarry() : null; $('sStage').value = nextStage.id; startSolo(); }
    };
    $('btnReplay').onclick = () => {
      $('sc-results').classList.add('hidden');
      if (app.mode === 'net') send({ t: 'restart', stage: app.stage.id });
      else startSolo();
    };
    $('btnMenu').onclick = () => { $('sc-results').classList.add('hidden'); quitRun(); };
    $('sc-results').classList.remove('hidden');
    AU.stopAmbience();
    profile.runs++; profile.best = Math.max(profile.best, m.score || 0); profile.kills += (m.kills || 0); save();
    AU.SFX.ui(win ? 'win' : 'lose');
  }
  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }

  /* ================= INPUT ================= */
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };
  addEventListener('keydown', e => {
    if (app.chatOpen) {
      if (e.key === 'Enter') { const v = $('chatinput').value.trim(); if (v) send({ t: 'chat', text: v }); $('chatinput').value = ''; closeChat(); }
      else if (e.key === 'Escape') closeChat();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); return; }
    keys[e.code] = true;
    if (e.code === 'Escape') { if (app.screen === 'game') togglePause(); }
    if (e.code === 'KeyT' && app.screen === 'game' && app.mode === 'net') { e.preventDefault(); openChat(); }
    if (e.code === 'KeyM') { settings.muted = !settings.muted; AU.setMuted(!!settings.muted); toast(settings.muted ? 'Audio muted' : 'Audio on'); }
    if (e.code === 'KeyR' && app.screen === 'game') input.reload = true;
    if (e.code === 'KeyQ' && app.screen === 'game' && !e.repeat) input.swapQueued = true;
    if (e.code === 'KeyG' && app.screen === 'game' && !e.repeat) input.throwQueued = true;
    if (['Space', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.key === 'Tab') $('scoreboard') && $('scoreboard').classList.add('hidden');
    if (e.code === 'KeyR') input.reload = false;
  });
  const canvas = $('game');
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.seen = true;
    if (!touch.on && renderer.fp) {                                        // mouse-look (locked or not)
      if (e.movementX) app.lookDX += e.movementX;
      if (e.movementY) app.lookDY += e.movementY;
    }
  });
  // click the world to capture the mouse like a real FPS; Esc releases it.
  // Chrome refuses re-lock for ~1.25s after an Esc-exit and REJECTS the promise
  // it returns (try/catch cannot see that) -> swallow the rejection quietly.
  let lockCooldownUntil = 0;
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) lockCooldownUntil = performance.now() + 1300;
  });
  canvas.addEventListener('click', () => {
    if (app.screen === 'game' && !touch.on && renderer.fp && !app.locked && canvas.requestPointerLock && performance.now() > lockCooldownUntil) {
      try {
        const pr = canvas.requestPointerLock();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      } catch (e) {}
    }
  });
  document.addEventListener('pointerlockchange', () => { app.locked = document.pointerLockElement === canvas; });
  document.addEventListener('pointerlockerror', () => { app.locked = false; });
  canvas.addEventListener('mousedown', e => { AU.init(); AU.resume(); if (e.button === 0) mouse.down = true; if (e.button === 2) input.melee = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) input.melee = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
  /** Keeps the thumb cluster in sync with the sim (cooldown ring, context label). */
  function updateTouchHud(me) {
    if (!touch.on) return;
    const hero = me ? D.SURVIVORS[me.hero] : null;
    const cd = hero && hero.ability ? hero.ability.cd : 1;
    const ab = $('tAbility');
    if (ab) {
      const left = me ? (me.ab || 0) : 0;
      const ready = !!me && !me.dn && !me.dd && left <= 0;
      ab.style.setProperty('--cd', left > 0 ? ((left / cd) * 100).toFixed(1) : '0');
      ab.classList.toggle('rdy', ready);
      const ring = ab.querySelector('.ring');
      if (ring) ring.style.display = left > 0 ? 'block' : 'none';
    }
    const use = $('tUse');
    if (use) {
      let label = 'USE';
      if (me && me.pn > 0) label = 'BREAK';
      else if (me && me.it) label = me.it.kind === 'revive' ? 'REVIVE' : me.it.kind === 'generator' ? 'POWER' : me.it.kind === 'loot' ? 'TAKE' : 'PICKUP';
      const b = use.querySelector('b');
      if (b && b.textContent !== label) b.textContent = label;
      use.classList.toggle('hi', !!(me && (me.it || me.pn > 0)));
    }
    const sw = $('tSwap');
    if (sw) {
      const has = !!(me && me.w2);
      sw.disabled = !has;
      sw.classList.toggle('hi', has);
      const b = sw.querySelector('b');
      const t = has ? shortName((D.WEAPONS[me.w2] || {}).name) : 'SWAP';
      if (b && b.textContent !== t) b.textContent = t;
    }
    const th = $('tThrow');
    if (th) {
      const has = !!(me && me.tn > 0);
      th.disabled = !has;
      th.classList.toggle('hi', has);
      const b = th.querySelector('b');
      const t = has ? 'THROW x' + me.tn : 'THROW';
      if (b && b.textContent !== t) b.textContent = t;
    }
    const rld = $('tReload');
    if (rld) rld.classList.toggle('pressed', !!(me && me.rl > 0));
    const spr = $('tSprint');
    if (spr) spr.classList.toggle('on', !!touch.sprint);
    const fir = $('tFire');
    if (fir) fir.classList.toggle('pressed', !!input.fire);
  }

  /* ================= TOUCH / MOBILE (landscape) =================
     Twin stick: left pad moves, right pad aims (and auto-fires while
     deflected). Ability / reload / use / melee / sprint sit in a thumb
     cluster. Everything is pointer-event driven with a touch fallback. */
  const PE = typeof window !== 'undefined' && !!window.PointerEvent;
  const DOWN = PE ? 'pointerdown' : 'touchstart', MOVE = PE ? 'pointermove' : 'touchmove';
  const UP = PE ? 'pointerup' : 'touchend', CANCEL = PE ? 'pointercancel' : 'touchcancel';
  /**
   * True only when the PRIMARY pointer is a finger. A touchscreen laptop still
   * reports 'ontouchstart', so asking for (pointer: fine) first keeps mouse aim
   * working there. ?touch=1 / ?touch=0 forces it either way.
   */
  function seatToken() {
    if (app.token) return app.token;
    try { app.token = sessionStorage.getItem('agawbuhay.seat') || null; } catch (e) {}
    return app.token;
  }
  function detectTouch() {
    try {
      const q = new URLSearchParams(location.search).get('touch');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
    } catch (e) {}
    const mm = typeof matchMedia === 'function' ? matchMedia.bind(window) : null;
    if (mm) {
      if (mm('(pointer: fine)').matches) return false;
      if (mm('(pointer: coarse)').matches) return true;
    }
    // last resort: both signals together (jsdom and odd browsers report one alone)
    return ('ontouchstart' in window) && (navigator.maxTouchPoints || 0) > 0;
  }
  const touch = {
    on: detectTouch(),
    move: { id: null, x: 0, y: 0 },
    aim: { id: null, x: 0, y: 0 },
    fire: false, use: false, sprint: false,
    abilityT: 0, meleeT: 0, reloadT: 0, swapT: 0, throwT: 0,
    autoFire: true, assist: true, fsTried: false
  };
  function allPts(e) {
    if (PE) return [{ id: e.pointerId, x: e.clientX, y: e.clientY }];
    const out = [], list = e.changedTouches || e.touches || [];
    for (const t of list) out.push({ id: t.identifier, x: t.clientX, y: t.clientY });
    return out;
  }
  function bindPad(id, st) {
    const el = $(id); if (!el) return;
    const knob = el.querySelector('i');
    const place = p => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = Math.max(8, r.width / 2);
      let dx = p.x - cx, dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      st.x = dx / max; st.y = dy / max;
      if (knob) knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    };
    el.addEventListener(DOWN, e => {
      if (window.ABAW_HUDL && ABAW_HUDL.editing) return;      // layout editor owns the pointer
      if (st.id !== null) return;
      const p = allPts(e)[0]; if (!p) return;
      st.id = p.id; el.classList.add('active'); place(p);
      AU.init(); AU.resume(); goFullscreen();
      e.preventDefault();
    }, { passive: false });
    addEventListener(MOVE, e => {
      if (st.id === null) return;
      for (const p of allPts(e)) if (p.id === st.id) { place(p); if (e.cancelable) e.preventDefault(); }
    }, { passive: false });
    const end = e => {
      if (st.id === null) return;
      for (const p of allPts(e)) if (p.id === st.id) {
        st.id = null; st.x = 0; st.y = 0;
        el.classList.remove('active');
        if (knob) knob.style.transform = 'translate(0,0)';
      }
    };
    addEventListener(UP, end); addEventListener(CANCEL, end);
  }
  function bindBtn(id, down, up) {
    const el = $(id); if (!el) return;
    el.addEventListener(DOWN, e => {
      if (window.ABAW_HUDL && ABAW_HUDL.editing) return;      // layout editor owns the pointer
      const p = allPts(e)[0];
      el._pid = p ? p.id : 0;
      el.classList.add('pressed');
      AU.init(); AU.resume(); goFullscreen();
      if (down) down();
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const release = e => {
      if (el._pid === undefined || el._pid === null) return;
      for (const p of allPts(e)) if (p.id === el._pid) {
        el._pid = null; el.classList.remove('pressed');
        if (up) up();
      }
    };
    addEventListener(UP, release); addEventListener(CANCEL, release);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  /* iPhone/iPad report odd platform strings: iPadOS says "MacIntel", so pair a
     Mac platform with touch points. */
  function isIOS() {
    const p = navigator.platform || navigator.userAgent || '';
    if (/iPhone|iPod|iPad/.test(p)) return true;
    return /Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1;
  }
  function isStandalone() {
    if (navigator.standalone === true) return true;
    if (!window.matchMedia) return false;
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  }
  function canFullscreen() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
  }

  /** Best-effort immersive fullscreen + landscape lock.
      Browsers only allow this from a user gesture and frequently refuse the
      first attempt, so instead of trying exactly once we keep trying on every
      gesture until one sticks. On iPhone Safari there is no fullscreen API at
      all, so goFullscreen() hands over to the Add-to-Home-Screen hint. */
  function goFullscreen() {
    if (!touch.on || touch.fsOk) return;
    if (!canFullscreen()) { maybeIosHint(); return; }
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
      try {
        const p = req.call(el);
        if (p && p.then) p.then(() => { touch.fsOk = true; }, () => {});
        else touch.fsOk = true;
      } catch (e) {}
    }
    try {
      const o = window.screen && screen.orientation;
      if (o && o.lock) { const p = o.lock('landscape'); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }

  /** iPhone Safari cannot hide its own bar from a web page -- that is an Apple
      platform rule, not something code can override. The one true fullscreen on
      iPhone is Add to Home Screen, which our manifest + apple-mobile-web-app
      meta tags already support. So when someone on iPhone asks for fullscreen,
      tell them the two taps that actually work instead of doing nothing. */
  function maybeIosHint() {
    if (!touch.on || !isIOS() || isStandalone() || canFullscreen()) return;
    try { if (localStorage.getItem('abaw-fs-hint') === '1') return; } catch (e) {}
    if (document.getElementById('ioshint')) return;
    const bar = document.createElement('div');
    bar.id = 'ioshint';
    bar.innerHTML =
      '<b>Tunay na full screen sa iPhone</b>' +
      '<span>Hindi kayang itago ng kahit anong web page ang top bar ng Safari. ' +
      'Pindutin ang <b>Share</b> &#8594; <b>Add to Home Screen</b>, tapos buksan ang icon mula sa home screen: ' +
      'wala nang Safari bar, landscape agad.</span>' +
      '<span class="en">iPhone Safari will not let a web page hide its own bar. Tap ' +
      'Share &#8594; "Add to Home Screen", then launch the icon from your home screen for a true chrome-free, landscape game.</span>' +
      '<button id="ioshintx">OK, gets ko</button>';
    document.body.appendChild(bar);
    const kill = () => { if (bar.parentNode) bar.parentNode.removeChild(bar); try { localStorage.setItem('abaw-fs-hint', '1'); } catch (e) {} };
    const bx = bar.querySelector('#ioshintx');
    if (bx) bx.addEventListener('click', kill);
    setTimeout(kill, 16000);
  }
  function defaultTier() {
    if (!touch.on) return 'high';
    const dpr = window.devicePixelRatio || 1;
    const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    if (mem <= 3 || cores <= 4 || shortSide * dpr < 780) return 'low';
    return 'medium';
  }
  function setQuality(t, quiet) {
    if (!renderer.TIERS || !renderer.TIERS[t]) t = 'high';
    renderer.setTier(t);
    settings.quality = t; save();
    const b = $('tQuality'); if (b) b.textContent = 'GFX ' + t.toUpperCase();
    if (!quiet) toast('Graphics: ' + t.toUpperCase());
  }
  function cycleQuality() {
    const order = ['low', 'medium', 'high'];
    settings.qualityAuto = false;
    setQuality(order[(order.indexOf(renderer.tier) + 1) % order.length]);
  }
  function updateOrientation() {
    const portrait = innerHeight > innerWidth * 1.02;
    document.body.classList.toggle('portrait', portrait && touch.on);
    // never let a phone fight a horde face-down in a pocket
    if (portrait && touch.on && app.screen === 'game' && !app.paused) togglePause();
    return portrait;
  }
  /** Soft aim assist: lock the nearest creature roughly in front (touch only). */
  function assistTarget(me) {
    const s = app.lastSnap;
    if (!s || !s.en || !me) return null;
    const fx = Math.cos(me.a), fy = Math.sin(me.a);
    let best = null, bs = Infinity;
    for (const e of s.en) {
      const dx = e.x - me.x, dy = (e.y - 12) - me.y;
      const d = Math.hypot(dx, dy);
      if (d > 620 || d < 1) continue;
      const dot = (dx * fx + dy * fy) / d;
      const score = d * (dot > 0.15 ? 1 : 1.8);
      if (score < bs) { bs = score; best = { dx, dy, d }; }
    }
    return best;
  }
  function initTouch() {
    document.body.classList.toggle('touch', touch.on);
    bindPad('tMove', touch.move);
    bindPad('tAim', touch.aim);
    bindBtn('tFire', () => { touch.fire = true; }, () => { touch.fire = false; });
    bindBtn('tUse', () => { touch.use = true; }, () => { touch.use = false; });
    bindBtn('tMelee', () => { touch.meleeT = 0.22; });
    bindBtn('tReload', () => { touch.reloadT = 0.3; });
    bindBtn('tAbility', () => { touch.abilityT = 0.22; });
    bindBtn('tSwap', () => { touch.swapT = 0.22; });
    bindBtn('tThrow', () => { touch.throwT = 0.22; });
    bindBtn('tSprint', () => {
      touch.sprint = !touch.sprint;
      const b = $('tSprint'); if (b) b.classList.toggle('on', touch.sprint);
      AU.SFX.ui('click');
    });
    bindBtn('tPause', () => togglePause());
    bindBtn('tQuality', () => cycleQuality());
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('gesturechange', e => e.preventDefault());
    document.addEventListener('dblclick', e => { if (touch.on) e.preventDefault(); });
    addEventListener('contextmenu', e => { if (touch.on && app.screen === 'game') e.preventDefault(); });
    addEventListener('resize', () => updateOrientation());
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', () => { renderer.resize(); updateOrientation(); });
    }
    addEventListener('orientationchange', () => setTimeout(() => { updateOrientation(); renderer.resize(); }, 240));
    updateOrientation();
    if (settings.qualityAuto === undefined) settings.qualityAuto = true;
    setQuality(settings.quality || defaultTier(), true);
    if (!touch.on) return;
    // any first tap anywhere should try to go immersive
    // not { once: true }: many browsers refuse the first request, so keep
    // asking on every gesture until one is accepted (goFullscreen early-returns
    // once it has succeeded, so this is cheap)
    addEventListener(DOWN, () => goFullscreen(), { passive: true });
  }

  const input = { mx: 0, my: 0, aimx: 1, aimy: 0, fire: false, sprint: false, reload: false, ability: false, interact: false, melee: false, touchX: 0, touchY: 0 };
  function gatherInput() {
    const FP = !!renderer.fp;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    let tilt = 0;
    if (touch.on && touch.move.id !== null) { mx = touch.move.x; my = touch.move.y; }
    else if (input.touchX || input.touchY) { mx = input.touchX; my = input.touchY; }
    tilt = Math.hypot(mx, my);
    const l = tilt;
    if (l > 1) { mx /= l; my /= l; }

    if (FP) {
      /* First person: the stick/keys give LOCAL move (my<0 = forward) and the
         horizontal axis of the aim stick / mouse gives TURN. Yaw is owned by the
         client and applied instantly (it is never waited-on from the server),
         which is what keeps an FP view from feeling like it swims. */
      let turn = 0;
      if (touch.on && touch.aim.id !== null) turn = Math.max(-1, Math.min(1, touch.aim.x));
      if (!touch.on) {
        if (keys.KeyQ || keys.ArrowLeft) turn -= 1;           // keyboard turn fallback
        if (keys.KeyE || keys.ArrowRight) turn += 1;
      }
      app.turn = turn;
      if (!touch.on) {                                         // mouse-look: raw counts -> yaw
        app.yaw += (app.lookDX || 0) * (settings.sens || 0.0026);
        app.lookDX = 0;
      }
      if (turn) app.yaw += turn * (touch.on ? 2.7 : 2.3) * (app.frameDt || 1 / 60);
      /* Pitch is PRESENTATION-only (the sim aims in 2D yaw): mouse Y or the
         right stick's vertical axis tilt the camera; the 3D renderer consumes
         the delta and adds the Manananggal look-up assist on top. */
      const psens = (settings.sens || 0.0026);
      if (!touch.on) { app.pitchDelta -= (app.lookDY || 0) * psens * 0.85; app.lookDY = 0; }
      else if (touch.aim.id !== null && touch.aim.y) app.pitchDelta -= touch.aim.y * 2.1 * (app.frameDt || 1 / 60);
      const fwd = -my, str = mx;
      const cy = Math.cos(app.yaw), sy = Math.sin(app.yaw);
      input.mx = cy * fwd - sy * str;
      input.my = sy * fwd + cy * str;
      renderer.fpMoving = (Math.abs(fwd) + Math.abs(str)) > 0.1;
      renderer.yaw = app.yaw;
      renderer.pitchInput = (renderer.pitchInput || 0) + app.pitchDelta;
      app.pitchDelta = 0;
    } else {
      input.mx = mx; input.my = my;
    }
    const me = meSurvivor();

    // ---- aim ----
    let aimed = false;
    const aimDeflect = touch.on && touch.aim.id !== null ? Math.hypot(touch.aim.x, touch.aim.y) : 0;
    if (FP) {
      // you shoot where you look... on touch, idle aim pad = bullet magnetism
      if (touch.on && touch.aim.id === null && me) {
        const t = assistTarget(me);
        if (t) { input.aimx = t.dx / t.d; input.aimy = t.dy / t.d; aimed = true; }
      }
      if (!aimed) { input.aimx = Math.cos(app.yaw); input.aimy = Math.sin(app.yaw); aimed = true; }
    } else if (touch.on) {
      if (aimDeflect > 0.2) { input.aimx = touch.aim.x / aimDeflect; input.aimy = touch.aim.y / aimDeflect; aimed = true; }
      if (!aimed && touch.assist && me) {
        const t = assistTarget(me);
        if (t) { input.aimx = t.dx / t.d; input.aimy = t.dy / t.d; aimed = true; }
      }
      if (!aimed && me) { input.aimx = Math.cos(me.a); input.aimy = Math.sin(me.a); }
    } else {
      // aim toward the mouse in world space
      const z = renderer.cam.zoom * (renderer.w < 700 ? 0.82 : 1);
      const wx = renderer.cam.x + (mouse.x - renderer.w / 2) / z;
      const wy = renderer.cam.y + (mouse.y - renderer.h / 2) / z;
      mouse.wx = wx; mouse.wy = wy;
      if (me) {
        const ax = wx - me.x, ay = wy - (me.y - 18);
        if (Math.hypot(ax, ay) > 6) { input.aimx = ax; input.aimy = ay; }
        else { input.aimx = Math.cos(me.a); input.aimy = Math.sin(me.a); }
      }
    }

    // ---- buttons ----
    if (touch.on) {
      touch.abilityT = Math.max(0, touch.abilityT - 1 / 60);
      touch.meleeT = Math.max(0, touch.meleeT - 1 / 60);
      touch.reloadT = Math.max(0, touch.reloadT - 1 / 60);
      touch.swapT = Math.max(0, touch.swapT - 1 / 60);
      touch.throwT = Math.max(0, touch.throwT - 1 / 60);
    }
    // auto-fire while the aim stick is deflected (thumb cannot reach FIRE and aim at once)
    input.fire = (touch.on ? (touch.fire || (touch.autoFire && aimDeflect > 0.2)) : mouse.down) && !app.paused;
    if (renderer.fp) { if (input.fire && !app.prevFire) renderer.fpMuzzle = 0.07; app.prevFire = input.fire; }
    input.sprint = !!(keys.ShiftLeft || keys.ShiftRight) || (touch.on && (touch.sprint || tilt > 0.94));
    input.ability = !!keys.Space || touch.abilityT > 0;
    input.interact = !!keys.KeyE || touch.use;
    if (touch.reloadT > 0) input.reload = true;
    // swap / throw are edge actions: latch them until the sim or the network
    // actually consumes them, so a tap between 30Hz packets is never dropped
    if (input.swapQueued || touch.swapT > 0) { input.swapLatch = true; input.swapQueued = false; }
    if (input.throwQueued || touch.throwT > 0) { input.throwLatch = true; input.throwQueued = false; }
    input.swap = !!input.swapLatch;
    input.throw = !!input.throwLatch;
    input.melee = !!input.melee || !!keys.KeyF || touch.meleeT > 0;
    if (keys.KeyF) input.melee = true; else if (!mouse.down && touch.meleeT <= 0) input.melee = input.melee && keys.KeyF;
    return input;
  }
  function meSurvivor() {
    const s = app.lastSnap;
    if (!s) return null;
    return s.surv.find(x => x.id === app.you) || null;
  }

  /* Carried gear: slot 2, throwables, armour. */
  function shortName(n) { const p = String(n || '').split(' '); return (p.length > 1 ? p[p.length - 1] : p[0]).toUpperCase(); }
  function updateGearHud(me) {
    const g2 = $('gslot2');
    if (g2) {
      const w2 = me.w2 ? D.WEAPONS[me.w2] : null;
      g2.classList.toggle('empty', !w2);
      $('gslot2n').textContent = w2 ? shortName(w2.name) : 'EMPTY';
      $('gslot2a').textContent = w2 ? (me.m2 + '/' + me.r2) : '[Q]';
    }
    const gt = $('gthrow');
    if (gt) {
      const t = me.th ? D.THROWABLES[me.th] : null;
      gt.classList.toggle('empty', !t);
      $('gthrown').textContent = t ? 'x' + me.tn : '0';
      $('gthrowk').textContent = t ? shortName(t.name) : 'NONE';
    }
    const ga = $('garmor');
    if (ga) {
      ga.classList.toggle('empty', !(me.ar > 0));
      $('garmorn').textContent = Math.round(me.ar || 0);
    }
  }

  /* ================= HUD ================= */
  const hud = { el: {}, t: 0 };
  function updateHud(dt) {
    const hudEl = $('hud');
    if (hudEl) hudEl.classList.toggle('fpmode', !!renderer.fp);
    const s = app.lastSnap;
    if (!s) return;
    const me = meSurvivor();
    // top-left
    $('stageTag').textContent = 'Act ' + (app.stage ? app.stage.act || 1 : 1) + ' · ' + s.stage;
    $('stageName').textContent = app.stage ? app.stage.name : '';
    $('scoreVal').innerHTML = (s.sc || 0).toLocaleString() + ' <small>· ' + s.kl + ' kills</small>';
    const ten = s.dir ? s.dir.i : 0;
    $('tension').firstElementChild.style.width = clamp(ten / 3 * 100, 4, 100) + '%';
    const tname = ten < 0.7 ? 'CALM' : ten < 1.2 ? 'RESTLESS' : ten < 1.8 ? 'HUNTING' : ten < 2.4 ? 'FRENZY' : 'APEX HORROR';
    $('tensionVal').textContent = tname + (s.dir && s.dir.peak ? ' · PEAK' : '');
    $('tensionVal').style.color = ten < 1.2 ? '#4ade80' : ten < 2 ? '#ffb02e' : '#e0263f';
    $('pingVal').textContent = app.mode === 'net' ? app.ping + 'ms' : 'LOCAL';
    $('timeVal').textContent = fmtTime(s.time);
    // objective
    const o = s.obj;
    if (o) {
      $('objlabel').textContent = o.label || '';
      $('objbar').firstElementChild.style.width = clamp((o.p || 0) * 100, 0, 100) + '%';
      let sub = 'Objective ' + (o.idx + 1) + ' / ' + o.total;
      if (o.type === 'hold') sub = 'HOLD — ' + Math.max(0, Math.ceil((1 - (o.hp || 0)) * (app.stage && app.stage.flow[o.idx] ? app.stage.flow[o.idx].holdTime : 60))) + 's';
      if (o.type === 'extract') sub = 'EXTRACTION — ' + Math.max(0, Math.ceil((1 - (o.p || 0)) * (app.stage && app.stage.flow[o.idx] ? app.stage.flow[o.idx].extractTime : 70))) + 's';
      if (o.type === 'objective') sub = 'GENERATORS ' + (o.cnt || 0) + '/' + (app.stage.flow[o.idx].count || 2);
      $('objsub').textContent = sub;
    }
    // boss bar
    const bb = $('bossbar');
    if (s.boss || s.bossBody) {
      bb.style.display = 'block';
      const body = s.bossBody && (!s.boss || s.boss.ph === 2);
      bb.classList.toggle('body', !!body);
      const src = body ? s.bossBody : s.boss;
      bb.querySelector('.bn').textContent = body ? 'Manananggal — Lower Half' : 'Manananggal' + (s.boss && s.boss.ph === 2 ? ' (Torso — nearly immune)' : '');
      bb.querySelector('.bt i').style.transform = 'scaleX(' + clamp(src.hp / src.mhp, 0, 1) + ')';
    } else bb.style.display = 'none';
    // squad
    const order = s.surv.slice().sort((a, b) => (a.bot - b.bot) || a.name.localeCompare(b.name));
    order.forEach((sv, i) => {
      const el = $('mate-' + i); if (!el) return;
      const hero = D.SURVIVORS[sv.hero];
      el.style.setProperty('--hc', hero.color);
      el.classList.toggle('down', !!sv.dn && !sv.dd);
      el.classList.toggle('dead', !!sv.dd);
      $('mn-' + i).textContent = (sv.id === app.you ? '▸ ' : '') + sv.name + (sv.bot ? ' ·AI' : '');
      $('mr-' + i).textContent = hero.role;
      $('mhpb-' + i).style.width = clamp(sv.hp / sv.mhp * 100, 0, 100) + '%';
      $('mhpb-' + i).style.background = sv.hp / sv.mhp > .55 ? '#4ade80' : sv.hp / sv.mhp > .25 ? '#ffb02e' : '#e0263f';
      $('mstb-' + i).style.width = clamp(sv.sta / sv.msta * 100, 0, 100) + '%';
      let st = '';
      if (sv.dd) st = '<b>KIA</b>';
      else if (sv.dn) st = '<b>DOWN ' + Math.max(0, Math.ceil(40 - sv.bl)) + 's</b>';
      else if (sv.pn > 0) st = '<b>PINNED</b>';
      else st = sv.k + ' K';
      $('ms-' + i).innerHTML = st;
      // ability ring
      const ab = hero.ability, ring = $('ab-' + i);
      const frac = sv.ab > 0 ? 1 - sv.ab / ab.cd : 1;
      ring.setAttribute('stroke-dashoffset', String(69.1 * (1 - frac)));
      ring.setAttribute('stroke', sv.abA > 0 ? '#4ade80' : frac >= 1 ? hero.accent : '#5a6070');
      $('abt-' + i).textContent = sv.abA > 0 ? 'ON' : sv.ab > 0 ? Math.ceil(sv.ab) : '✓';
    });
    // ammo
    if (me) {
      const hero = D.SURVIVORS[me.hero], w = D.WEAPONS[me.wp] || D.WEAPONS[hero.weapon];
      $('ammo').innerHTML = me.mag + '<small>/' + me.res + '</small>';
      $('ammo').classList.toggle('low', me.mag <= w.mag * 0.25);
      $('wname').textContent = w.name + ' · ' + hero.melee;
      updateGearHud(me);
      const rb = $('reloadbar');
      if (me.rl > 0) { rb.style.display = 'block'; rb.firstElementChild.style.width = (1 - me.rl / w.reload) * 100 + '%'; }
      else rb.style.display = 'none';
      // prompt
      const pr = $('prompt');
      if (me.it) {
        pr.style.opacity = '1';
        const loot = me.it.kind === 'loot';
        const label = me.it.kind === 'revive' ? 'Hold to revive ' + (s.surv.find(x => x.id === me.it.id) || {}).name
          : me.it.kind === 'generator' ? 'Hold to restart generator'
          : loot ? 'Take ' + (me.it.label || 'item') : 'Hold [E]';
        pr.querySelector('.pt').textContent = label;
        pr.querySelector('#promptbar i').style.width = loot ? '100%' : clamp((me.ip || me.it.p || 0) * 100, 0, 100) + '%';
      } else if (me.pn > 0) {
        pr.style.opacity = '1';
        pr.querySelector('.pt').textContent = 'MASH [E] TO BREAK FREE';
        pr.querySelector('#promptbar i').style.width = clamp((1 - me.pn / 4) * 100, 0, 100) + '%';
      } else pr.style.opacity = '0';
      updateTouchHud(me);
      // vignette / low hp
      const hpF = me.hp / me.mhp;
      renderer.lowHp = me.dn ? 0.9 : hpF < 0.4 ? (0.4 - hpF) * 2.2 : 0;
      if (hpF < 0.3 && !me.dd) { hud.t += dt; if (hud.t > (hpF < 0.15 ? 0.75 : 1.25)) { hud.t = 0; AU.SFX.heartbeat(); } }
    }
    // announce
    const an = s.an;
    const anEl = $('announce'), asEl = $('announceSub');
    if (an) { anEl.textContent = an.t; anEl.style.opacity = '1'; asEl.textContent = an.s || ''; asEl.style.opacity = an.s ? '1' : '0'; }
    else { anEl.style.opacity = '0'; asEl.style.opacity = '0'; }
    // crosshair
    const ch = $('crosshair');
    ch.style.left = mouse.x + 'px'; ch.style.top = mouse.y + 'px';
    ch.style.opacity = me && me.dd ? '0' : '.9';
    // director tension -> music
    AU.setTension(s.dir ? s.dir.i * 0.6 + (s.dir.s || 0) * 0.4 : 0);
    // minimap
    if (!renderer.fp) renderer.drawMinimap($('minimap'), s);   // FP draws its own circular minimap
    if (renderer.opts.fps && $('fps')) $('fps').textContent = renderer.stats.fps + ' fps · ' + renderer.stats.ents + ' ents';
    // ?dbg=1 — on-screen diagnostics for field debugging (black-screen reports)
    if (app.dbg) {
      let d = $('dbgbox');
      if (!d) {
        d = document.createElement('div'); d.id = 'dbgbox';
        d.style.cssText = 'position:fixed;right:8px;top:8px;z-index:99;background:rgba(0,0,0,.82);color:#8ef0a0;font:11px/1.5 monospace;padding:8px 10px;border:1px solid #2c9149;border-radius:8px;white-space:pre;pointer-events:none;max-width:46vw';
        document.body.appendChild(d);
      }
      const r = renderer;
      const lay = window.ABAW_HUDL ? JSON.stringify(window.ABAW_HUDL.layout) : 'n/a';
      d.textContent =
        'renderer: ' + (window.ABAW_R3D && r instanceof ABAW_R3D.Renderer3D ? '3D(three)' : 'raycast') +
        (r.contextLost ? ' CONTEXT-LOST' : '') + '\n' +
        'size: ' + r.w + 'x' + r.h + '  fails: ' + (r._drawFails || 0) + '\n' +
        'webgl: ' + (window.ABAW_R3D ? ABAW_R3D.webglAvailable() : false) + '\n' +
        'drawErr: ' + (app.lastDrawError || 'none') + '\n' +
        'hudlayout: ' + lay.slice(0, 160);
    }
  }

  /* ================= CHAT / PAUSE ================= */
  function openChat() { app.chatOpen = true; $('chatinput').style.display = 'block'; $('chatinput').focus(); }
  function closeChat() { app.chatOpen = false; $('chatinput').style.display = 'none'; }
  function addChat(from, text) {
    const el = document.createElement('div');
    el.className = 'chat';
    el.innerHTML = '<b>' + esc(from) + ':</b> ' + esc(text);
    $('chatlog').appendChild(el);
    while ($('chatlog').children.length > 5) $('chatlog').firstChild.remove();
    setTimeout(() => el.remove(), 9000);
  }
  function togglePause() {
    if (app.screen !== 'game') return;
    app.paused = !app.paused;
    $('sc-pause').classList.toggle('hidden', !app.paused);
    const tl = $('touch');
    if (tl) tl.classList.toggle('on', !app.paused && touch.on);
    if (app.paused) {
      mouse.down = false; touch.fire = false; touch.use = false;
      touch.move.id = null; touch.aim.id = null;
      touch.move.x = touch.move.y = touch.aim.x = touch.aim.y = 0;
      AU.SFX.ui('back');
    } else AU.SFX.ui('click');
  }
  function quitRun() {
    app.paused = false; $('sc-pause').classList.add('hidden');
    AU.stopAmbience();
    if (app.mode === 'net') { send({ t: 'leave' }); app.room = null; app.mode = null; show('title'); }
    else { app.sim = null; app.mode = null; show('title'); }
    app.lastSnap = null;
    app.pred = null; app.predOff = null; app.pend.length = 0; app.curSample = null; app.iseq = 0;
    renderer.predOwn = null;
    renderer.buf.length = 0;
  }

  /* ================= MAIN LOOP ================= */
  let last = performance.now(), netAcc = 0, pingAcc = 0;
  /* Tile under a world point -> footstep/acoustic surface name (master doc §29). */
  function surfAt(p) {
    const L = (renderer && (renderer.level || (renderer.kit && renderer.kit.level))) || app.level;
    if (!L || !LV.tileAt) return 'concrete';
    const t = LV.tileAt(L, p.x, p.y), T = D.TILE;
    if (t === T.WATER) return 'water';
    if (t === T.RAIL) return 'metal';
    if (t === T.ROAD) return 'asphalt';
    if (t === T.RUBBLE) return 'rubble';
    return 'concrete';
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    app.frameDt = dt;
    if (window.ABAW_HUDL && ABAW_HUDL.editing) {              // HUD layout editor: live preview only
      if (app.screen === 'game' && renderer && renderer.draw) { try { renderer.draw(now, dt); } catch (e) {} }
      requestAnimationFrame(loop);
      return;
    }
    if (app.screen === 'game') {
      // seed the view yaw from wherever the survivor was already facing
      if (!app.yawInit && app.lastSnap && app.lastSnap.surv) {
        const m0 = app.lastSnap.surv.find(x => x.id === app.you);
        if (m0) { app.yaw = m0.a; app.yawInit = true; app.pitch = 0; app.pitchDelta = 0; renderer.pitch = 0; renderer.pitchInput = 0; }
      }
      const inp = gatherInput();
      if (app.paused) { inp.fire = false; inp.mx = 0; inp.my = 0; }
      if (app.mode === 'local' && app.sim) {
        app.localAcc = (app.localAcc || 0) + dt;
        let guard = 0;
        let fx = [];
        while (app.localAcc >= 1 / 60 && guard++ < 5) {
          const inputs = {};
          inputs[app.you] = app.paused ? {} : Object.assign({}, inp);
          app.sim.update(1 / 60, inputs);
          fx = fx.concat(app.sim.takeFx());
          app.localAcc -= 1 / 60;
        }
        if (guard > 0) { inp.swapLatch = false; inp.throwLatch = false; }
        const snap = app.sim.snapshot();
        snap.you = app.you;
        snap.fxp = fx;
        renderer.push(snap, true);
        app.lastSnap = snap;
        // sim wipes fx each cleanup — capture before
        if (app.sim.phase === 'victory' || app.sim.phase === 'defeat') {
          if (!app.ended) {
            app.ended = true;
            onEnd({
              phase: app.sim.phase, reason: app.sim.defeatReason, score: app.sim.score, kills: app.sim.kills,
              time: app.sim.time,
              survivors: app.sim.survivors.map(s => ({ name: s.name, hero: s.hero, kills: s.kills, dmg: Math.round(s.dmg), downs: s.downs, revives: s.revives, dead: s.dead ? 1 : 0, bot: s.isBot ? 1 : 0 }))
            });
          }
        }
      } else if (app.mode === 'net') {
        // ---- phase 2: integrate our own movement on THIS frame so the first-person
        // view never waits for a 24 Hz snapshot; reconcile() keeps it honest ----
        const PK = window.ABAW_PREDICT;
        if (PK && renderer.level && !app.pred && app.lastSnap && app.lastSnap.surv) {
          const m0 = app.lastSnap.surv.find(x => x.id === app.you);
          if (m0 && !m0.dd) {
            app.pred = { x: m0.x, y: m0.y, vx: 0, vy: 0 };
            app.predOff = { x: 0, y: 0 };
            const h = D.SURVIVORS[m0.hero];
            app.predSpeed = h && h.stats ? h.stats.speed : 120;
          }
        }
        if (app.pred) {
          if (!app.paused) {
            if (!app.curSample) app.curSample = { mx: inp.mx, my: inp.my, sprint: inp.sprint, hold: 0, seq: 0 };
            else { app.curSample.mx = inp.mx; app.curSample.my = inp.my; app.curSample.sprint = inp.sprint; }
            app.curSample.hold += dt;
            PK.step(LV, renderer.level, app.pred, inp, app.predSpeed, dt);
          }
          const k = Math.exp(-12 * dt);
          app.predOff.x *= k; app.predOff.y *= k;
          renderer.predOwn = { x: app.pred.x + app.predOff.x, y: app.pred.y + app.predOff.y };
        }
        netAcc += dt;
        if (netAcc > 1 / 30) {
          netAcc = 0;
          // seal the held sample with a sequence number, then start a fresh one
          if (app.curSample) {
            app.curSample.seq = ++app.iseq;
            app.pend.push(app.curSample);
            if (app.pend.length > 120) app.pend.shift();
            app.curSample = null;
          }
          send({ t: 'input', i: app.paused ? null : { seq: app.iseq, mx: +inp.mx.toFixed(2), my: +inp.my.toFixed(2), aimx: +inp.aimx.toFixed(2), aimy: +inp.aimy.toFixed(2), fire: inp.fire, sprint: inp.sprint, reload: !!inp.reload, ability: inp.ability, interact: inp.interact, melee: !!inp.melee, swap: !!inp.swap, throw: !!inp.throw } });
          inp.reload = false; inp.melee = false; inp.swapLatch = false; inp.throwLatch = false;
        }
        pingAcc += dt;
        if (pingAcc > 1) { pingAcc = 0; send({ t: 'ping', c: performance.now() }); }
      }
      renderer.predInput = app.paused ? null : { mx: inp.mx, my: inp.my, sprint: inp.sprint };
      try {
        renderer.draw(now, dt);
        renderer._drawFails = 0;
      } catch (err) {
        // a dead draw loop = permanent black screen; degrade instead of dying
        renderer._drawFails = (renderer._drawFails || 0) + 1;
        app.lastDrawError = String(err && err.message || err);
        if (renderer._drawFails === 3 && window.ABAW_R3D && window.ABAW_RENDER && renderer instanceof ABAW_R3D.Renderer3D) {
          try {
            const old = renderer;
            if (old.glCanvas && old.glCanvas.parentNode) old.glCanvas.parentNode.removeChild(old.glCanvas);
            if (old.gl && old.gl.dispose) old.gl.dispose();
            const g2 = $('game'); g2.style.background = '';
            renderer = new ABAW_RENDER.Renderer(g2);
            renderer.opts = old.opts || renderer.opts;
            renderer.yaw = old.yaw || 0;
            if (old.level) renderer.setLevel(old.level);
            toast('3D renderer hit an error — classic view engaged', true);
          } catch (e2) { console.error(e2); }
        } else if (renderer._drawFails > 90) {
          console.error('draw failed repeatedly:', err);
          renderer._drawFails = 0;
        }
      }
      // own-player footsteps: stride accumulator + tile surface (client-side SFX only)
      const fOwn = renderer.ownPos;
      if (fOwn && renderer.fpMoving && !app.paused) {
        const lp = app.lastStepPos;
        app.stepAcc = (app.stepAcc || 0) + (lp ? Math.hypot(fOwn.x - lp.x, fOwn.y - lp.y) : 0);
        app.lastStepPos = { x: fOwn.x, y: fOwn.y };
        const stride = surfAt(fOwn) === 'water' ? 46 : 38;
        if (app.stepAcc >= stride) {
          app.stepAcc = 0;
          AU.SFX.step(fOwn, { x: fOwn.x, y: fOwn.y, yaw: renderer.yaw }, renderer.w || window.innerWidth, surfAt(fOwn));
        }
      } else { app.lastStepPos = null; app.stepAcc = 0; }
      if (settings.qualityAuto) renderer.autoTier(dt * 1000);
      updateHud(dt);
    } else if (app.screen === 'title' || app.screen === 'how' || app.screen === 'lobby') {
      drawMenuBackdrop(dt);
    }
    requestAnimationFrame(loop);
  }
  /* -------- menu backdrop: procedural Manila skyline -------- */
  let skyDrawn = false;
  function drawMenuBackdrop(dt) {
    if (skyDrawn) return;
    skyDrawn = true;
    const c = $('skyCanvas'); if (!c) return;
    const w = c.width = c.clientWidth * 1.2, h = c.height = c.clientHeight * 1.2;
    const x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    // distant glow
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(20,10,18,0)'); g.addColorStop(1, 'rgba(224,38,63,.18)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // 3 layers of skyline
    for (let layer = 0; layer < 3; layer++) {
      const base = h - layer * h * 0.06;
      const alpha = [0.85, 0.6, 0.38][layer];
      x.fillStyle = 'rgba(6,8,14,' + alpha + ')';
      let px = -20;
      while (px < w + 40) {
        const bw = 24 + Math.random() * 70, bh = (40 + Math.random() * (150 + layer * 60)) * (h / 400);
        x.fillRect(px, base - bh, bw, bh + 40);
        // windows
        if (layer < 2) {
          for (let wy = base - bh + 8; wy < base - 8; wy += 12) {
            for (let wx2 = px + 5; wx2 < px + bw - 6; wx2 += 10) {
              if (Math.random() < 0.16) {
                x.fillStyle = Math.random() < 0.25 ? 'rgba(255,120,60,.55)' : 'rgba(255,214,140,.35)';
                x.fillRect(wx2, wy, 4, 5);
                x.fillStyle = 'rgba(6,8,14,' + alpha + ')';
              }
            }
          }
        }
        // antenna
        if (Math.random() < 0.25) { x.fillRect(px + bw / 2, base - bh - 22, 2, 22); x.fillStyle = 'rgba(255,60,60,.8)'; x.fillRect(px + bw / 2 - 1, base - bh - 25, 4, 4); x.fillStyle = 'rgba(6,8,14,' + alpha + ')'; }
        px += bw + 4 + Math.random() * 16;
      }
    }
    // flood water reflection
    x.fillStyle = 'rgba(10,14,22,.9)'; x.fillRect(0, h - 26, w, 26);
    x.fillStyle = 'rgba(255,180,120,.07)';
    for (let i = 0; i < 60; i++) x.fillRect(Math.random() * w, h - 24 + Math.random() * 20, 8 + Math.random() * 26, 1.4);
  }

  /* ================= WIRING ================= */
  function tog(id, onChange) {
    const el = $(id);
    el.onclick = () => { el.classList.toggle('on'); AU.SFX.ui('click'); onChange && onChange(el.classList.contains('on')); };
  }
  function bindButtons() {
    const click = (id, fn) => { const el = $(id); if (el) el.onclick = () => { AU.init(); AU.resume(); AU.SFX.ui('click'); fn(); }; };
    click('btnQuick', () => { if (!requireNet()) return; send({ t: 'quick', token: seatToken() }); loading(true, 'Matchmaking', 'Quick Join — searching for an active session…'); setTimeout(() => loading(false), 900); });
    click('btnHost', () => { if (!requireNet()) return; show('host'); });
    click('btnFind', () => { if (!requireNet()) return; show('find'); send({ t: 'browse' }); renderRooms(); });
    click('btnSolo', () => show('solo'));
    click('btnHow', () => show('how'));
    click('btnAuth', () => { $('authName').value = profile.name; show('auth'); });
    click('btnHowBack', () => show('title'));
    click('btnAuthBack', () => show('title'));
    click('btnHostBack', () => show('title'));
    click('btnFindBack', () => show('title'));
    click('btnSoloBack', () => show('title'));
    click('btnGuest', () => { profile.name = ($('authName').value || profile.name).slice(0, 18); profile.provider = 'guest'; save(); send({ t: 'profile', name: profile.name, provider: 'guest' }); toast('Signed in as guest: ' + profile.name); show('title'); });
    click('btnGoogle', () => mockOAuth('Google'));
    click('btnDiscord', () => mockOAuth('Discord'));
    click('btnCreate', () => {
      send({
        t: 'host', stage: $('hStage').value, act: +$('hAct').value, difficulty: $('hDiff').value,
        ff: $('hFF').classList.contains('on'), privacy: $('hPriv').classList.contains('on') ? 'private' : 'public',
        playstyle: $('hStyle').value, bots: $('hBots').classList.contains('on')
      });
    });
    click('btnRefresh', () => { send({ t: 'browse' }); toast('Refreshing sessions…'); });
    click('btnJoinCode', () => { const c = $('fCode').value.trim().toUpperCase(); if (!c) return toast('Enter a session code', true); send({ t: 'join', code: c, token: seatToken() }); });
    click('btnStart', () => send({ t: 'start' }));
    click('btnLeave', () => { if (app.mode === 'net' && app.screen === 'game') quitRun(); else { send({ t: 'leave' }); app.room = null; show('title'); } });
    click('btnSoloStart', () => startSolo());
    if (window.ABAW_HUDL) ABAW_HUDL.init();
    click('btnHudLayout', () => {
      if (!window.ABAW_HUDL) return;
      if (app.paused) togglePause();
      ABAW_HUDL.startEdit({ onDone: saved => toast(saved ? 'HUD layout saved to this device' : 'HUD layout unchanged') });
    });
    click('btnResume', () => togglePause());
    click('btnQuit', () => quitRun());
    // host-controlled lobby settings
    $('lbStageSel').onchange = e => send({ t: 'cfg', stage: e.target.value });
    $('lbDiffSel').onchange = e => send({ t: 'cfg', difficulty: e.target.value });
    tog('hFF'); tog('hPriv'); tog('hBots'); tog('sFF');
    tog('lbFFtog', v => send({ t: 'cfg', ff: v }));
    tog('setShake', v => { settings.shake = v; renderer.opts.shake = v; save(); });
    tog('setDmg', v => { settings.dmg = v; renderer.opts.dmg = v; save(); });
    tog('setFps', v => { settings.fps = v; renderer.opts.fps = v; const f = $('fps'); if (f) f.style.display = v ? 'block' : 'none'; save(); });
    tog('setAutoQ', v => { settings.qualityAuto = v; save(); if (v) renderer.slowFrames = 0; });
    $('setQual').onchange = e => { settings.qualityAuto = false; setQuality(e.target.value); save(); };
    click('btnFull', () => { touch.fsOk = false; goFullscreen(); if (canFullscreen()) toast('Full screen requested'); });
    $('setVol').oninput = e => { settings.vol = e.target.value / 100; AU.setVolume(settings.vol); $('volVal').textContent = e.target.value + '%'; save(); };
    $('setVol').value = Math.round(settings.vol * 100);
    $('volVal').textContent = Math.round(settings.vol * 100) + '%';
    $('setShake').classList.toggle('on', settings.shake);
    $('setDmg').classList.toggle('on', settings.dmg);
    $('setFps').classList.toggle('on', settings.fps);
    if (settings.qualityAuto === undefined) settings.qualityAuto = true;
    $('setAutoQ').classList.toggle('on', !!settings.qualityAuto);
    $('setQual').value = renderer.tier || settings.quality || 'high';
    const th = $('touchHint'); if (th) th.style.display = touch.on ? 'block' : 'none';
    if ($('fps')) $('fps').style.display = settings.fps ? 'block' : 'none';
    $('authName').value = profile.name;
    // filters
    ['fStage', 'fPing', 'fStyle'].forEach(id => $(id).onchange = () => renderRooms());
    document.addEventListener('click', e => { if (e.target.closest('.btn')) AU.resume(); });
  }
  function mockOAuth(provider) {
    loading(true, 'Signing in', 'Contacting ' + provider + '… (demo simulation — no credentials are exchanged)');
    setTimeout(() => {
      loading(false);
      profile.provider = provider.toLowerCase();
      profile.name = provider === 'Google' ? 'JuanDelaCruz' : 'ManilaSurvivor';
      $('authName').value = profile.name;
      save(); send({ t: 'profile', name: profile.name, provider: profile.provider });
      toast('Signed in with ' + provider + ' — cloud saves enabled (demo)');
      show('title');
    }, 900);
  }
  function requireNet() {
    if (app.net === 'online') return true;
    toast('Co-op server unreachable — use Single Player, or start server/index.js', true);
    AU.SFX.ui('error');
    return false;
  }
  function renderRooms() {
    const fs = $('fStage').value, fp = +$('fPing').value, fst = $('fStyle').value;
    const list = app.rooms.filter(r => (!fs || r.stage === fs) && r.ping <= fp && (!fst || r.playstyle === fst));
    $('roomList').innerHTML = list.length ? list.map(r => `
      <div class="room" data-code="${r.code}">
        <div class="st ${r.state}">${r.state}</div>
        <div><div class="nm">${esc(r.host)}'s session · <b style="color:#ffb02e">${r.code}</b></div>
        <div class="mt">${r.stage} ${esc(r.stageName)} · ${r.difficulty} · ${r.playstyle} · ${r.ff ? 'friendly fire' : 'no FF'} · progress ${r.progress}%</div></div>
        <div class="pl">${r.players}/4</div>
        <div class="bars">${bars(r.ping)}</div>
      </div>`).join('') : '<div class="hint" style="padding:14px">No sessions match those filters. Host one instead — or hit Quick Join.</div>';
    document.querySelectorAll('.room').forEach(el => el.onclick = () => { AU.SFX.ui('click'); send({ t: 'join', code: el.dataset.code, token: seatToken() }); });
  }
  function bars(ping) {
    const n = ping < 40 ? 4 : ping < 80 ? 3 : ping < 140 ? 2 : 1;
    let s = '';
    for (let i = 0; i < 4; i++) s += `<i class="${i < n ? 'on' : ''}" style="height:${4 + i * 3}px"></i>`;
    return s;
  }

  /* Test/debug hook — read-only view of app state for the headless suites
     and for anyone poking at the client from a console. */
  try {
    window.ABAW_DEBUG = {
      get app() { return app; }, get input() { return input; }, get touch() { return touch; },
      get renderer() { return renderer; }, get settings() { return settings; },
      get profile() { return profile; },
      gatherInput, show, setQuality, togglePause, updateOrientation, goFullscreen
    };
  } catch (e) {}

  /* ================= BOOT ================= */
  function boot() {
    // scoreboard element (injected)
    const sb = document.createElement('div');
    sb.id = 'scoreboard'; sb.className = 'modal hidden';
    sb.innerHTML = '<div class="box"><h2>Squad</h2><div id="sbBody"></div></div>';
    document.getElementById('app').appendChild(sb);
    initTouch();
    bindButtons();
    fillSelects({ stages: D.STAGES.map(s => ({ id: s.id, name: s.name, theme: s.theme, obj: s.objective })), acts: D.ACTS, heroes: D.SURVIVORS, diffs: D.DIFFICULTIES });
    show('title');
    connect();
    setInterval(() => {
      // keep the scoreboard fresh while held
      const sbEl = $('scoreboard');
      if (sbEl && !sbEl.classList.contains('hidden') && app.lastSnap) {
        $('sbBody').innerHTML = app.lastSnap.surv.map(s => {
          const h = D.SURVIVORS[s.hero];
          return `<div class="kv"><span style="color:${h.color}"><b>${esc(s.name)}</b> ${s.bot ? '(AI)' : ''} — ${h.role}</span><b>${s.k} kills · ${s.hp}/${s.mhp} HP${s.dn ? ' · DOWN' : ''}${s.dd ? ' · KIA' : ''}</b></div>`;
        }).join('');
      }
    }, 120);
    requestAnimationFrame(loop);
    setTimeout(() => { if (app.net === 'offline') toast('Co-op server not reachable — Single Player still works offline', true); }, 2200);
  }

  boot();
})();
