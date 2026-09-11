/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  client/audio.js
   100% procedural WebAudio: weapons, creatures, weather, and a
   dynamic tension score driven by the AI Director's intensity.
   ============================================================ */
(function (root) {
  'use strict';
  let AC = null, master = null, sfxBus = null, ambBus = null, musBus = null;
  let noiseBuf = null, started = false, muted = false, volume = 0.7;
  let rainSrc = null, droneNodes = [], tensionNodes = [];
  const rnd = () => Math.random();

  function init() {
    if (started) return;
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    master = AC.createGain(); master.gain.value = volume; master.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
    ambBus = AC.createGain(); ambBus.gain.value = 0.85; ambBus.connect(master);
    musBus = AC.createGain(); musBus.gain.value = 0.0; musBus.connect(master);

    // white-noise buffer (2s) reused everywhere
    const len = AC.sampleRate * 2;
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    started = true;
  }
  function resume() { if (AC && AC.state === 'suspended') AC.resume(); }
  function setVolume(v) { volume = v; if (master) master.gain.value = muted ? 0 : v; }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; }
  const now = () => AC.currentTime;

  function noise(dur, opts) {
    opts = opts || {};
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = opts.rate || 1;
    const g = AC.createGain();
    const f = AC.createBiquadFilter();
    f.type = opts.type || 'bandpass'; f.frequency.value = opts.freq || 900; f.Q.value = opts.q || 1;
    const t = now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain === undefined ? 0.5 : opts.gain, t + (opts.atk || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweep), t + dur);
    src.connect(f); f.connect(g);
    const out = opts.pan !== undefined ? panner(g, opts.pan, opts.vol) : g;
    if (opts.pan === undefined) g.connect(opts.bus || sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
    return g;
  }
  function panner(node, pan, vol) {
    const p = AC.createStereoPanner ? AC.createStereoPanner() : null;
    const g = AC.createGain(); g.gain.value = vol === undefined ? 1 : vol;
    node.connect(g);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(sfxBus); }
    else g.connect(sfxBus);
    return g;
  }
  function tone(freq, dur, opts) {
    opts = opts || {};
    const o = AC.createOscillator(); o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, now());
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), now() + dur);
    const g = AC.createGain();
    const t = now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain === undefined ? 0.3 : opts.gain, t + (opts.atk || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    if (opts.pan !== undefined) panner(g, opts.pan, opts.vol); else g.connect(opts.bus || sfxBus);
    if (opts.vib) {
      const l = AC.createOscillator(), lg = AC.createGain();
      l.frequency.value = opts.vib; lg.gain.value = opts.vibDepth || freq * 0.03;
      l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur);
    }
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  /* ---------- spatial helper: world pos -> pan/vol ---------- */
  function spatial(pos, cam, viewW) {
    if (!pos || !cam) return { pan: 0, vol: 1 };
    const dx = pos.x - cam.x, dy = pos.y - cam.y;
    const d = Math.hypot(dx, dy);
    const pan = Math.max(-1, Math.min(1, dx / (viewW * 0.55)));
    const vol = Math.max(0, Math.min(1, 1 - d / (viewW * 1.5)));
    return { pan, vol: vol * vol * 0.9 + 0.1 };
  }

  /* ---------- SFX library ---------- */
  const SFX = {
    shot(w, pos, cam, viewW) {
      if (!AC) return;
      const s = spatial(pos, cam, viewW);
      if (w === 'shotgun') {
        noise(0.30, { freq: 1500, q: 0.7, gain: 0.85 * s.vol, pan: s.pan, sweep: 240, type: 'lowpass' });
        tone(96, 0.22, { type: 'sine', to: 40, gain: 0.5 * s.vol, pan: s.pan });
      } else if (w === 'rifle') {
        noise(0.13, { freq: 2300, q: 1.1, gain: 0.5 * s.vol, pan: s.pan, sweep: 500 });
        tone(180, 0.09, { type: 'square', to: 60, gain: 0.22 * s.vol, pan: s.pan });
      } else if (w === 'burst') {
        noise(0.10, { freq: 2700, q: 1.4, gain: 0.42 * s.vol, pan: s.pan, sweep: 700 });
        tone(240, 0.07, { type: 'triangle', to: 90, gain: 0.18 * s.vol, pan: s.pan });
      } else { // smg
        noise(0.075, { freq: 3100, q: 1.6, gain: 0.34 * s.vol, pan: s.pan, sweep: 900 });
      }
    },
    dry(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); noise(0.05, { freq: 4200, q: 3, gain: 0.2 * s.vol, pan: s.pan, type: 'highpass' }); },
    reload(pos, cam, viewW) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      noise(0.05, { freq: 2600, q: 4, gain: 0.2 * s.vol, pan: s.pan, type: 'highpass' });
      setTimeout(() => { if (AC) noise(0.06, { freq: 1500, q: 3, gain: 0.22 * s.vol, pan: s.pan }); }, 190);
      setTimeout(() => { if (AC) noise(0.05, { freq: 3200, q: 5, gain: 0.18 * s.vol, pan: s.pan, type: 'highpass' }); }, 420);
    },
    hit(pos, cam, viewW, crit) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      noise(crit ? 0.13 : 0.09, { freq: crit ? 900 : 620, q: 1.2, gain: (crit ? 0.42 : 0.3) * s.vol, pan: s.pan, type: 'lowpass' });
      if (crit) tone(1200, 0.07, { type: 'triangle', to: 700, gain: 0.14 * s.vol, pan: s.pan });
    },
    die(pos, cam, viewW, type) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      noise(0.26, { freq: 420, q: 0.8, gain: 0.32 * s.vol, pan: s.pan, type: 'lowpass', sweep: 120 });
      const base = type === 'tiyanak' ? 720 : type === 'batibat' ? 120 : 300;
      tone(base, 0.34, { type: 'sawtooth', to: base * 0.42, gain: 0.16 * s.vol, pan: s.pan, vib: 16, vibDepth: base * 0.05 });
    },
    cry(pos, cam, viewW) {   // Tiyanak infant cry
      if (!AC) return; const s = spatial(pos, cam, viewW);
      tone(760, 0.5, { type: 'sine', to: 1180, gain: 0.16 * s.vol, pan: s.pan, vib: 9, vibDepth: 40 });
      setTimeout(() => { if (AC) tone(900, 0.42, { type: 'sine', to: 620, gain: 0.13 * s.vol, pan: s.pan, vib: 12, vibDepth: 50 }); }, 240);
    },
    roar(pos, cam, viewW) {  // boss
      if (!AC) return; const s = spatial(pos, cam, viewW);
      tone(72, 1.5, { type: 'sawtooth', to: 34, gain: 0.42 * s.vol, pan: s.pan, vib: 5, vibDepth: 12 });
      noise(1.2, { freq: 380, q: 0.6, gain: 0.3 * s.vol, pan: s.pan, type: 'lowpass', sweep: 90 });
      tone(190, 0.9, { type: 'square', to: 70, gain: 0.1 * s.vol, pan: s.pan });
    },
    screech(pos, cam, viewW) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      tone(1500, 0.4, { type: 'sawtooth', to: 420, gain: 0.16 * s.vol, pan: s.pan, vib: 24, vibDepth: 220 });
    },
    explode(pos, cam, viewW, big) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      noise(big ? 0.9 : 0.5, { freq: 700, q: 0.5, gain: (big ? 0.7 : 0.45) * s.vol, pan: s.pan, type: 'lowpass', sweep: 70 });
      tone(big ? 70 : 110, big ? 0.8 : 0.4, { type: 'sine', to: 28, gain: 0.5 * s.vol, pan: s.pan });
    },
    fire(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); noise(0.5, { freq: 800, q: 0.4, gain: 0.12 * s.vol, pan: s.pan, type: 'lowpass', rate: 0.6 }); },
    pickup(pos, cam, viewW, kind) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      const f = kind === 'medkit' ? [520, 780] : kind === 'adrenaline' ? [620, 940, 1250] : [440, 660];
      f.forEach((x, i) => setTimeout(() => { if (AC) tone(x, 0.13, { type: 'triangle', gain: 0.18 * s.vol, pan: s.pan }); }, i * 62));
    },
    heal(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); tone(380, 0.4, { type: 'sine', to: 720, gain: 0.16 * s.vol, pan: s.pan }); },
    down(pos, cam, viewW) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      tone(300, 0.9, { type: 'sawtooth', to: 70, gain: 0.3 * s.vol, pan: s.pan });
      noise(0.7, { freq: 500, q: 0.6, gain: 0.2 * s.vol, pan: s.pan, type: 'lowpass' });
    },
    heartbeat() {
      if (!AC) return;
      tone(58, 0.16, { type: 'sine', to: 34, gain: 0.5 });
      setTimeout(() => { if (AC) tone(52, 0.14, { type: 'sine', to: 30, gain: 0.36 }); }, 165);
    },
    revive(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); [440, 660, 880].forEach((f, i) => setTimeout(() => { if (AC) tone(f, 0.2, { type: 'triangle', gain: 0.2 * s.vol, pan: s.pan }); }, i * 80)); },
    ability(hero, pos, cam, viewW) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      if (hero === 'berto') { noise(0.5, { freq: 1200, q: 0.5, gain: 0.5 * s.vol, pan: s.pan, type: 'lowpass', sweep: 180 }); tone(120, 0.4, { type: 'sine', to: 40, gain: 0.4 * s.vol, pan: s.pan }); }
      else if (hero === 'rhea') { tone(660, 0.7, { type: 'sine', to: 990, gain: 0.2 * s.vol, pan: s.pan, vib: 6, vibDepth: 18 }); noise(0.5, { freq: 3000, q: 1, gain: 0.1 * s.vol, pan: s.pan, type: 'highpass' }); }
      else if (hero === 'junjun') { noise(0.28, { freq: 2200, q: 0.8, gain: 0.26 * s.vol, pan: s.pan, sweep: 400, type: 'bandpass' }); }
      else { tone(300, 0.3, { type: 'sawtooth', to: 90, gain: 0.2 * s.vol, pan: s.pan }); noise(0.4, { freq: 1400, q: 0.6, gain: 0.24 * s.vol, pan: s.pan, sweep: 300 }); }
    },
    spit(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); noise(0.24, { freq: 900, q: 1.6, gain: 0.24 * s.vol, pan: s.pan, sweep: 300 }); },
    charge(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); tone(90, 0.6, { type: 'sawtooth', to: 240, gain: 0.22 * s.vol, pan: s.pan }); },
    smash(pos, cam, viewW) { if (!AC) return; const s = spatial(pos, cam, viewW); noise(0.4, { freq: 300, q: 0.5, gain: 0.5 * s.vol, pan: s.pan, type: 'lowpass', sweep: 60 }); tone(70, 0.35, { type: 'sine', to: 30, gain: 0.34 * s.vol, pan: s.pan }); },
    step(pos, cam, viewW, water) {
      if (!AC) return; const s = spatial(pos, cam, viewW);
      noise(water ? 0.13 : 0.06, { freq: water ? 1600 : 700, q: water ? 0.8 : 2, gain: (water ? 0.13 : 0.07) * s.vol, pan: s.pan, type: water ? 'bandpass' : 'highpass' });
    },
    horde(cam) {
      if (!AC) return;
      for (let i = 0; i < 7; i++) setTimeout(() => { if (!AC) return; const p = rnd() * 2 - 1; tone(220 + rnd() * 420, 0.9, { type: 'sawtooth', to: 90 + rnd() * 120, gain: 0.05, pan: p, vib: 7, vibDepth: 30 }); }, i * 130);
      noise(1.6, { freq: 500, q: 0.4, gain: 0.14, type: 'lowpass', sweep: 180 });
    },
    ui(kind) {
      if (!AC) return;
      if (kind === 'click') { tone(880, 0.05, { type: 'square', gain: 0.10 }); noise(0.04, { freq: 3000, q: 3, gain: 0.06, type: 'highpass' }); }
      else if (kind === 'hover') tone(1400, 0.03, { type: 'sine', gain: 0.035 });
      else if (kind === 'back') tone(420, 0.07, { type: 'square', gain: 0.08 });
      else if (kind === 'error') { tone(200, 0.16, { type: 'sawtooth', gain: 0.14 }); tone(150, 0.2, { type: 'sawtooth', gain: 0.1 }); }
      else if (kind === 'start') { [330, 440, 550, 660].forEach((f, i) => setTimeout(() => { if (AC) tone(f, 0.3, { type: 'triangle', gain: 0.14 }); }, i * 90)); }
      else if (kind === 'win') { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => { if (AC) tone(f, 0.6, { type: 'sine', gain: 0.16 }); }, i * 140)); }
      else if (kind === 'lose') { [220, 175, 130, 98].forEach((f, i) => setTimeout(() => { if (AC) tone(f, 0.9, { type: 'sawtooth', gain: 0.14 }); }, i * 220)); }
    },
    thunder() {
      if (!AC) return;
      noise(2.4, { freq: 260, q: 0.3, gain: 0.30, type: 'lowpass', sweep: 50, bus: ambBus, rate: 0.5 });
      tone(48, 1.8, { type: 'sine', to: 26, gain: 0.22, bus: ambBus });
    }
  };

  /* ---------- ambience + dynamic score ---------- */
  function startAmbience(kind) {
    if (!AC) return;
    stopAmbience();
    // rain / wind bed
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass';
    const heavy = kind === 'rain_heavy' || kind === 'rain_storm';
    f.frequency.value = heavy ? 1500 : kind === 'dark_indoor' ? 420 : 900;
    f.Q.value = 0.45;
    const g = AC.createGain(); g.gain.value = heavy ? 0.16 : kind === 'dark_indoor' ? 0.06 : 0.10;
    const lfo = AC.createOscillator(), lg = AC.createGain();
    lfo.frequency.value = 0.13; lg.gain.value = g.gain.value * 0.35;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(ambBus);
    src.start(); lfo.start();
    rainSrc = { src, lfo, g };
    // room tone / drone
    if (kind === 'dark_indoor') {
      const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = 46;
      const og = AC.createGain(); og.gain.value = 0.10; o.connect(og); og.connect(ambBus); o.start();
      droneNodes.push({ o, g: og });
    }
    // score
    startMusic();
  }
  function stopAmbience() {
    try { if (rainSrc) { rainSrc.src.stop(); rainSrc.lfo.stop(); } } catch (e) {}
    rainSrc = null;
    droneNodes.forEach(d => { try { d.o.stop(); } catch (e) {} });
    droneNodes = [];
    stopMusic();
  }
  function startMusic() {
    if (!AC) return;
    stopMusic();
    // D minor drone pad
    const freqs = [73.42, 110, 146.83];
    freqs.forEach((f, i) => {
      const o = AC.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f; o.detune.value = (rnd() - .5) * 9;
      const flt = AC.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 320; flt.Q.value = 2;
      const g = AC.createGain(); g.gain.value = 0.0;
      const lfo = AC.createOscillator(), lg = AC.createGain();
      lfo.frequency.value = 0.05 + i * 0.017; lg.gain.value = 90;
      lfo.connect(lg); lg.connect(flt.frequency); lfo.start();
      o.connect(flt); flt.connect(g); g.connect(musBus); o.start();
      g.gain.linearRampToValueAtTime(0.11 - i * 0.02, now() + 4);
      tensionNodes.push({ o, g, lfo, flt, base: 0.11 - i * 0.02 });
    });
    musBus.gain.cancelScheduledValues(now());
    musBus.gain.linearRampToValueAtTime(0.75, now() + 3);
  }
  function stopMusic() {
    tensionNodes.forEach(n => { try { n.o.stop(); n.lfo.stop(); } catch (e) {} });
    tensionNodes = [];
    if (musBus) { musBus.gain.cancelScheduledValues(now()); musBus.gain.linearRampToValueAtTime(0, now() + 0.6); }
  }
  /** intensity 0..3 from the AI Director */
  function setTension(x) {
    if (!AC || !tensionNodes.length) return;
    const t = Math.max(0, Math.min(1.6, x));
    tensionNodes.forEach((n, i) => {
      n.g.gain.setTargetAtTime(n.base * (1 + t * 1.5), now(), 0.8);
      n.flt.frequency.setTargetAtTime(300 + t * 900 + i * 60, now(), 0.9);
      n.o.detune.setTargetAtTime((rnd() - .5) * 20 * t, now(), 1.2);
    });
    if (musBus) musBus.gain.setTargetAtTime(0.7 + t * 0.3, now(), 1.0);
  }

  root.ABAW_AUDIO = {
    init, resume, setVolume, setMuted, SFX, spatial,
    startAmbience, stopAmbience, setTension,
    get ready() { return !!AC; },
    get ctx() { return AC; }
  };
})(typeof self !== 'undefined' ? self : this);
