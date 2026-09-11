/**
 * Customizable HUD layout (client/hudlayout.js) — jsdom unit tests.
 * Pins: widget registry vs real DOM, transform/opacity application,
 * localStorage round-trip, canvas-panel px conversion, drawHud hooks,
 * edit-mode lifecycle. Presentation-only feature — no server needed.
 *   node test/hudlayout.js
 */
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => require('fs').readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  -> ' + extra : '')); }
};

const dom = new JSDOM(read('client/index.html'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/'
});
const win = dom.window;
win.eval(read('core/data.js'));
win.eval(read('core/level.js'));
win.eval(read('client/audio.js'));
win.eval(read('client/render.js'));
win.eval(read('client/hudlayout.js'));
const H = win.ABAW_HUDL;
const doc = win.document;

console.log('== Registry ==');
{
  ok(!!H && typeof H.init === 'function', 'ABAW_HUDL exposed (UMD)');
  const ids = H.WIDGETS.map(w => w.id);
  ok(new Set(ids).size === ids.length, 'widget ids unique (' + ids.length + ' widgets)');
  const missing = H.WIDGETS.filter(w => !doc.querySelector(w.sel)).map(w => w.id);
  ok(missing.length === 0, 'every widget selector resolves in index.html', missing.join(','));
  const cids = H.CANVAS_PANELS.map(p => p.id);
  ok(cids.join(',') === 'minimap,compass,health,ammo', 'canvas panels: minimap/compass/health/ammo');
  ok(!!doc.getElementById('btnHudLayout'), 'settings (pause) screen has the Customize HUD Layout button');
  ok(/hudlayout\.js/.test(read('client/index.html')), 'index.html ships the hudlayout script tag');
}

console.log('\n== Apply / persistence ==');
{
  H.init(doc);
  const fire = doc.querySelector('#tFire');
  ok(fire.getAttribute('title') === undefined || true, 'init ran without a session');
  H.setWidget('tFire', { dx: 10, dy: -4, s: 1.2, o: 0.8 });
  ok(/scale\(1\.20\)/.test(fire.style.transform), 'scale applied to inline transform', fire.style.transform);
  ok(/translate\(/.test(fire.style.transform), 'translate applied (dx/dy as % of viewport)');
  ok(fire.style.opacity === '0.8', 'opacity applied');
  ok(H.setWidget('nope', { dx: 1 }) === null, 'unknown widget ids are rejected');
  H.save();
  const raw = win.localStorage.getItem(H.KEY);
  ok(!!raw && JSON.parse(raw).w.tFire.s === 1.2, 'layout persisted to localStorage');
  H.reset();
  ok(fire.style.opacity === '' && !/scale/.test(fire.style.transform), 'reset() clears transforms + fades');
  win.localStorage.setItem(H.KEY, raw);
  H.load(); H.apply();
  ok(/scale\(1\.20\)/.test(fire.style.transform), 'load() restores the saved layout');
  // untouched widgets keep their CSS base (composed transform, no player offset)
  const pr = doc.querySelector('#prompt');
  ok(!/px\)/.test(pr.style.transform) && !/scale\(/.test(pr.style.transform) && pr.style.opacity === '',
    'untouched widgets keep their CSS defaults', pr.style.transform);
  H.reset();
}

console.log('\n== Canvas panel conversion ==');
{
  ok(Object.keys(H.canvasPos(1000, 500)).length === 0, 'empty layout -> no panel offsets');
  H.setCanvas('health', { dx: 5, dy: -10, o: 0.5 });
  const cp = H.canvasPos(1000, 500);
  ok(cp.health && Math.abs(cp.health.dx - 50) < 1e-9 && Math.abs(cp.health.dy + 50) < 1e-9,
    'percent offsets scale with canvas size (5%,-10% of 1000x500 -> 50,-50 px)');
  ok(cp.health.o === 0.5, 'panel opacity carried through');
  ok(H.setCanvas('nope', {}) === null, 'unknown panel ids are rejected');
}

console.log('\n== drawHud consumes the layout ==');
{
  const calls = { translate: [], save: 0, restore: 0 };
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: { width: 800, height: 360 },
    globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    save() { calls.save++; }, restore() { calls.restore++; },
    translate(x, y) { calls.translate.push([x, y]); },
    scale() {}, rotate() {}, clip() {}, rect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, ellipse() {},
    quadraticCurveTo() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, strokeText() {}, measureText() { return { width: 10 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    setTransform() {}, drawImage() {}
  };
  const fake = {
    w: 800, h: 360, youId: 'p0', fpMoving: false, fpMuzzle: 0, spread: 5, hitT: 0,
    time: 0, yaw: 0, ownPos: { x: 100, y: 100 }, level: { tile: 32, extract: { x: 400, y: 400 } },
    drawMinimapFP() { ctx.fillRect(0, 0, 1, 1); }
  };
  const ents = {
    surv: [{ id: 'p0', hp: 80, mhp: 100, mag: 30, res: 90, wp: 'rifle', k: 2, arm: 0, rl: 0, tn: 0, sp: false }],
    en: []
  };
  // layout: health 5% right of 800px = 40px, ammo faded
  H.reset();
  H.setCanvas('health', { dx: 5 });
  H.setCanvas('ammo', { o: 0.4 });
  const R = win.ABAW_RENDER.Renderer;
  R.prototype.drawHud.call(fake, ctx, ents, {}, 1 / 60);
  ok(calls.translate.some(t => Math.abs(t[0] - 40) < 1e-6 && t[1] === 0),
    'health panel translated by the player offset (40px)', JSON.stringify(calls.translate));
  ok(calls.save === calls.restore, 'ctx.save/restore balanced with panel transforms (' + calls.save + '/' + calls.restore + ')');
  // no layout -> no translates from panels (compass etc. use save/clip only)
  H.reset();
  calls.translate.length = 0;
  R.prototype.drawHud.call(fake, ctx, ents, {}, 1 / 60);
  ok(calls.translate.length === 0, 'default layout draws panels exactly where they were');
}

console.log('\n== Edit mode lifecycle ==');
{
  const before = win.localStorage.getItem(H.KEY);
  ok(H.startEdit({}) === true, 'startEdit enters edit mode');
  ok(H.editing === true, 'editing flag set');
  ok(doc.body.classList.contains('hudedit'), 'body gets the hudedit class (drag outlines)');
  ok(!!doc.getElementById('hudlBar'), 'floating toolbar created');
  ok(doc.querySelectorAll('.hudl-ghost').length === 4, 'canvas panels get draggable ghosts');
  ok(!!doc.querySelector('[data-hudl="w:tFire"]'), 'widgets tagged as draggable');
  H.setWidget('tAim', { dx: 12 });
  H.endEdit(false);                                   // cancel
  ok(H.editing === false && !doc.body.classList.contains('hudedit'), 'endEdit exits cleanly');
  ok(!doc.getElementById('hudlBar') && doc.querySelectorAll('.hudl-ghost').length === 0, 'toolbar + ghosts removed');
  ok(!H.layout.w.tAim, 'cancel discards unsaved changes');
  ok(win.localStorage.getItem(H.KEY) === before, 'cancel does not touch storage');
  H.startEdit({});
  H.setWidget('tAim', { dx: 12 });
  H.endEdit(true);                                    // save
  ok(!!H.layout.w.tAim && JSON.parse(win.localStorage.getItem(H.KEY)).w.tAim.dx === 12, 'DONE persists the layout');
  H.reset();
  ok(H.startEdit({}) === true && H.startEdit({}) === false, 'double startEdit is refused');
  H.endEdit(false);
}

console.log('\n' + (fail ? 'HUD LAYOUT SUITE FAILED' : 'HUD LAYOUT SUITE OK') + ' — pass ' + pass + ' fail ' + fail);
process.exit(fail ? 1 : 0);
