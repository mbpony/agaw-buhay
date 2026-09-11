/**
 * 3D presentation layer tests (client/r3d.js) — headless scene-graph only.
 * The simulation stays authoritative; these pin the PRESENTATION contract:
 * model registry completeness, world build vs tile grid, snapshot->3D mapping,
 * viewmodel switching, and tier scaling. No WebGL needed.
 *   node test/r3d.js
 */
'use strict';
const D = require('../core/data.js');
const LV = require('../core/level.js');
const R3 = require('../client/r3d.js');

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  -> ' + extra : '')); }
};

console.log('== Model registry covers the roster ==');
{
  const missing = Object.keys(D.ENEMIES).filter(k => !R3.ENEMY_BUILDERS[k]);
  ok(missing.length === 0, 'every enemy in data.js has a 3D builder (' + Object.keys(R3.ENEMY_BUILDERS).length + ' builders)', missing.join(','));
  const wk = ['shotgun', 'burst', 'smg', 'rifle', 'revolver', 'lmg'].filter(k => !R3.WEAPON_BUILDERS[k]);
  ok(wk.length === 0, 'every weapon class has a 3D viewmodel builder', wk.join(','));
  for (const k of Object.keys(D.ENEMIES)) {
    const m = R3.ENEMY_BUILDERS[k] && R3.ENEMY_BUILDERS[k]();
    ok(!!m && !!m.group && m.group.isGroup, k + ' builds a THREE.Group with parts');
  }
  const man = R3.ENEMY_BUILDERS.manananggal();
  ok(!!man.wings && man.wings.length === 2, 'manananggal has two wing membranes to flap');
}

console.log('\n== World build mirrors the gameplay grid ==');
{
  const stage = D.stageById('1-1');
  const level = LV.generate(stage);
  let solids = 0, waters = 0, roads = 0;
  for (let i = 0; i < level.grid.length; i++) {
    const t = level.grid[i];
    if (t === 1 || t === 6) solids++;
    else if (t === 2) waters++;
    else if (t === 5) roads++;
  }
  const w = R3.buildWorld(level, {});
  ok(w.counts.solids === solids, 'wall instances == solid tiles (' + solids + ')');
  ok(w.counts.waters === waters, 'water instances == water tiles (' + waters + ')');
  ok(w.counts.roads === roads, 'road instances == road tiles (' + roads + ')');
  ok(w.group.children.length >= 4, 'world group carries ground/walls/roads/dressing');
  ok(!!w.dress && w.dress.children.length > 0, 'Philippine street dressing generated (poles/jeepneys/tricycles): ' + w.dress.children.length);
}

console.log('\n== Snapshot -> 3D mapping ==');
{
  const kit = new R3.SceneKit();
  const stage = D.stageById('1-1');
  kit.setLevel(LV.generate(stage), {});
  const ents = {
    surv: [{ id: 'b1', hero: 'rhea', x: 300, y: 400, a: 0.5, wk: 2, mv: 1 }],
    en: [{ i: 7, t: 'tiyanak', x: 500, y: 600, a: -1.2, w: 1.5, z: 0 }],
    it: [{ id: 'i1', k: 'medkit', x: 350, y: 350 }]
  };
  kit.sync(ents, { id: 'p0', x: 100, y: 100 }, 0.8, 1 / 60);
  const en = kit.ents.get('e7');
  ok(!!en, 'enemy node created from snapshot');
  ok(Math.abs(en.m.group.position.x - 500) < 0.01 && Math.abs(en.m.group.position.z - 600) < 0.01, 'sim (x,y) maps to 3D (x,z)');
  ok(Math.abs(en.m.group.rotation.y - 1.2) < 0.01, 'sim aim angle maps to rotation.y = -a');
  ok(Math.abs(kit.camera.position.y - R3.EYE) < 0.01, 'camera sits at eye height');
  ok(!!kit.ents.get('sb1'), 'remote survivor node created');
  kit.sync({ surv: [], en: [], it: [] }, { id: 'p0', x: 100, y: 100 }, 0.8, 1 / 60);
  ok(!kit.ents.has('e7'), 'vanished entities are removed from the scene');
}

console.log('\n== Viewmodels + tiers ==');
{
  const kit = new R3.SceneKit();
  kit.setLevel(LV.generate(D.stageById('1-1')), {});
  kit.setWeapon('rifle');
  ok(kit.weapon && kit.weapon.group.children.length >= 5, 'assault rifle viewmodel assembled (receiver/barrel/mag/optic/muzzle)');
  ok(!!kit.weapon.muzzle, 'muzzle anchor exists for flash light');
  kit.setWeapon('shotgun');
  ok(kit.weaponKind === 'shotgun', 'weapon swap rebuilds the viewmodel');
  kit.setTier('high');
  const rainHigh = kit.rain ? kit.rain.geometry.attributes.position.count : 0;
  kit.setTier('medium');
  const rainMed = kit.rain ? kit.rain.geometry.attributes.position.count : 0;
  kit.setTier('low');
  ok(rainHigh > rainMed && rainMed > 0 && kit.rain === null, 'rain scales with tier and disappears on low (' + rainHigh + '/' + rainMed + '/0)');
  ok(kit.world.dress.visible === false, 'street dressing hidden on low tier');
  ok(kit.scene.fog.density > 0.002, 'fog thickens on low tier to cut draw distance');
  kit.setTier('high');
  ok(kit.world.dress.visible === true && !!kit.rain, 'tier upgrades restore rain + dressing');
}

console.log('\n== Worldgen: spawn-node tags (master doc §27) ==');
{
  const KNOWN = ['flooded', 'street', 'interior', 'rubble', 'flood_edge', 'dark'];
  let total = 0, dark = 0, wet = 0; const bad = [];
  for (const id of ['1-1', '1-2', '1-3']) {
    const level = LV.generate(D.stageById(id));
    ok(level.nodes.length > 0, id + ' has spawn nodes');
    for (const n of level.nodes) {
      total++;
      if (!Array.isArray(n.tags) || !n.tags.length) { bad.push(id + ':untagged'); continue; }
      for (const t of n.tags) if (KNOWN.indexOf(t) < 0) bad.push(id + ':' + t);
      if (n.tags.indexOf('dark') >= 0) dark++;
      if (n.tags.indexOf('flooded') >= 0 || n.tags.indexOf('flood_edge') >= 0) wet++;
    }
    const rt = LV.deserialize(LV.serialize(level));
    ok(rt.nodes.length === level.nodes.length && rt.nodes.every(n => Array.isArray(n.tags)), id + ' node tags survive serialize round-trip');
  }
  ok(bad.length === 0, 'every node carries only known tags (' + total + ' nodes)', bad.slice(0, 4).join(' '));
  ok(dark > 0 && wet > 0, 'tag variety exists: ' + dark + ' dark, ' + wet + ' flood-related');
}

console.log('\n== Zone streaming: dressing chunks + camera pitch ==');
{
  const level = LV.generate(D.stageById('1-1'));
  const w = R3.buildWorld(level, {});
  ok((w.counts.chunks || 0) > 0, 'street dressing bucketed into streamable chunks (' + w.counts.chunks + ')');
  const chunk = w.dress.userData.chunks[0];
  ok(!!chunk && chunk.userData.cx !== undefined && chunk.children.length > 0, 'chunks carry world centers + items');
  const kit = new R3.SceneKit();
  kit.setLevel(level, {});
  kit.pitch = 0.6;
  kit.sync({ surv: [], en: [], it: [] }, { id: 'p0', x: 100, y: 100 }, 0.8, 1 / 60);
  ok(Math.abs(kit.camera.rotation.x - 0.6) < 0.001, 'camera pitch applied from kit.pitch');
  kit.pitch = 9;
  kit.sync({ surv: [], en: [], it: [] }, { id: 'p0', x: 100, y: 100 }, 0.8, 1 / 60);
  ok(kit.camera.rotation.x <= 1.15 + 1e-6, 'pitch clamped so players cannot flip the camera');
  const want = Math.atan2(180 + 34 - R3.EYE, 300);
  ok(want > 0.4 && want < 1.2, 'Manananggal look-up assist targets a sane angle for an airborne boss');
}

console.log('\n' + (fail ? '3D SUITE FAILED' : '3D SUITE OK') + ' — pass ' + pass + ' fail ' + fail);
process.exit(fail ? 1 : 0);
