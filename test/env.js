/**
 * Shared headless-browser harness: boots the real client (index.html + every
 * script) inside jsdom with a stubbed canvas / WebAudio / WebSocket.
 * Used by test/client.js (desktop) and test/mobile.js (landscape phone).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WS = require('ws');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SCRIPTS = ['core/data.js', 'core/level.js', 'core/sim.js', 'client/audio.js', 'client/predict.js', 'client/render.js', 'client/main.js'];

/* ---------------- WebAudio stub ---------------- */
function param(v) {
  const p = {
    value: v,
    setValueAtTime() { return p; }, linearRampToValueAtTime() { return p; },
    exponentialRampToValueAtTime() { return p; }, setTargetAtTime() { return p; },
    cancelScheduledValues() { return p; }, setValueCurveAtTime() { return p; }
  };
  return p;
}
function audioNode(extra) {
  return Object.assign({
    connect() { return this; }, disconnect() {}, start() {}, stop() {},
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1),
    playbackRate: param(1), pan: param(0), buffer: null, loop: false, onended: null
  }, extra || {});
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = audioNode(); }
  createGain() { return audioNode(); }
  createOscillator() { return audioNode({ type: 'sine' }); }
  createBufferSource() { return audioNode(); }
  createBiquadFilter() { return audioNode({ type: 'lowpass' }); }
  createStereoPanner() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createConvolver() { return audioNode(); }
  createWaveShaper() { return audioNode({ curve: null, oversample: 'none' }); }
  createDelay() { return audioNode({ delayTime: param(0) }); }
  createPanner() { return audioNode({ setPosition() {}, positionX: param(0), positionY: param(0), positionZ: param(0) }); }
  createBuffer(ch, len, sr) {
    const d = []; for (let i = 0; i < ch; i++) d.push(new Float32Array(len));
    return { length: len, sampleRate: sr, numberOfChannels: ch, duration: len / sr, getChannelData: i => d[i] };
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

/* ---------------- canvas 2D stub ---------------- */
function makeCtx(canvas, stats) {
  const store = {
    canvas, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '10px monospace', textAlign: 'left', textBaseline: 'top',
    globalCompositeOperation: 'source-over', filter: 'none', shadowBlur: 0,
    shadowColor: '#000', shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true,
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10
  };
  const noop = () => {};
  const counting = () => { stats.drawCalls++; };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      switch (k) {
        case 'measureText': return s => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
        case 'createLinearGradient': case 'createRadialGradient': return () => ({ addColorStop: noop });
        case 'createPattern': return () => ({ setTransform: noop });
        case 'getImageData': case 'createImageData':
          return (a, b, w, h) => {
            const ww = w === undefined ? (a && a.width) || 1 : w, hh = h === undefined ? (a && a.height) || 1 : h;
            return { width: ww, height: hh, data: new Uint8ClampedArray(Math.max(4, ww * hh * 4)) };
          };
        case 'isPointInPath': case 'isPointInStroke': return () => false;
        default: return typeof k === 'string' ? (stats.counted.has(k) ? counting : noop) : undefined;
      }
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

/* ---------------- WebSocket stub backed by the real `ws` ---------------- */
class FakeWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0; this.binaryType = 'blob';
    this.onopen = this.onclose = this.onerror = this.onmessage = null;
    const self = this;
    this._ws = new WS(url);
    this._ws.on('open', () => { self.readyState = 1; if (self.onopen) self.onopen({}); });
    this._ws.on('message', d => { if (self.onmessage) self.onmessage({ data: d.toString() }); });
    this._ws.on('close', () => { self.readyState = 3; if (self.onclose) self.onclose({}); });
    this._ws.on('error', e => { self.readyState = 3; if (self.onerror) self.onerror({ message: String(e && e.message) }); });
  }
  send(s) { if (this._ws.readyState === 1) this._ws.send(s); }
  close() { this.readyState = 2; try { this._ws.close(); } catch (e) {} }
  addEventListener(t, f) { this['on' + t] = f; }
  removeEventListener(t) { this['on' + t] = null; }
}
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;

/**
 * @param {object} o
 *   width/height  viewport (CSS px)          touch   enable touch input
 *   dpr           devicePixelRatio           memory  navigator.deviceMemory
 *   cores         navigator.hardwareConcurrency
 */
function bootClient(o) {
  o = o || {};
  const errors = [];
  const stats = {
    drawCalls: 0,
    counted: new Set(['save', 'restore', 'beginPath', 'closePath', 'setTransform', 'resetTransform', 'clip',
      'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'arc', 'moveTo', 'lineTo', 'rect', 'ellipse',
      'quadraticCurveTo', 'bezierCurveTo', 'translate', 'rotate', 'scale', 'drawImage', 'putImageData',
      'fillText', 'strokeText', 'setLineDash', 'arcTo'])
  };
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  vc.on('warn', () => {});

  const dom = new JSDOM(read('client/index.html'), {
    url: 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window, doc = win.document;

  // viewport + device profile (must be set before main.js evaluates)
  const setProp = (obj, k, v) => { try { Object.defineProperty(obj, k, { value: v, configurable: true, writable: true }); } catch (e) {} };
  setProp(win, 'innerWidth', o.width || 1280);
  setProp(win, 'innerHeight', o.height || 800);
  setProp(win, 'devicePixelRatio', o.dpr || 1);
  if (o.touch) {
    setProp(win.navigator, 'maxTouchPoints', 5);
    win.ontouchstart = function () {};
  }
  if (o.platform) setProp(win.navigator, 'platform', o.platform);
  if (o.memory !== undefined) setProp(win.navigator, 'deviceMemory', o.memory);
  if (o.cores !== undefined) setProp(win.navigator, 'hardwareConcurrency', o.cores);
  if (o.screen) { setProp(win.screen, 'width', o.screen[0]); setProp(win.screen, 'height', o.screen[1]); }
  // jsdom ships no matchMedia; provide one that reports the pointer type we asked for
  win.matchMedia = q => ({
    media: q, matches: /pointer:\s*coarse/.test(q) ? !!o.coarsePointer : false,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null
  });
  if (o.noPointerEvents) { try { delete win.PointerEvent; } catch (e) { setProp(win, 'PointerEvent', undefined); } }

  win.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = makeCtx(this, stats)); };
  win.AudioContext = FakeAudioContext;
  win.webkitAudioContext = FakeAudioContext;
  win.WebSocket = FakeWebSocket;
  win.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.error)));

  for (const f of SCRIPTS) {
    try { win.eval(read(f)); } catch (e) { errors.push('eval ' + f + ': ' + e.message); }
  }

  const $ = id => doc.getElementById(id);
  const api = {
    win, doc, errors, stats, dom,
    $,
    visible: id => { const e = $(id); return !!e && !e.classList.contains('hidden'); },
    text: id => (($(id) || {}).textContent || '').trim(),
    click: id => { const e = $(id); if (!e) throw new Error('no #' + id); e.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); },
    key: (k, type = 'keydown') => doc.dispatchEvent(new win.KeyboardEvent(type, {
      key: k, code: ({ Escape: 'Escape', Tab: 'Tab', ' ': 'Space', Enter: 'Enter', Shift: 'ShiftLeft' })[k] || 'Key' + k.toUpperCase(),
      bubbles: true, cancelable: true
    })),
    /**
     * Dispatch a touch-ish event. The client uses PointerEvents when the
     * browser has them and falls back to TouchEvents otherwise, so this
     * mirrors whichever path is active (pass forceTouch to test the fallback).
     */
    touch: (type, el, x, y, id, forceTouch) => {
      const PMAP = { touchstart: 'pointerdown', touchmove: 'pointermove', touchend: 'pointerup', touchcancel: 'pointercancel' };
      const pid = id === undefined ? 1 : id;
      if (!forceTouch && typeof win.PointerEvent === 'function') {
        const e = new win.PointerEvent(PMAP[type] || type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          pointerId: pid, pointerType: 'touch', isPrimary: true
        });
        el.dispatchEvent(e);
        return e;
      }
      const e = new win.Event(type, { bubbles: true, cancelable: true });
      const t = { identifier: pid, clientX: x, clientY: y, target: el, pageX: x, pageY: y };
      Object.defineProperty(e, 'changedTouches', { value: [t], configurable: true });
      Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [t], configurable: true });
      el.dispatchEvent(e);
      return e;
    },
    /** Give an element a real box so pad maths works. */
    rect: (el, x, y, w, h) => {
      el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y });
    },
    resize: (w, h) => {
      setProp(win, 'innerWidth', w); setProp(win, 'innerHeight', h);
      win.dispatchEvent(new win.Event('resize'));
    },
    dbg: () => win.ABAW_DEBUG,
    close: () => { try { win.close(); } catch (e) {} }
  };
  return api;
}

/* ---------------- tiny assert helper ---------------- */
const T = { pass: 0, fail: 0 };
T.ok = (cond, label, extra) => {
  if (cond) { T.pass++; console.log('  \u2713 ' + label); }
  else { T.fail++; console.log('  \u2717 ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};
T.section = t => console.log('\n== ' + t + ' ==');
T.report = () => {
  console.log('\n----------------------------------------');
  console.log('  PASS ' + T.pass + '   FAIL ' + T.fail);
  console.log('----------------------------------------\n');
  return T.fail;
};
T.sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { bootClient, T, read, ROOT };
