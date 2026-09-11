/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  client/hudlayout.js
   Customizable HUD layout (CODM-style). Every player can drag,
   scale and fade their HUD widgets + touch controls; canvas-drawn
   panels (minimap / compass / health / ammo) get move + fade hooks
   consumed by render.js drawHud via canvasPos().
   Persisted per device in localStorage. Presentation-only: the
   simulation, input routing and netcode are untouched.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ABAW_HUDL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'abaw.hudlayout.v1';

  /* DOM widgets the player can drag. `touch` ones only matter on phones
     but are always editable so layouts can be prepared ahead of time. */
  var WIDGETS = [
    { id: 'chips', sel: '.hud-tl', label: 'Status chips' },
    { id: 'objective', sel: '.hud-tc', label: 'Objective' },
    { id: 'prompt', sel: '#prompt', label: 'Interact prompt' },
    { id: 'announce', sel: '#center', label: 'Announcements' },
    { id: 'msgs', sel: '#msgs', label: 'Feed' },
    { id: 'fps', sel: '#fps', label: 'FPS counter' },
    { id: 'tMove', sel: '#tMove', label: 'Move pad', touch: true },
    { id: 'tAim', sel: '#tAim', label: 'Aim pad', touch: true },
    { id: 'tFire', sel: '#tFire', label: 'FIRE button', touch: true },
    { id: 'tUse', sel: '#tUse', label: 'USE button', touch: true },
    { id: 'tReload', sel: '#tReload', label: 'RELOAD button', touch: true },
    { id: 'tMelee', sel: '#tMelee', label: 'MELEE button', touch: true },
    { id: 'tSwap', sel: '#tSwap', label: 'SWAP button', touch: true },
    { id: 'tSprint', sel: '#tSprint', label: 'RUN button', touch: true },
    { id: 'tAbility', sel: '#tAbility', label: 'ABILITY button', touch: true },
    { id: 'tThrow', sel: '#tThrow', label: 'THROW button', touch: true }
  ];

  /* Canvas panels drawn by render.js drawHud — move + fade only
     (scale would fight the u=H/360 unit system). */
  var CANVAS_PANELS = [
    { id: 'minimap', label: 'Minimap' },
    { id: 'compass', label: 'Compass' },
    { id: 'health', label: 'Health bar' },
    { id: 'ammo', label: 'Ammo' }
  ];

  var layout = { v: 1, w: {}, c: {} };
  var editing = false, inited = false;
  var doc = null, win = null;
  var sel = null;                 // { type: 'w'|'c', id }
  var drag = null;                // active drag state
  var els = {};                   // id -> element (widgets)
  var ghosts = {};                // id -> ghost element (canvas panels)
  var bar = null;
  var prev = null;                // pre-edit UI state to restore
  var onDoneCb = null;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var vw = function () { return (win && win.innerWidth) || 1280; };
  var vh = function () { return (win && win.innerHeight) || 720; };

  /* ---------------- persistence ---------------- */
  function save() {
    try { win.localStorage.setItem(KEY, JSON.stringify(layout)); } catch (e) {}
  }
  function load() {
    layout = { v: 1, w: {}, c: {} };
    try {
      var raw = win.localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.v === 1) { layout.w = o.w || {}; layout.c = o.c || {}; }
      }
    } catch (e) {}
    return layout;
  }
  function reset() { layout = { v: 1, w: {}, c: {} }; save(); apply(); }
  function resetWidget(type, id) {
    if (type === 'w') delete layout.w[id]; else delete layout.c[id];
    save(); apply();
  }

  function getWidget(id) { return layout.w[id] || (layout.w[id] = {}); }
  function getCanvas(id) { return layout.c[id] || (layout.c[id] = {}); }

  function setWidget(id, patch) {
    var found = false;
    for (var i = 0; i < WIDGETS.length; i++) if (WIDGETS[i].id === id) found = true;
    if (!found) return null;
    var e = getWidget(id);
    for (var k in patch) if (patch.hasOwnProperty(k)) e[k] = patch[k];
    if (e.dx === 0) delete e.dx; if (e.dy === 0) delete e.dy;
    if (e.s === 1) delete e.s; if (e.o === 1) delete e.o;
    if (!e.dx && !e.dy && !e.s && !e.o) delete layout.w[id];
    apply();
    return e;
  }
  function setCanvas(id, patch) {
    var found = false;
    for (var i = 0; i < CANVAS_PANELS.length; i++) if (CANVAS_PANELS[i].id === id) found = true;
    if (!found) return null;
    var e = getCanvas(id);
    for (var k in patch) if (patch.hasOwnProperty(k)) e[k] = patch[k];
    if (e.dx === 0) delete e.dx; if (e.dy === 0) delete e.dy; if (e.o === 1) delete e.o;
    if (!e.dx && !e.dy && (e.o == null)) delete layout.c[id];
    return e;
  }

  /* px offsets for render.js drawHud (called every frame — keep it cheap) */
  function canvasPos(W, H) {
    var out = {};
    for (var id in layout.c) {
      var e = layout.c[id];
      out[id] = { dx: (e.dx || 0) / 100 * W, dy: (e.dy || 0) / 100 * H, o: e.o == null ? 1 : e.o };
    }
    return out;
  }

  /* ---------------- apply to DOM ---------------- */
  function baseTransform(el) {
    if (el.dataset.hudBase === undefined) {
      var c = '';
      try { c = win.getComputedStyle(el).transform || ''; } catch (e) {}
      el.dataset.hudBase = (c && c !== 'none') ? c : '';
    }
    return el.dataset.hudBase;
  }
  function applyWidget(w) {
    var el = els[w.id];
    if (!el) return;
    var e = layout.w[w.id] || {};
    var dx = (e.dx || 0) / 100 * vw(), dy = (e.dy || 0) / 100 * vh();
    var s = e.s == null ? 1 : e.s;
    var t = '';
    if (dx || dy) t += ' translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    if (s !== 1) t += ' scale(' + s.toFixed(2) + ')';
    el.style.transform = baseTransform(el) + t;
    el.style.opacity = (e.o == null || e.o === 1) ? '' : String(e.o);
  }
  function apply() {
    for (var i = 0; i < WIDGETS.length; i++) applyWidget(WIDGETS[i]);
    for (var id in ghosts) positionGhost(id);
  }

  /* ---------------- edit mode ---------------- */
  function ghostRect(id) {
    var W = vw(), H = vh(), u = H / 360;
    if (id === 'minimap') return { x: 13 * u, y: 13 * u, w: 108 * u, h: 108 * u };
    if (id === 'compass') { var cw = Math.min(W * 0.40, 430 * u); return { x: W / 2 - cw / 2, y: 2 * u, w: cw, h: 30 * u }; }
    if (id === 'health') return { x: 0, y: H - 42 * u, w: 230 * u, h: 42 * u };
    if (id === 'ammo') return { x: W - 210 * u, y: H - 78 * u, w: 210 * u, h: 78 * u };
    return { x: 0, y: 0, w: 80, h: 30 };
  }
  function positionGhost(id) {
    var g = ghosts[id]; if (!g) return;
    var r = ghostRect(id), e = layout.c[id] || {};
    g.style.left = (r.x + (e.dx || 0) / 100 * vw()) + 'px';
    g.style.top = (r.y + (e.dy || 0) / 100 * vh()) + 'px';
    g.style.width = r.w + 'px';
    g.style.height = r.h + 'px';
    g.style.opacity = e.o == null ? 1 : Math.max(0.25, e.o);
  }
  function label(type, id) {
    var list = type === 'w' ? WIDGETS : CANVAS_PANELS;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id;
  }
  function select(type, id) {
    sel = { type: type, id: id };
    var all = doc.querySelectorAll('.hudl-sel');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('hudl-sel');
    var node = type === 'w' ? els[id] : ghosts[id];
    if (node) node.classList.add('hudl-sel');
    var l = doc.getElementById('hudlSel');
    if (l) l.textContent = label(type, id);
    var sc = doc.getElementById('hudlSm');
    if (sc) sc.style.visibility = type === 'w' ? 'visible' : 'hidden';
    var sp = doc.getElementById('hudlSp');
    if (sp) sp.style.visibility = type === 'w' ? 'visible' : 'hidden';
  }
  function adj(kind, delta) {
    if (!sel) return;
    if (sel.type === 'w') {
      var e = layout.w[sel.id] || {};
      if (kind === 's') setWidget(sel.id, { s: clamp(e.s == null ? 1 : e.s + delta, 0.5, 2) });
      else setWidget(sel.id, { o: clamp(Math.round(((e.o == null ? 1 : e.o) + delta) * 10) / 10, 0.2, 1) });
    } else {
      var c = layout.c[sel.id] || {};
      if (kind === 'o') setCanvas(sel.id, { o: clamp(Math.round(((c.o == null ? 1 : c.o) + delta) * 10) / 10, 0.2, 1) });
      apply();
    }
  }

  function onDown(e) {
    if (!editing) return;
    var p = (e.touches && e.touches[0]) || e;
    var t = p.target;
    var node = t && t.closest ? t.closest('[data-hudl]') : null;
    if (!node) return;
    var ref = node.getAttribute('data-hudl');
    var type = ref.charAt(0), id = ref.slice(2);
    select(type, id);
    var cur = type === 'w' ? (layout.w[id] || {}) : (layout.c[id] || {});
    drag = { type: type, id: id, px: p.clientX, py: p.clientY, dx0: cur.dx || 0, dy0: cur.dy || 0 };
    if (e.preventDefault) e.preventDefault();
  }
  function onMove(e) {
    if (!editing || !drag) return;
    var p = (e.touches && e.touches[0]) || e;
    var nx = drag.dx0 + (p.clientX - drag.px) / vw() * 100;
    var ny = drag.dy0 + (p.clientY - drag.py) / vh() * 100;
    nx = clamp(nx, -85, 85); ny = clamp(ny, -85, 85);
    if (drag.type === 'w') setWidget(drag.id, { dx: nx, dy: ny });
    else { setCanvas(drag.id, { dx: nx, dy: ny }); apply(); }
    if (e.preventDefault) e.preventDefault();
  }
  function onUp() { drag = null; }
  function onKey(e) { if (editing && e.key === 'Escape') endEdit(true); }

  function buildUi() {
    // tag widgets
    for (var i = 0; i < WIDGETS.length; i++) {
      var w = WIDGETS[i], el = els[w.id];
      if (!el) continue;
      el.classList.add('hudl-w');
      el.setAttribute('data-hudl', 'w:' + w.id);
      el.setAttribute('title', w.label);
    }
    // ghosts for canvas panels
    for (var j = 0; j < CANVAS_PANELS.length; j++) {
      var cp = CANVAS_PANELS[j];
      var g = doc.createElement('div');
      g.className = 'hudl-ghost';
      g.setAttribute('data-hudl', 'c:' + cp.id);
      g.textContent = cp.label + ' (canvas)';
      doc.body.appendChild(g);
      ghosts[cp.id] = g;
      positionGhost(cp.id);
    }
    // toolbar
    bar = doc.createElement('div');
    bar.id = 'hudlBar';
    bar.innerHTML =
      '<span id="hudlSel">tap a widget</span>' +
      '<button id="hudlSm" type="button">SIZE −</button><button id="hudlSp" type="button">SIZE +</button>' +
      '<button id="hudlOm" type="button">FADE −</button><button id="hudlOp" type="button">FADE +</button>' +
      '<button id="hudlRw" type="button">RESET</button><button id="hudlRa" type="button">RESET ALL</button>' +
      '<button id="hudlDone" type="button" class="go">DONE</button>';
    doc.body.appendChild(bar);
    bar.querySelector('#hudlSm').addEventListener('click', function () { adj('s', -0.1); });
    bar.querySelector('#hudlSp').addEventListener('click', function () { adj('s', +0.1); });
    bar.querySelector('#hudlOm').addEventListener('click', function () { adj('o', -0.1); });
    bar.querySelector('#hudlOp').addEventListener('click', function () { adj('o', +0.1); });
    bar.querySelector('#hudlRw').addEventListener('click', function () { if (sel) resetWidget(sel.type, sel.id); });
    bar.querySelector('#hudlRa').addEventListener('click', function () { reset(); apply(); });
    bar.querySelector('#hudlDone').addEventListener('click', function () { endEdit(true); });
  }
  function teardownUi() {
    for (var i = 0; i < WIDGETS.length; i++) {
      var el = els[WIDGETS[i].id];
      if (el) { el.classList.remove('hudl-w', 'hudl-sel'); el.removeAttribute('data-hudl'); el.removeAttribute('title'); }
    }
    for (var id in ghosts) if (ghosts[id].parentNode) ghosts[id].parentNode.removeChild(ghosts[id]);
    ghosts = {};
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null; sel = null; drag = null;
  }

  function startEdit(opts) {
    if (editing || !inited) return false;
    editing = true;
    onDoneCb = (opts && opts.onDone) || null;
    prev = {
      hudHidden: doc.getElementById('hud') ? doc.getElementById('hud').classList.contains('hidden') : false,
      touchDisplay: doc.getElementById('touch') ? doc.getElementById('touch').style.display : ''
    };
    var hud = doc.getElementById('hud');
    if (hud) hud.classList.remove('hidden');
    var tl = doc.getElementById('touch');
    if (tl) tl.style.display = 'block';
    doc.body.classList.add('hudedit');
    buildUi();
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, { passive: false, capture: true });
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('touchstart', onDown, { passive: false, capture: true });
    doc.addEventListener('touchmove', onMove, { passive: false, capture: true });
    doc.addEventListener('touchend', onUp, true);
    doc.addEventListener('keydown', onKey);
    return true;
  }
  function endEdit(doSave) {
    if (!editing) return;
    editing = false;
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    doc.removeEventListener('touchstart', onDown, true);
    doc.removeEventListener('touchmove', onMove, true);
    doc.removeEventListener('touchend', onUp, true);
    doc.removeEventListener('keydown', onKey);
    doc.body.classList.remove('hudedit');
    teardownUi();
    if (prev) {
      var hud = doc.getElementById('hud');
      if (hud && prev.hudHidden) hud.classList.add('hidden');
      var tl = doc.getElementById('touch');
      if (tl) tl.style.display = prev.touchDisplay || '';
      prev = null;
    }
    if (doSave) { save(); apply(); } else { load(); apply(); }
    if (onDoneCb) { var cb = onDoneCb; onDoneCb = null; cb(!!doSave); }
  }

  /* ---------------- init ---------------- */
  function init(d) {
    doc = d || (typeof document !== 'undefined' ? document : null);
    win = (typeof window !== 'undefined' ? window : null);
    if (!doc || !win || inited) return api;
    inited = true;
    for (var i = 0; i < WIDGETS.length; i++) els[WIDGETS[i].id] = doc.querySelector(WIDGETS[i].sel);
    load();
    apply();
    var t = null;
    win.addEventListener('resize', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        // media queries may have changed the CSS base transform — re-read it
        for (var i = 0; i < WIDGETS.length; i++) {
          var el = els[WIDGETS[i].id];
          if (el) { el.style.transform = ''; delete el.dataset.hudBase; }
        }
        apply();
      }, 120);
    });
    return api;
  }

  var api = {
    KEY: KEY, WIDGETS: WIDGETS, CANVAS_PANELS: CANVAS_PANELS,
    init: init, apply: apply, save: save, load: load,
    reset: reset, resetWidget: function (id) { resetWidget('w', id); },
    setWidget: setWidget, setCanvas: setCanvas, canvasPos: canvasPos,
    startEdit: startEdit, endEdit: endEdit,
    get editing() { return editing; },
    get layout() { return layout; }
  };
  return api;
});
