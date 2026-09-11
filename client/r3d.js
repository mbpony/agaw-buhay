/* Agaw-Buhay — 3D first-person presentation layer (master doc milestones 1-3).
   The simulation (core/sim.js) stays authoritative; this module is ONLY
   presentation: it turns snapshots into a real 3D scene (Three.js), procedural
   models (no external assets), weather, lighting, viewmodels and the 2D HUD
   overlay (reused from the raycast renderer's HUD methods).
   UMD: browser global ABAW_R3D, Node module.exports (scene graph is testable
   headlessly; only WebGLRenderer needs a real browser). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('three'));
  else root.ABAW_R3D = factory(root.THREE);
}(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';
  if (!THREE) return null;

  const TS = 32;                 // sim tile size (world units == sim units)
  const WALL_H = 78;             // 3D wall height in sim units (~2.4 tiles)
  const EYE = 40;                // camera eye height

  /* ---------------- procedural model registry ---------------- */
  const mat = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));

  function humanoid(bodyC, skinC, scale, lean) {
    const g = new THREE.Group();
    const legG = new THREE.Group();
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(6, 26, 6), mat('#3a3f47'));
    l1.position.set(-4, 13, 0);
    const l2 = l1.clone(); l2.position.x = 4;
    legG.add(l1, l2);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 8), mat(bodyC));
    torso.position.y = 36;
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), mat(skinC));
    head.position.y = 51;
    const armG = new THREE.Group();
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(4, 20, 4), mat(bodyC));
    a1.position.set(-9, 40, 2); a1.rotation.x = -0.7;
    const a2 = a1.clone(); a2.position.x = 9;
    armG.add(a1, a2);
    g.add(legG, torso, head, armG);
    g.scale.setScalar(scale || 1);
    if (lean) torso.rotation.x = lean, head.rotation.x = lean;
    return { group: g, legs: [l1, l2], arms: [a1, a2], torso, head };
  }

  const ENEMY_BUILDERS = {
    common() { const m = humanoid('#565b50', '#8a9578', 1, 0.25); m.eyes = addEyes(m.head, '#ff3b30'); return m; },
    runner() { const m = humanoid('#6b705c', '#98a386', 0.92, 0.5); m.eyes = addEyes(m.head, '#ff3b30'); return m; },
    spitter() {
      const g = new THREE.Group();
      const belly = new THREE.Mesh(new THREE.SphereGeometry(13, 10, 8), mat('#2dd4bf'));
      belly.position.y = 30; belly.scale.set(1.15, 1, 1);
      const sac = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), mat('#a7f3d0', { emissive: 0x22aa77 }));
      sac.position.set(5, 34, 8);
      const head = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), mat('#1f8f80'));
      head.position.y = 46;
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), mat('#17706a')); l1.position.set(-6, 9, 0);
      const l2 = l1.clone(); l2.position.x = 6;
      g.add(belly, sac, head, l1, l2);
      return { group: g, legs: [l1, l2], arms: [], torso: belly, head, eyes: addEyes(head, '#fef08a') };
    },
    tiyanak() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 6), mat('#7d1226'));
      body.position.y = 12; body.scale.set(1.2, 0.8, 1);
      const head = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 6), mat('#a01830'));
      head.position.y = 24;
      const a1 = new THREE.Mesh(new THREE.BoxGeometry(3, 14, 3), mat('#7d1226')); a1.position.set(-8, 10, 4); a1.rotation.x = -1.1;
      const a2 = a1.clone(); a2.position.x = 8;
      g.add(body, head, a1, a2);
      return { group: g, legs: [a1, a2], arms: [a1, a2], torso: body, head, eyes: addEyes(head, '#ff5f52', 1.4) };
    },
    batibat() {
      const m = humanoid('#5b3a78', '#4a2f61', 1.55, 0.15);
      m.torso.scale.set(1.5, 1.1, 1.2);
      m.arms.forEach(a => { a.scale.set(1.4, 1.5, 1.4); });
      m.eyes = addEyes(m.head, '#e9d5ff');
      return m;
    },
    mangkukulam() {
      const g = new THREE.Group();
      const robe = new THREE.Mesh(new THREE.ConeGeometry(12, 44, 8), mat('#1d3b2a'));
      robe.position.y = 22;
      const hood = new THREE.Mesh(new THREE.SphereGeometry(6.5, 8, 6), mat('#16281d'));
      hood.position.y = 46;
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 52, 6), mat('#5b4326'));
      staff.position.set(10, 26, 2);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), mat('#7CFC9E', { emissive: 0x22dd66 }));
      orb.position.set(10, 53, 2);
      g.add(robe, hood, staff, orb);
      return { group: g, legs: [], arms: [staff], torso: robe, head: hood, eyes: addEyes(hood, '#3ddc84'), orb };
    },
    pugot() {
      const g = new THREE.Group();
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), mat('#585e68')); l1.position.set(-6, 13, 0);
      const l2 = l1.clone(); l2.position.x = 6;
      const torso = new THREE.Mesh(new THREE.BoxGeometry(20, 26, 11), mat('#767d89'));
      torso.position.y = 38;
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 4, 8), mat('#5e1220'));
      stump.position.y = 52;
      const a1 = new THREE.Mesh(new THREE.BoxGeometry(6, 24, 6), mat('#767d89')); a1.position.set(-13, 40, 0); a1.rotation.z = 0.5;
      const a2 = a1.clone(); a2.position.x = 13; a2.rotation.z = -0.5;
      g.add(l1, l2, torso, stump, a1, a2);
      return { group: g, legs: [l1, l2], arms: [a1, a2], torso, head: stump };
    },
    manananggal() {
      const g = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.SphereGeometry(11, 10, 8), mat('#8c2333'));
      torso.position.y = 40; torso.scale.set(1, 1.25, 0.8);
      const head = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), mat('#d8c3ae'));
      head.position.y = 58;
      const hair = new THREE.Mesh(new THREE.SphereGeometry(7.6, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mat('#12060a'));
      hair.position.y = 59;
      const wingMat = mat('#4a1020', { side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(34, 20), wingMat);
      w1.position.set(-20, 48, 0); w1.rotation.y = Math.PI / 2; w1.geometry.translate(17, 0, 0);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(34, 20), wingMat);
      w2.position.set(20, 48, 0); w2.rotation.y = -Math.PI / 2; w2.geometry.translate(17, 0, 0);
      const visc = [];
      for (let i = 0; i < 3; i++) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 22, 5), mat('#6d1622'));
        v.position.set((i - 1) * 5, 24, 0);
        visc.push(v); g.add(v);
      }
      g.add(torso, head, hair, w1, w2);
      return { group: g, legs: visc, arms: [w1, w2], torso, head, wings: [w1, w2], eyes: addEyes(head, '#ff2d55', 1.5) };
    }
  };
  function addEyes(head, color, k) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.3 * (k || 1), 6, 5), mat(color, { emissive: new THREE.Color(color).getHex() }));
    e.position.set(-2.4 * (k || 1), 1, 5);
    const e2 = e.clone(); e2.position.x = 2.4 * (k || 1);
    head.add(e, e2);
    return [e, e2];
  }

  const WEAPON_BUILDERS = {
    rifle() {
      const g = new THREE.Group();
      const M = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
      M(0.06, 0.09, 0.22, '#2e333e', 0, 0, 0.16);            // receiver
      M(0.05, 0.07, 0.16, '#414857', 0, -0.01, -0.03);      // stock
      M(0.045, 0.05, 0.20, '#414857', 0, -0.005, 0.36);     // handguard
      M(0.02, 0.02, 0.16, '#161a21', 0, 0.005, 0.52);       // barrel
      M(0.03, 0.035, 0.03, '#161a21', 0, 0.005, 0.61);      // brake
      M(0.035, 0.03, 0.09, '#161a21', 0, 0.065, 0.14);      // optic
      const mag = M(0.035, 0.11, 0.05, '#414857', 0, -0.09, 0.14); mag.rotation.x = 0.25;
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, 0.66); g.add(muzzle);
      return { group: g, muzzle, mag };
    },
    shotgun() {
      const g = new THREE.Group();
      const M = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
      M(0.06, 0.09, 0.24, '#2e333e', 0, 0, 0.16);
      M(0.05, 0.08, 0.14, '#6b4526', 0, -0.01, -0.04);
      M(0.025, 0.025, 0.34, '#161a21', 0, 0.02, 0.44);      // barrel
      M(0.025, 0.025, 0.30, '#161a21', 0, -0.02, 0.42);     // tube
      const pump = M(0.04, 0.045, 0.10, '#6b4526', 0, -0.02, 0.40);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.62); g.add(muzzle);
      return { group: g, muzzle, mag: pump };
    },
    smg() {
      const g = new THREE.Group();
      const M = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
      M(0.05, 0.08, 0.16, '#2e333e', 0, 0, 0.10);
      M(0.03, 0.10, 0.04, '#414857', 0, -0.08, 0.10);
      M(0.02, 0.02, 0.12, '#161a21', 0, 0.01, 0.24);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, 0.32); g.add(muzzle);
      return { group: g, muzzle, mag: g.children[1] };
    },
    burst() { return WEAPON_BUILDERS.rifle(); },
    lmg() {
      const w = WEAPON_BUILDERS.rifle();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.09), mat('#2c3039'));
      box.position.set(0.045, -0.02, 0.16); w.group.add(box);
      return w;
    },
    revolver() {
      const g = new THREE.Group();
      const M = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
      M(0.035, 0.05, 0.14, '#3b3f4a', 0, 0, 0.10);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 8), mat('#22252d'));
      cyl.rotation.x = Math.PI / 2; cyl.position.set(0, -0.005, 0.05); g.add(cyl);
      const grip = M(0.03, 0.08, 0.04, '#6b4526', 0, -0.06, 0.01); grip.rotation.x = 0.4;
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 0.19); g.add(muzzle);
      return { group: g, muzzle, mag: cyl };
    }
  };

  /* ---------------- world builder (level grid -> 3D) ---------------- */
  function buildWorld(level, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const W = level.w * TS, H = level.h * TS;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat('#20242c'));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2);
    g.add(ground);

    const solids = [], waters = [], roads = [], rubbles = [];
    for (let ty = 0; ty < level.h; ty++) for (let tx = 0; tx < level.w; tx++) {
      const t = level.grid[ty * level.w + tx];
      const x = tx * TS + TS / 2, z = ty * TS + TS / 2;
      if (t === 1 || t === 6) solids.push([x, z, t]);
      else if (t === 2) waters.push([x, z]);
      else if (t === 5) roads.push([x, z]);
      else if (t === 3) rubbles.push([x, z]);
    }
    const wallGeo = new THREE.BoxGeometry(TS, WALL_H, TS);
    const walls = new THREE.InstancedMesh(wallGeo, mat('#4a4f58'), Math.max(1, solids.length));
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    solids.forEach((s, i) => {
      m4.makeTranslation(s[0], WALL_H / 2, s[1]);
      walls.setMatrixAt(i, m4);
      const shade = 0.75 + ((s[0] * 7 + s[1] * 13) % 10) / 28;
      col.setRGB(0.29 * shade, 0.31 * shade, 0.36 * shade);
      walls.setColorAt(i, col);
    });
    walls.instanceMatrix.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    walls.count = solids.length;
    g.add(walls);

    const roadMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TS, 1.6, TS), mat('#2b2f36'), Math.max(1, roads.length));
    roads.forEach((r, i) => { m4.makeTranslation(r[0], 0.8, r[1]); roadMesh.setMatrixAt(i, m4); });
    roadMesh.count = roads.length; roadMesh.instanceMatrix.needsUpdate = true;
    g.add(roadMesh);

    const rubMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TS * 0.7, 6, TS * 0.7), mat('#3a3630'), Math.max(1, rubbles.length));
    rubbles.forEach((r, i) => { m4.makeTranslation(r[0], 3, r[1]); rubMesh.setMatrixAt(i, m4); });
    rubMesh.count = rubbles.length; rubMesh.instanceMatrix.needsUpdate = true;
    g.add(rubMesh);

    let water = null;
    if (waters.length) {
      water = new THREE.InstancedMesh(new THREE.BoxGeometry(TS, 3, TS),
        new THREE.MeshLambertMaterial({ color: 0x14324a, transparent: true, opacity: 0.72 }), Math.max(1, waters.length));
      waters.forEach((r, i) => { m4.makeTranslation(r[0], 1.5, r[1]); water.setMatrixAt(i, m4); });
      water.count = waters.length; water.instanceMatrix.needsUpdate = true;
      g.add(water);
    }

    // Philippine street dressing: utility poles + jeepneys + tricycles + lamps
    const dress = new THREE.Group();
    if (opts.dress !== false && roads.length) {
      let seed = (level.seed || 7) | 0;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const poleGeo = new THREE.CylinderGeometry(1.4, 1.8, 120, 6);
      const poleMat = mat('#3d3a35');
      for (let i = 0; i < roads.length; i += 14) {
        const p = new THREE.Mesh(poleGeo, poleMat);
        p.position.set(roads[i][0] + TS * 0.45, 60, roads[i][1] + TS * 0.45);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(18, 1.6, 1.6), poleMat);
        arm.position.y = 52; p.add(arm);
        dress.add(p);
      }
      for (let i = 6; i < roads.length; i += 37) {
        const j = new THREE.Group();                     // jeepney
        const body = new THREE.Mesh(new THREE.BoxGeometry(26, 26, 62), mat(['#8f2f3b', '#2f6f8f', '#7a6a2f'][i % 3]));
        body.position.y = 16;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 58), mat('#c9cdd4')); roof.position.y = 31;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(26.4, 4, 60), mat('#ffd24a')); stripe.position.y = 18;
        j.add(body, roof, stripe);
        j.position.set(roads[i][0], 0, roads[i][1]);
        j.rotation.y = rnd() * 6.28;
        dress.add(j);
      }
      for (let i = 20; i < roads.length; i += 53) {
        const t = new THREE.Group();                     // tricycle
        const cab = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 20), mat('#2f8f5a'));
        cab.position.y = 10;
        const bike = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 16), mat('#22262c'));
        bike.position.set(11, 7, 0);
        t.add(cab, bike);
        t.position.set(roads[i][0] - TS * 0.4, 0, roads[i][1]);
        t.rotation.y = rnd() * 6.28;
        dress.add(t);
      }
      // zone streaming (lite): bucket dressing into 720px chunks so the renderer
      // can hide far chunks on mobile instead of paying for the whole map
      const CHUNK = 720, chunks = new Map();
      for (const child of dress.children.slice()) {
        const kx = Math.floor(child.position.x / CHUNK), ky = Math.floor(child.position.z / CHUNK);
        const key = kx + ',' + ky;
        let c = chunks.get(key);
        if (!c) {
          c = new THREE.Group();
          c.userData.cx = (kx + 0.5) * CHUNK; c.userData.cy = (ky + 0.5) * CHUNK;
          chunks.set(key, c); dress.add(c);
        }
        dress.remove(child); c.add(child);
      }
      dress.userData.chunks = Array.from(chunks.values());
    }
    g.add(dress);
    return { group: g, water, dress, walls, counts: { solids: solids.length, waters: waters.length, roads: roads.length, chunks: (dress.userData.chunks || []).length } };
  }

  /* ---------------- scene kit (no WebGL: testable headlessly) ---------------- */
  class SceneKit {
    constructor() {
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x05070c, 0.0016);
      this.camera = new THREE.PerspectiveCamera(85, 16 / 9, 1, 2600);
      this.camera.rotation.order = 'YXZ';
      this.scene.add(this.camera);
      this.hemi = new THREE.HemisphereLight(0x24303f, 0x0a0c10, 0.85);
      this.moon = new THREE.DirectionalLight(0x9fb4d8, 0.5);
      this.moon.position.set(-300, 500, -200);
      this.scene.add(this.hemi, this.moon);
      this.flash = new THREE.SpotLight(0xfff2d0, 0, 900, 0.62, 0.45, 1.2);
      this.camera.add(this.flash);
      this.flash.position.set(0, -4, 2);
      this.flashTarget = new THREE.Object3D();
      this.scene.add(this.flashTarget);
      this.flash.target = this.flashTarget;
      this.muzzleLight = new THREE.PointLight(0xffc25a, 0, 260, 2);
      this.scene.add(this.muzzleLight);
      this.ents = new Map();
      this.world = null;
      this.weapon = null; this.weaponKind = null;
      this.vm = new THREE.Group();
      this.camera.add(this.vm);
      this.rain = null;
      this.tier = 'high';
      this.time = 0;
      this._lightning = 4 + Math.random() * 8;
    }
    setLevel(level, opts) {
      if (this.world) this.scene.remove(this.world.group);
      this.world = buildWorld(level, opts || { dress: this.tier !== 'low' });
      this.scene.add(this.world.group);
      this.level = level;
      this.buildRain();
    }
    buildRain() {
      if (this.rain) { this.scene.remove(this.rain); this.rain = null; }
      const n = this.tier === 'high' ? 4200 : this.tier === 'medium' ? 1800 : 0;
      if (!n) return;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 900; pos[i * 3 + 1] = Math.random() * 420; pos[i * 3 + 2] = (Math.random() - 0.5) * 900; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fb6cf, size: 1.6, transparent: true, opacity: 0.5 }));
      this.scene.add(this.rain);
    }
    setTier(t) {
      this.tier = t;
      this.scene.fog.density = t === 'low' ? 0.0026 : t === 'medium' ? 0.0019 : 0.0016;
      this.flash.intensity = t === 'low' ? 0.9 : 1.5;
      this.buildRain();
      if (this.world) this.world.dress.visible = t !== 'low';
    }
    setWeapon(kind) {
      if (this.weaponKind === kind) return;
      this.vm.clear();
      const b = (WEAPON_BUILDERS[kind] || WEAPON_BUILDERS.rifle)();
      b.group.position.set(4.6, -4.4, -8.5);
      b.group.rotation.y = 0.06;
      this.vm.add(b.group);
      this.weapon = b; this.weaponKind = kind;
    }
    enemyModel(type) {
      const b = (ENEMY_BUILDERS[type] || ENEMY_BUILDERS.common)();
      return b;
    }
    /* place every entity from an interpolated snapshot */
    sync(ents, own, yaw, dt) {
      const seen = new Set();
      for (const sv of (ents.surv || [])) {
        if (own && sv.id === own.id) continue;
        const key = 's' + sv.id;
        seen.add(key);
        let e = this.ents.get(key);
        if (!e) {
          const m = humanoid(sv.hero === 'sarge' ? '#3b82f6' : sv.hero === 'rhea' ? '#ec4899' : sv.hero === 'junjun' ? '#22c55e' : '#d97706', '#d9b48b', 1, 0);
          e = { kind: 'surv', m }; this.ents.set(key, e); this.scene.add(m.group);
        }
        place(e.m.group, sv, 0);
        walk(e.m, sv.wk || 0, sv.mv > 0.2);
        e.m.group.visible = !sv.dd;
      }
      for (const en of (ents.en || [])) {
        const key = 'e' + en.i;
        seen.add(key);
        let e = this.ents.get(key);
        if (!e) { e = { kind: 'en', m: this.enemyModel(en.t) }; this.ents.set(key, e); this.scene.add(e.m.group); }
        place(e.m.group, en, en.z || 0);
        walk(e.m, en.w || 0, true);
        if (e.m.wings) { const f = Math.sin((en.w || 0) * 3.1) * 0.5 - 0.25; e.m.wings[0].rotation.z = f; e.m.wings[1].rotation.z = -f; }
      }
      for (const it of (ents.it || [])) {
        const key = 'i' + it.id;
        seen.add(key);
        let e = this.ents.get(key);
        if (!e) {
          const gm = new THREE.Group();
          const box = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), mat(it.k === 'medkit' ? 0xe8ecf2 : it.k === 'ammo' ? 0x4d5a3a : it.k === 'armor' ? 0x27455e : 0xffb02e, { emissive: 0x221a08 }));
          box.position.y = 6 + Math.sin(this.time * 3 + it.id.length) * 2;
          gm.add(box);
          e = { kind: 'it', m: { group: gm } }; this.ents.set(key, e); this.scene.add(gm);
        }
        e.m.group.position.set(it.x, 0, it.y);
        e.m.group.rotation.y = this.time * 1.4;
      }
      for (const [key, e] of this.ents) if (!seen.has(key)) { this.scene.remove(e.m.group); this.ents.delete(key); }

      // camera = predicted own position + yaw (+ presentation pitch)
      if (own) {
        this.camera.position.set(own.x, EYE + (this.bob || 0), own.y);
        this.camera.rotation.y = -yaw;
        this.camera.rotation.x = Math.max(-1.15, Math.min(1.15, this.pitch || 0));
        this.flashTarget.position.set(own.x + Math.cos(yaw) * 300, EYE - 12, own.y + Math.sin(yaw) * 300);
      }
    }
    /* viewmodel animation: bob, sway, recoil, reload dip, muzzle light */
    animateVm(dt, moving, kick, reloading, yawVel) {
      if (!this.weapon) return;
      this.time += dt;
      this.bobPhase = (this.bobPhase || 0) + dt * (moving ? 10 : 2.4);
      this.bob = Math.sin(this.bobPhase) * (moving ? 2.2 : 0.8);
      const g = this.weapon.group;
      const dip = reloading > 0 ? Math.sin(Math.min(1, reloading / 1.4) * Math.PI) : 0;
      g.position.set(4.6 - yawVel * 1.2 + Math.sin(this.bobPhase) * (moving ? 0.5 : 0.2),
        -4.4 + Math.abs(Math.cos(this.bobPhase)) * (moving ? 0.45 : 0.15) - kick * 0.5 - dip * 2.2,
        -8.5 + kick * 1.4);
      g.rotation.x = kick * 0.22 + dip * 0.5;
      g.rotation.z = yawVel * 0.05;
      this.muzzleLight.intensity = kick * 26;
      if (kick > 0 && this.weapon.muzzle) {
        this.weapon.muzzle.getWorldPosition(this.muzzleLight.position);
      }
    }
    weather(dt) {
      if (this.rain) {
        const p = this.rain.geometry.attributes.position;
        const cam = this.camera.position;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) - dt * 460;
          if (y < 0) y += 420;
          p.setY(i, y);
          let x = p.getX(i), z = p.getZ(i);
          if (x > 450) x -= 900; if (x < -450) x += 900;
          if (z > 450) z -= 900; if (z < -450) z += 900;
          p.setX(i, x); p.setZ(i, z);
        }
        p.needsUpdate = true;
        this.rain.position.set(cam.x, 0, cam.z);
      }
      this._lightning -= dt;
      if (this._lightning <= 0) {
        this._lightning = 6 + Math.random() * 14;
        this._flashT = 0.22;
      }
      if (this._flashT > 0) { this._flashT -= dt; this.hemi.intensity = 0.85 + this._flashT * 6; }
      else this.hemi.intensity = 0.85;
      if (this.world && this.world.water) this.world.water.position.y = Math.sin(this.time * 1.7) * 0.6;
    }
  }
  function place(group, e, z) { group.position.set(e.x, z || 0, e.y); group.rotation.y = -(e.a || 0); }
  function walk(m, phase, moving) {
    if (!m.legs || !m.legs.length) return;
    const s = moving ? Math.sin(phase * 6) * 0.5 : 0;
    if (m.legs[0]) m.legs[0].rotation.x = s;
    if (m.legs[1]) m.legs[1].rotation.x = -s;
    if (m.arms && m.arms[0] && m.arms[0].geometry && m.arms[0].geometry.type === 'BoxGeometry') m.arms[0].rotation.x = -0.7 - s * 0.3;
  }

  /* ---------------- browser renderer: WebGL + 2D HUD overlay ---------------- */
  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  /* The 2D HUD overlay reuses render.js drawHud/drawAwareness via .call(shim).
     Those methods call this.drawMinimapFP(...) — a bare field object is NOT
     enough (this exact gap black-screened the deployed 3D build), so the shim
     carries the borrowed prototype methods too. */
  function makeHudShim() {
    const shim = { w: 0, h: 0, yaw: 0, ownPos: null, level: null, time: 0, hitT: 0, hitCrit: false, spread: 6, fpMoving: false, fpMuzzle: 0, youId: null };
    const R2 = typeof window !== 'undefined' ? window.ABAW_RENDER : null;
    if (R2 && R2.Renderer && R2.Renderer.prototype) {
      shim.drawMinimapFP = R2.Renderer.prototype.drawMinimapFP;
    }
    return shim;
  }
  function bindShimMethods(shim) {
    const R2 = typeof window !== 'undefined' ? window.ABAW_RENDER : null;
    if (!shim.drawMinimapFP && R2 && R2.Renderer && R2.Renderer.prototype) {
      shim.drawMinimapFP = R2.Renderer.prototype.drawMinimapFP;
    }
    return shim;
  }

  class Renderer3D {
    constructor(canvas2d) {
      this.c = canvas2d;                       // reused as the HUD overlay
      this.ctx = canvas2d.getContext('2d');
      this.glCanvas = document.createElement('canvas');
      this.glCanvas.id = 'game3d';
      this.glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      canvas2d.parentNode.insertBefore(this.glCanvas, canvas2d);
      canvas2d.style.background = 'transparent';
      this.gl = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, powerPreference: 'high-performance' });
      this.kit = new SceneKit();
      this.fp = true;
      this.localMode = false;
      this.yaw = 0; this.predOwn = null; this.ownPos = null;
      this.tier = 'high';
      this.stats = { fps: 0, ents: 0 };
      this.buf = []; this.prev = null; this.curr = null;
      this.youId = null;
      this.opts = { shake: true, dmg: true, fps: false, quality: 1 };
      this.hud = bindShimMethods(makeHudShim());
      this._fCnt = 0; this._fAcc = 0;
      this.slowFrames = 0;
      this.resize();
    }
    get level() { return this.kit.level; }
    setLevel(levelData) {
      const L = window.ABAW_LEVEL;
      this.kit.setLevel(L.deserialize ? (levelData.grid instanceof Uint8Array ? levelData : L.deserialize(levelData)) : levelData, { dress: this.tier !== 'low' });
      this.hud.level = this.kit.level;
    }
    setTier(t) {
      this.tier = t;
      this.kit.setTier(t);
      this.gl.setPixelRatio(t === 'low' ? 0.7 : t === 'medium' ? 1 : Math.min(2, window.devicePixelRatio || 1));
      this.gl.shadowMap.enabled = t === 'high';
      this.resize();
    }
    autoTier(ms) {
      if (ms > 26) this.slowFrames++; else if (this.slowFrames > 0) this.slowFrames--;
      if (this.slowFrames > 45) {
        this.slowFrames = 0;
        if (this.tier === 'high') this.setTier('medium');
        else if (this.tier === 'medium') this.setTier('low');
      }
    }
    resize() {
      const w = this.c.clientWidth || window.innerWidth, h = this.c.clientHeight || window.innerHeight;
      this.w = w; this.h = h;
      this.dpr = 1;
      this.gl.setSize(w, h, false);
      this.kit.camera.aspect = w / h;
      this.kit.camera.fov = w < 700 ? 78 : 85;
      this.kit.camera.updateProjectionMatrix();
      this.c.width = w; this.c.height = h;
      this.hud.w = w; this.hud.h = h;
    }
    push(snap, local) {
      this.localMode = !!local;
      this.buf.push({ t: performance.now(), snap });
      if (this.buf.length > 8) this.buf.shift();
    }
    sample(now) {
      const b = this.buf;
      if (!b.length) return null;
      if (b.length === 1) return { a: b[0].snap, b: b[0].snap, t: 1 };
      const BACK = 100;
      const target = now - BACK;
      let a = b[0], bb = b[1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= target && b[i + 1].t >= target) { a = b[i]; bb = b[i + 1]; break; }
      if (target > b[b.length - 1].t) { a = b[b.length - 2]; bb = b[b.length - 1]; }
      const t = Math.max(0, Math.min(1, (target - a.t) / Math.max(1, bb.t - a.t)));
      return { a: a.snap, b: bb.snap, t };
    }
    mix(A, B, t) {
      const o = Object.assign({}, B);
      o.x = A.x + (B.x - A.x) * t; o.y = A.y + (B.y - A.y) * t;
      if (A.a !== undefined) { let d = B.a - A.a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; o.a = A.a + d * t; }
      if (A.z !== undefined) o.z = A.z + (B.z - A.z) * t;
      if (A.w !== undefined) o.w = A.w + (B.w - A.w) * t;
      if (A.wk !== undefined) o.wk = A.wk + (B.wk - A.wk) * t;
      if (A.mv !== undefined) o.mv = A.mv + (B.mv - A.mv) * t;
      return o;
    }
    mixList(A, B, t, key) {
      const out = [];
      const am = new Map(); (A || []).forEach(e => am.set(e[key], e));
      (B || []).forEach(e => { const a = am.get(e[key]); out.push(a ? this.mix(a, e, t) : e); });
      return out;
    }
    fpColW() { return this.tier === 'low' ? 4 : this.tier === 'medium' ? 3 : 2; }   // compat with tier tests
    consumeFx(snap) {
      const AU = window.ABAW_AUDIO; if (!AU) return;
      const cam = { x: this.ownPos ? this.ownPos.x : 0, y: this.ownPos ? this.ownPos.y : 0 };
      for (const f of (snap.fxp || snap.fx || [])) {
        const pos = { x: f.x, y: f.y };
        switch (f.type) {
          case 'shot': AU.SFX.shot(f.w, pos, cam, this.w); break;
          case 'blood':
            AU.SFX.hit(pos, cam, this.w, (f.n || 0) > 7);
            if (f.by && f.by === this.youId) { this.hud.hitT = 0.14; this.hud.hitCrit = (f.n || 0) > 7; }
            break;
          case 'die': AU.SFX.die(pos, cam, this.w, f.type); if (f.boss) AU.SFX.roar(pos, cam, this.w); break;
          case 'hurt': this.hurtFlash = 1; if (f.id === this.youId && f.sx !== undefined) { this.hud.hurtDir = Math.atan2(f.sy - f.y, f.sx - f.x); this.hud.hurtDirT = 0.9; } break;
          case 'down': case 'death': AU.SFX.down(pos, cam, this.w); break;
          case 'revive': AU.SFX.revive(pos, cam, this.w); break;
          case 'breakfree': AU.SFX.smash(pos, cam, this.w); break;
          case 'ability': AU.SFX.ability(f.hero, pos, cam, this.w); break;
          case 'explode': AU.SFX.explode(pos, cam, this.w, f.big); break;
          case 'pickup': AU.SFX.pickup(pos, cam, this.w, f.kind); break;
          case 'dry': AU.SFX.dry(pos, cam, this.w); break;
          case 'reload': AU.SFX.reload(pos, cam, this.w); break;
          case 'cry': AU.SFX.cry(pos, cam, this.w); break;
          case 'screech': AU.SFX.screech(pos, cam, this.w); break;
        }
      }
    }
    draw(now, dt) {
      const s = this.sample(now);
      if (!s || !this.kit.level) return;
      const snap = s.b;
      const ents = {
        surv: this.mixList(s.a.surv, snap.surv, s.t, 'id'),
        en: this.mixList(s.a.en, snap.en, s.t, 'i'),
        it: snap.it, tr: snap.tr, pr: snap.pr, hz: snap.hz, cp: snap.cp
      };
      if (!this.localMode && this.youId && this.predOwn) {
        const me = ents.surv.find(e => e.id === this.youId);
        if (me && !me.dd) { me.x = this.predOwn.x; me.y = this.predOwn.y; }
      }
      const ownE = this.youId ? ents.surv.find(e => e.id === this.youId) : null;
      this.ownPos = ownE && !ownE.dd ? { x: ownE.x, y: ownE.y } : null;
      // pitch: consume accumulated input, then gentle Manananggal look-up assist
      this.pitch = Math.max(-1.15, Math.min(1.15, (this.pitch || 0) + (this.pitchInput || 0)));
      this.pitchInput = 0;
      const boss = (ents.en || []).find(e => e.t === 'manananggal' && (e.z || 0) > 26);
      if (boss && this.ownPos) {
        const bd = Math.hypot(boss.x - this.ownPos.x, boss.y - this.ownPos.y);
        if (bd < 1100) {
          const want = Math.atan2((boss.z || 0) + 34 - EYE, Math.max(bd, 90));
          this.pitch += (Math.min(want, 1.1) - this.pitch) * Math.min(1, dt * 1.1) * 0.55;
        }
      }
      this.kit.pitch = this.pitch;
      this.consumeFx(snap);
      const me = ownE;
      this.kit.setWeapon(me && me.wp);
      this.kit.sync(ents, me, this.yaw, dt);
      const yv = (this.yaw - (this._pyaw === undefined ? this.yaw : this._pyaw)) / Math.max(dt, 1e-4);
      this._pyaw = this.yaw; this.yawVel = yv;
      const kick = this.fpMuzzle > 0 ? this.fpMuzzle / 0.07 : 0;
      if (this.fpMuzzle > 0) this.fpMuzzle -= dt;
      this.kit.animateVm(dt, this.fpMoving, kick, me && me.rl > 0 ? me.rl : 0, Math.max(-3, Math.min(3, this.yawVel || 0)));
      this.kit.weather(dt);
      // zone streaming: hide dressing chunks beyond ~2400 units of the camera
      const chunks = this.kit.world && this.kit.world.dress && this.kit.world.dress.userData ? this.kit.world.dress.userData.chunks : null;
      if (chunks && this.tier !== 'high') {
        const cp = this.kit.camera.position;
        for (let ci = 0; ci < chunks.length; ci++) {
          const c = chunks[ci], dx = c.userData.cx - cp.x, dy = c.userData.cy - cp.z;
          c.visible = dx * dx + dy * dy < 2400 * 2400;
        }
      }
      // camera shake from sim
      const sh = this.opts.shake ? (snap.cam ? snap.cam.sh : 0) : 0;
      if (sh > 0.4) this.kit.camera.position.x += (Math.random() - 0.5) * sh * 1.6, this.kit.camera.position.y += (Math.random() - 0.5) * sh * 1.2;
      this.gl.render(this.kit.scene, this.kit.camera);

      // 2D HUD overlay reuses the raycast renderer's HUD methods
      const R2 = window.ABAW_RENDER;
      if (R2) {
        bindShimMethods(this.hud);          // render.js may have loaded after us
        this.hud.yaw = this.yaw; this.hud.ownPos = this.ownPos; this.hud.youId = this.youId;
        this.hud.time = (this.hud.time || 0) + dt;
        this.hud.fpMoving = this.fpMoving; this.hud.fpMuzzle = this.fpMuzzle || 0;
        this.hud.level = this.kit.level;
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.w, this.h);
        R2.Renderer.prototype.drawHud.call(this.hud, ctx, ents, snap, dt);
        R2.Renderer.prototype.drawAwareness.call(this.hud, ctx, ents, dt);
      }
      this._fCnt++; this._fAcc += dt;
      if (this._fAcc > 0.5) { this.stats.fps = Math.round(this._fCnt / this._fAcc); this._fAcc = 0; this._fCnt = 0; }
      this.stats.ents = ents.en.length;
    }
  }

  return { THREE, SceneKit, Renderer3D, buildWorld, ENEMY_BUILDERS, WEAPON_BUILDERS, webglAvailable, makeHudShim, EYE, WALL_H };
}));
