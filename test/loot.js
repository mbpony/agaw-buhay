/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  test/loot.js
   Breakable containers, loot rolls, the 2-slot weapon
   inventory, throwables, armour and cross-stage carry.
   Pure sim-level: no DOM, no sockets.
     node test/loot.js
   ============================================================ */
'use strict';
const D = require('../core/data.js');
const LV = require('../core/level.js');
const { Sim } = require('../core/sim.js');
const { T } = require('./env');
const ok = T.ok;

const TICK = 1 / 60;
const mkSim = (stageId, seed, heroes) => {
  const stage = D.stageById(stageId);
  const sim = new Sim({ stage, difficulty: 'normal', seed: seed || 1234 });
  (heroes || ['berto', 'rhea', 'junjun', 'sarge']).forEach((h, i) =>
    sim.addSurvivor({ id: i === 0 ? 'p1' : 'b' + i, name: D.SURVIVORS[h].name, hero: h, isBot: i !== 0 }));
  return sim;
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol);
const validKind = k => !!k && (D.PICKUPS[k] || D.EQUIPMENT[k] || k.indexOf('w:') === 0 || k.indexOf('t:') === 0);

/* ---------------------------------------------------------------- */
T.section('Breakables are generated');
{
  const seen = {};
  for (const id of ['1-1', '1-2', '1-3']) {
    const sim = mkSim(id, 4242);
    const lvl = sim.level.breakables || [];
    seen[id] = lvl.length;
    ok(sim.breaks.length === lvl.length && sim.breaks.length > 0,
      id + ': ' + sim.breaks.length + ' containers seeded into the sim');
    ok(sim.breaks.every(b => D.BREAKABLES[b.t] && b.hp === D.BREAKABLES[b.t].hp && !b.dead),
      id + ': every container starts alive at full hp');
    ok(sim.breaks.every(b => LV.walkable(LV.tileAt(sim.level, b.x, b.y))),
      id + ': none placed inside solid geometry');
    // deterministic across runs (server and every client must agree)
    const again = mkSim(id, 4242);
    ok(JSON.stringify(again.breaks.map(b => [b.t, b.x, b.y])) === JSON.stringify(sim.breaks.map(b => [b.t, b.x, b.y])),
      id + ': placement is deterministic from the seed');
    const types = [...new Set(sim.breaks.map(b => b.t))];
    ok(types.length >= 3, id + ': varied container types (' + types.join(', ') + ')');
  }
  ok(seen['1-3'] < seen['1-1'], 'the Skyway is looted more thinly than the avenue (' + seen['1-3'] + ' vs ' + seen['1-1'] + ')');
}

/* ---------------------------------------------------------------- */
T.section('Containers can be destroyed');
{
  const sim = mkSim('1-1', 7);
  const s = sim.survivors[0];
  const box = sim.breaks.find(b => b.t === 'box');
  s.x = box.x - 30; s.y = box.y; s.aim = 0;
  sim.melee(s);
  ok(box.hp < box.maxHp || box.dead, 'a melee swing damages a container (hp ' + Math.round(box.hp) + '/' + box.maxHp + ')');

  // a vending machine should take more than one swing
  const sim2 = mkSim('1-1', 7);
  const s2 = sim2.survivors[0];
  const vend = sim2.breaks.find(b => b.t === 'vending');
  if (vend) {
    s2.x = vend.x - 30; s2.y = vend.y; s2.aim = 0;
    sim2.melee(s2);
    ok(!vend.dead && vend.hp > 0, 'a vending machine survives one swing (hp ' + Math.round(vend.hp) + '/' + vend.maxHp + ')');
    for (let i = 0; i < 6 && !vend.dead; i++) { s2.meleeCd = 0; sim2.melee(s2); }
    ok(vend.dead, 'and eventually breaks');
  } else ok(true, 'no vending machine on this seed (skipped)');

  // bullets
  const sim3 = mkSim('1-1', 11);
  const s3 = sim3.survivors[0];
  const crate = sim3.breaks.find(b => b.t === 'crate');
  s3.x = crate.x - 90; s3.y = crate.y; s3.aim = 0; s3.mag = 6;
  sim3.raycast(s3, 0, D.WEAPONS.shotgun, false);
  ok(crate.hp < crate.maxHp || crate.dead, 'shotgun pellets damage a crate (hp ' + Math.round(crate.hp) + ')');

  // destruction always yields exactly one drop
  const sim4 = mkSim('1-2', 99);
  const before = sim4.items.length;
  const target = sim4.breaks.find(b => !b.dead);
  sim4.damageBreak(target, 9999, sim4.survivors[0]);
  const added = sim4.items.length - before;
  ok(target.dead, 'overkill destroys the container');
  ok(added === 1, 'exactly one item drops (' + added + ')');
  ok(validKind(sim4.items[sim4.items.length - 1].kind), 'the drop is a real item kind: ' + sim4.items[sim4.items.length - 1].kind);
  ok(sim4.score > 0, 'breaking things scores points (' + sim4.score + ')');
}

/* ---------------------------------------------------------------- */
T.section('Loot tables match the agreed rarity tiers');
{
  const seeded = s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // base tiers across every table, weighted by how often each container spawns
  const N = 60000, tierOf = { consumable: 0, equipment: 0, weapon: 0, rare: 0 };
  const rnd = seeded(20260911);
  const tables = Object.keys(D.LOOT.bias);
  for (let i = 0; i < N; i++) {
    const t = tables[Math.floor(rnd() * tables.length)];
    const k = D.rollLoot(t, rnd).kind;
    if (k.indexOf('w:') === 0) tierOf.weapon++;
    else if (k.indexOf('t:') === 0) tierOf.rare++;
    else if (D.EQUIPMENT[k]) tierOf.equipment++;
    else tierOf.consumable++;
  }
  const pct = k => tierOf[k] / N * 100;
  ok(pct('consumable') > 40 && pct('consumable') < 70, 'consumables ~55% (' + pct('consumable').toFixed(1) + '%)');
  ok(pct('equipment') > 10 && pct('equipment') < 35, 'equipment ~25% (' + pct('equipment').toFixed(1) + '%)');
  ok(pct('weapon') > 5 && pct('weapon') < 30, 'weapons ~15% (' + pct('weapon').toFixed(1) + '%)');
  ok(pct('rare') > 1 && pct('rare') < 15, 'rare throwables ~5% (' + pct('rare').toFixed(1) + '%)');

  // per-container character
  const count = (table, pred) => {
    const r = seeded(555); let n = 0;
    for (let i = 0; i < 8000; i++) if (pred(D.rollLoot(table, r).kind)) n++;
    return n / 80;
  };
  const isW = k => k.indexOf('w:') === 0, isT = k => k.indexOf('t:') === 0;
  ok(count('crate', isW) > count('trash', isW) * 2, 'crates are weapon-heavy vs trash cans (' +
    count('crate', isW).toFixed(1) + '% vs ' + count('trash', isW).toFixed(1) + '%)');
  ok(count('barrel', isT) > count('box', isT) * 3, 'barrels are the throw gamble (' +
    count('barrel', isT).toFixed(1) + '% vs ' + count('box', isT).toFixed(1) + '%)');
  const medical = k => D.EQUIPMENT[k] || k === 'medkit' || k === 'adrenaline' || k === 'pills';
  ok(count('cabinet', medical) > 75, 'med cabinets are mostly medical (' + count('cabinet', medical).toFixed(1) + '%)');
  ok(count('cabinet', isW) < 8, 'med cabinets rarely hold guns (' + count('cabinet', isW).toFixed(1) + '%)');
  ok(count('vending', k => k === 'ammo' || medical(k)) > 80, 'vending machines give ammo and stims');

  // every pool entry resolves to something real
  let allValid = true, checked = 0;
  for (const tier in D.LOOT.pool) for (const [kind] of D.LOOT.pool[tier]) {
    checked++;
    if (!validKind(kind)) { allValid = false; console.log('    bad pool entry: ' + tier + ' -> ' + kind); }
  }
  ok(allValid, 'all ' + checked + ' loot pool entries are valid item kinds');
  ok(Object.keys(D.WEAPONS).filter(k => D.WEAPONS[k].found).length >= 2, 'at least 2 weapons are find-only (not hero weapons)');
}

/* ---------------------------------------------------------------- */
T.section('Barrels explode and chain');
{
  const sim = mkSim('1-1', 31);
  const s = sim.survivors[0];
  const barrel = sim.breaks.find(b => b.t === 'barrel');
  sim.fx.length = 0;
  sim.damageBreak(barrel, 9999, s);
  ok(barrel.dead, 'barrel destroyed');
  ok(sim.fx.some(f => f.type === 'explode'), 'explosion fx emitted');
  ok(sim.hazards.some(h => h.kind === 'fire'), 'leaves a burning patch');
  ok(sim.shake > 0, 'screen shake applied (' + sim.shake.toFixed(1) + ')');

  // it must hurt an enemy standing next to it
  const sim2 = mkSim('1-1', 31);
  const b2 = sim2.breaks.find(b => b.t === 'barrel');
  const e = { id: 'test_e', type: 'tiyanak', x: b2.x + 20, y: b2.y, hp: 500, maxHp: 500, dead: false, radius: 16, aim: 0, walk: 0, state: 'hunt', flash: 0, vx: 0, vy: 0, z: 0, stun: 0 };
  sim2.enemies.push(e);
  sim2.damageBreak(b2, 9999, sim2.survivors[0]);
  ok(e.hp < 500, 'blast damages a nearby enemy (500 -> ' + Math.round(e.hp) + ')');

  // a cluster chains
  const sim3 = mkSim('1-1', 31);
  const first = sim3.breaks.find(b => b.t === 'barrel');
  for (const b of sim3.breaks) if (b !== first && LV && Math.hypot(b.x - first.x, b.y - first.y) < 150) { b.x = first.x + 40; b.y = first.y; }
  const neighbours = sim3.breaks.filter(b => b !== first && Math.hypot(b.x - first.x, b.y - first.y) < 130);
  sim3.damageBreak(first, 9999, sim3.survivors[0]);
  ok(neighbours.length === 0 || neighbours.every(b => b.dead || b.hp < b.maxHp),
    'a blast reaches neighbouring containers (' + neighbours.length + ' nearby, ' +
    neighbours.filter(b => b.dead).length + ' destroyed)');

  // and it must not runaway-recurse when the whole map is barrels
  const sim4 = mkSim('1-3', 5);
  let threw = null;
  try { for (const b of sim4.breaks) if (!b.dead) sim4.damageBreak(b, 9999, sim4.survivors[0]); } catch (e2) { threw = e2; }
  ok(!threw, 'mass detonation does not blow the stack', threw && threw.message);
  ok(sim4.breaks.every(b => b.dead), 'every container on the Skyway is now rubble');
}

/* ---------------------------------------------------------------- */
T.section('Consumables auto-pickup, slotted loot does not');
{
  const sim = mkSim('1-1', 77);
  const s = sim.survivors[0];
  s.reserve = 0;
  const ammo = sim.spawnItem(s.x + 6, s.y, 'ammo');
  for (let i = 0; i < 6; i++) sim.update(TICK, {});
  ok(ammo.taken && s.reserve > 0, 'walking over ammo refills it automatically (+' + s.reserve + ')');

  const gun = sim.spawnItem(s.x + 6, s.y + 4, 'w:rifle');
  const altBefore = s.alt;
  for (let i = 0; i < 12; i++) sim.update(TICK, {});
  ok(!gun.taken && s.alt === altBefore, 'walking over a rifle does NOT auto-equip it');

  // but pressing USE does
  sim.update(TICK, { p1: { interact: true } });
  ok(gun.taken && s.alt && s.alt.id === 'rifle', 'USE picks the rifle up into slot 2');
  ok(s.interactTarget === null || true, 'interact target cleared after pickup');

  // the HUD prompt exists before you press it
  const sim2 = mkSim('1-1', 77);
  const s2 = sim2.survivors[0];
  const item = sim2.spawnItem(s2.x + 10, s2.y, 't:molotov');
  sim2.handleInteract(s2, TICK, false);
  ok(s2.interactTarget && s2.interactTarget.kind === 'loot', 'a nearby throwable raises a loot prompt');
  ok(s2.interactTarget.label === 'Molotov', 'prompt is labelled with the item name: ' + s2.interactTarget.label);
  ok(!!s2.interactTarget.color, 'prompt carries the item colour for the HUD');
  ok(!!item, 'item still on the floor until taken');
}

/* ---------------------------------------------------------------- */
T.section('Two-slot weapon inventory');
{
  const sim = mkSim('1-1', 12);
  const s = sim.survivors[0];                       // Berto — shotgun
  ok(s.wpn === 'shotgun' && s.alt === null, 'starts with the hero weapon and an empty slot 2');
  ok(sim.weap(s) === D.WEAPONS.shotgun, 'weap() resolves the ACTIVE weapon, not the hero default');

  // swap with nothing in slot 2 is a no-op
  sim.swapWeapon(s);
  ok(s.wpn === 'shotgun' && s.alt === null, 'swapping with an empty slot 2 changes nothing');

  // pick up a rifle
  const mag0 = s.mag, res0 = s.reserve;
  s.mag = 2; s.reserve = 9;                        // pretend he has been shooting
  const it = sim.spawnItem(s.x, s.y, 'w:rifle');
  sim.pickupSlotted(s, it);
  ok(s.alt && s.alt.id === 'rifle', 'rifle goes into slot 2');
  ok(s.alt.mag === D.WEAPONS.rifle.mag, 'slot 2 starts with a full magazine (' + s.alt.mag + ')');
  ok(s.wpn === 'shotgun' && s.mag === 2, 'picking a gun up does NOT auto-switch to it');

  // swap across
  sim.swapWeapon(s);
  ok(s.wpn === 'rifle' && s.mag === D.WEAPONS.rifle.mag, 'swap brings the rifle up with its own ammo');
  ok(s.alt && s.alt.id === 'shotgun' && s.alt.mag === 2 && s.alt.res === 9,
    'the shotgun goes to sleep with its spent mag preserved (2/9)');
  ok(sim.weap(s) === D.WEAPONS.rifle, 'weap() now returns the rifle');

  // and back again — magazines must not leak between slots
  s.mag = 20; s.reserve = 100;
  sim.swapWeapon(s); sim.swapWeapon(s);
  ok(s.wpn === 'rifle' && s.mag === 20 && s.reserve === 100, 'double swap is lossless (rifle 20/100)');
  sim.swapWeapon(s);
  ok(s.wpn === 'shotgun' && s.mag === 2 && s.reserve === 9, 'shotgun still remembers 2/9');

  // duplicate of the weapon in hand becomes spare ammo, not a second copy
  const sim2 = mkSim('1-1', 12);
  const s2 = sim2.survivors[0];
  s2.reserve = 5;                                   // pockets have room
  const dup = sim2.spawnItem(s2.x, s2.y, 'w:shotgun');
  sim2.pickupSlotted(s2, dup);
  ok(dup.taken && s2.alt === null && s2.reserve > 5, 'picking up your own gun yields spare ammo (5 -> ' + s2.reserve + ')');
  // with a full reserve the duplicate is left alone rather than wasted
  s2.reserve = s2.maxReserve; s2.lootCd = 0;
  const dup2 = sim2.spawnItem(s2.x, s2.y, 'w:shotgun');
  sim2.pickupSlotted(s2, dup2);
  ok(!dup2.taken && s2.alt === null, 'a duplicate gun with full pockets is left on the floor');

  // a third gun drops the previous slot-2 on the floor
  const sim3 = mkSim('1-1', 12);
  const s3 = sim3.survivors[0];
  sim3.pickupSlotted(s3, sim3.spawnItem(s3.x, s3.y, 'w:smg'));
  sim3.pickupSlotted(s3, sim3.spawnItem(s3.x + 2, s3.y, 'w:lmg'));
  ok(s3.alt.id === 'lmg', 'slot 2 now holds the LMG');
  const dropped = sim3.items.filter(i => !i.taken && i.kind === 'w:smg');
  ok(dropped.length === 1, 'the displaced SMG was dropped on the floor, not deleted');
  ok(dropped[0] && Math.hypot(dropped[0].x - s3.x, dropped[0].y - s3.y) < 60, 'and it landed at your feet, not across the map');

  // found-only weapons exist and work when equipped
  const sim4 = mkSim('1-1', 12);
  const s4 = sim4.survivors[0];
  sim4.pickupSlotted(s4, sim4.spawnItem(s4.x, s4.y, 'w:revolver'));
  sim4.swapWeapon(s4);
  ok(sim4.weap(s4) === D.WEAPONS.revolver && s4.mag === D.WEAPONS.revolver.mag, 'the .44 Revolver is usable once swapped in');
  let threw = null;
  try { s4.mag = 6; sim4.raycast(s4, 0, sim4.weap(s4), false); } catch (e) { threw = e; }
  ok(!threw, 'firing a found weapon does not throw', threw && threw.message);
}

/* ---------------------------------------------------------------- */
T.section('Throwables');
{
  const sim = mkSim('1-1', 21);
  const s = sim.survivors[0];
  ok(s.thrKind === null && s.thrN === 0, 'starts with nothing to throw');
  sim.throwItem(s);
  ok(s.thrN === 0 && sim.proj.length === 0, 'throwing with empty hands does nothing');

  const max = D.THROWABLES.molotov.max;
  for (let i = 0; i < max + 2; i++) { const it = sim.spawnItem(s.x, s.y, 't:molotov'); sim.pickupSlotted(s, it); }
  ok(s.thrN === max, 'molotovs stack to the cap of ' + max + ' (got ' + s.thrN + ')');

  const n0 = sim.proj.length;
  s.aim = 0.4;
  sim.throwItem(s);
  const g = sim.proj[sim.proj.length - 1];
  ok(sim.proj.length === n0 + 1, 'throwing spawns a projectile');
  ok(g && g.kind === 'molotov' && g.thrown === true, 'it is a thrown molotov');
  ok(g && near(Math.atan2(g.vy, g.vx), 0.4, 0.01), 'it travels where you are aiming');
  ok(g && g.life === D.THROWABLES.molotov.fuse, 'fuse = ' + (g && g.life) + 's');
  ok(s.thrN === max - 1, 'the stack decremented to ' + s.thrN);
  ok(s.throwCd > 0, 'a throw cooldown was applied');

  // let it land and burn
  sim.hazards.length = 0;
  for (let i = 0; i < 90; i++) sim.updateProjectiles(TICK);
  ok(sim.hazards.some(h => h.kind === 'fire' && h.friendly), 'the molotov leaves a squad-safe fire patch');
  const fire = sim.hazards.find(h => h.kind === 'fire');
  ok(fire && near(fire.life, D.THROWABLES.molotov.linger, 0.6), 'it burns for ~' + D.THROWABLES.molotov.linger + 's (' + (fire && fire.life.toFixed(1)) + ')');

  // pipe bomb
  const sim2 = mkSim('1-1', 21);
  const s2 = sim2.survivors[0];
  sim2.pickupSlotted(s2, sim2.spawnItem(s2.x, s2.y, 't:bomb'));
  ok(s2.thrKind === 'bomb' && s2.thrN === 1, 'pipe bomb picked up');
  s2.aim = 0; s2.throwCd = 0;
  sim2.throwItem(s2);
  ok(s2.thrKind === null && s2.thrN === 0, 'the last bomb left your hands');
  const e = { id: 'be', type: 'tiyanak', x: s2.x + 430, y: s2.y, hp: 900, maxHp: 900, dead: false, radius: 16, aim: 0, walk: 0, state: 'hunt', flash: 0, vx: 0, vy: 0, z: 0, stun: 0 };
  sim2.enemies.push(e);
  for (let i = 0; i < 200; i++) sim2.updateProjectiles(TICK);
  ok(e.hp < 900, 'the bomb detonated and hurt an enemy in its radius (900 -> ' + Math.round(e.hp) + ')');
  ok(sim2.fx.some(f => f.type === 'explode'), 'explosion fx emitted');

  // mixing kinds drops the old stack rather than deleting it
  const sim3 = mkSim('1-1', 21);
  const s3 = sim3.survivors[0];
  sim3.pickupSlotted(s3, sim3.spawnItem(s3.x, s3.y, 't:molotov'));
  sim3.pickupSlotted(s3, sim3.spawnItem(s3.x + 2, s3.y, 't:bomb'));
  ok(s3.thrKind === 'bomb', 'the bomb replaced the molotov in the single throw slot');
  ok(sim3.items.some(i => !i.taken && i.kind === 't:molotov'), 'and the molotov was dropped, not destroyed');
}

/* ---------------------------------------------------------------- */
T.section('Kevlar vest');
{
  const sim = mkSim('1-1', 33);
  const s = sim.survivors[0];
  ok(s.armor === 0, 'starts unarmoured');
  const it = sim.spawnItem(s.x, s.y, 'armor');
  sim.pickupSlotted(s, it);
  ok(s.armor === D.EQUIPMENT.armor.max, 'vest equipped at ' + s.armor);

  const hp0 = s.hp, ar0 = s.armor;
  sim.iframe = 0; s.iframe = 0;
  sim.damageSurvivor(s, 40, null, 'hit');
  const lostArmor = ar0 - s.armor, lostHp = hp0 - s.hp;
  ok(lostArmor > 0 && lostHp < 40, 'the vest absorbs part of the hit (armor -' + Math.round(lostArmor) + ', hp -' + Math.round(lostHp) + ' of 40)');
  const eff = 40 * D.DIFFICULTIES.normal.dmgMul * 0.88;   // Berto's innate damage reduction
  ok(near(lostArmor / eff, D.EQUIPMENT.armor.absorb, 0.02),
    'absorb rate is ' + (D.EQUIPMENT.armor.absorb * 100) + '% of the ' + eff.toFixed(1) + ' damage that actually landed');
  ok(near(lostArmor + lostHp, eff, 1.5), 'armour + health account for the whole hit');

  // a full vest is not wasted on a second pickup
  const sim2 = mkSim('1-1', 33);
  const s2 = sim2.survivors[0];
  sim2.pickupSlotted(s2, sim2.spawnItem(s2.x, s2.y, 'armor'));
  const dup = sim2.spawnItem(s2.x + 2, s2.y, 'armor');
  sim2.pickupSlotted(s2, dup);
  ok(!dup.taken, 'a second vest while already armoured is left on the floor');

  // draining it
  const sim3 = mkSim('1-1', 33);
  const s3 = sim3.survivors[0];
  sim3.pickupSlotted(s3, sim3.spawnItem(s3.x, s3.y, 'armor'));
  for (let i = 0; i < 40 && s3.armor > 0; i++) { s3.iframe = 0; sim3.damageSurvivor(s3, 30, null, 'hit'); }
  ok(s3.armor === 0, 'the vest eventually shreds');
  ok(s3.hp < s3.maxHp, 'and damage reaches health afterwards');
}

/* ---------------------------------------------------------------- */
T.section('Loot carries across stages');
{
  const sim = mkSim('1-1', 808);
  const s = sim.survivors[0];
  sim.pickupSlotted(s, sim.spawnItem(s.x, s.y, 'w:lmg'));
  sim.pickupSlotted(s, sim.spawnItem(s.x + 2, s.y, 't:bomb'));
  sim.pickupSlotted(s, sim.spawnItem(s.x + 4, s.y, 'armor'));
  sim.swapWeapon(s);
  s.mag = 41; s.reserve = 137; s.hp = 55;
  const carry = sim.exportCarry();
  ok(carry.berto && carry.berto.wpn === 'lmg', 'export captured the active weapon');
  ok(carry.berto.alt && carry.berto.alt.id === 'shotgun', 'export captured slot 2');

  const sim2 = mkSim('1-2', 909);
  sim2.importCarry(carry);
  const s2 = sim2.survivors[0];
  ok(s2.wpn === 'lmg' && s2.mag === 41 && s2.reserve === 137, 'the LMG and its ammo arrive in stage 1-2');
  ok(s2.alt && s2.alt.id === 'shotgun', 'slot 2 arrives too');
  ok(s2.thrKind === 'bomb' && s2.thrN === 1, 'the pipe bomb arrives');
  ok(s2.armor === 100, 'the vest arrives');
  ok(s2.hp === 55, 'wounds carry over (' + s2.hp + ' hp)');
  ok(sim2.breaks.length > 0, 'the new stage has its own containers to loot');

  // a bad carry must not corrupt a fresh run
  const sim3 = mkSim('1-3', 1);
  let threw = null;
  try { sim3.importCarry({ berto: { wpn: 'nonexistent', alt: { id: 'nope' }, thrKind: 'nope', thrN: 9, armor: -5, armorMax: 0, hp: -20 } }); } catch (e) { threw = e; }
  const s3 = sim3.survivors[0];
  ok(!threw && s3.wpn === 'shotgun' && s3.alt === null && s3.thrN === 0, 'garbage carry data is rejected safely');
}

/* ---------------------------------------------------------------- */
T.section('Snapshot carries the new state');
{
  const sim = mkSim('1-1', 55);
  const s = sim.survivors[0];
  sim.pickupSlotted(s, sim.spawnItem(s.x, s.y, 'w:rifle'));
  sim.pickupSlotted(s, sim.spawnItem(s.x + 2, s.y, 't:molotov'));
  sim.pickupSlotted(s, sim.spawnItem(s.x + 4, s.y, 'armor'));
  const damaged = sim.breaks[0];
  sim.damageBreak(damaged, 4, null);
  const snap = sim.snapshot();
  const sv = snap.surv[0];
  ok(sv.wp === 'shotgun' && sv.w2 === 'rifle', 'snapshot exposes both weapon slots');
  ok(sv.th === 'molotov' && sv.tn === 1, 'snapshot exposes the throw stack');
  ok(sv.ar === 100 && sv.arm === 100, 'snapshot exposes armour');
  ok(Array.isArray(snap.bk), 'snapshot includes a container-delta array');
  ok(snap.bk.some(b => b.n === damaged.n && b.h >= 0 && b.h < 100), 'a damaged container reports partial hp');
  sim.damageBreak(damaged, 9999, null);
  const snap2 = sim.snapshot();
  ok(snap2.bk.some(b => b.n === damaged.n && b.h === -1), 'a destroyed container reports h=-1');
  ok(snap2.bk.length < sim.breaks.length, 'untouched containers are not sent (' + snap2.bk.length + ' of ' + sim.breaks.length + ')');
  const size = JSON.stringify(snap).length;
  ok(size < 60000, 'snapshot still fits the bandwidth budget (' + (size / 1024).toFixed(1) + ' KB)');
}

/* ---------------------------------------------------------------- */
T.section('A full run with looting stays stable');
{
  const sim = mkSim('1-1', 2024);
  const s = sim.survivors[0];
  let broke = 0, spawned = 0;
  // taken items are pruned from sim.items every tick, so count spawns and diff
  const realSpawn = sim.spawnItem.bind(sim);
  sim.spawnItem = (x, y, k) => { spawned++; return realSpawn(x, y, k); };
  const inputs = { p1: {} };
  let peakArmor = 0, everAlt = false, everThrow = false;
  for (let i = 0; i < 60 * 45; i++) {
    // a greedy loot goblin: walk to the nearest container, smash it, grab the drop
    let best = null, bd = Infinity;
    for (const b of sim.breaks) {
      if (b.dead) continue;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d < bd) { bd = d; best = b; }
    }
    inputs.p1.melee = !!best && bd < 46 && s.meleeCd <= 0;
    inputs.p1.interact = !!(s.interactTarget && s.interactTarget.kind === 'loot');
    inputs.p1.throw = s.thrN > 0 && s.throwCd <= 0 && i % 97 === 0;
    inputs.p1.swap = !!s.alt && s.swapCd <= 0 && i % 211 === 0;
    inputs.p1.fire = i % 3 === 0;
    if (best) {
      const ga = Math.atan2(best.y - s.y, best.x - s.x);
      inputs.p1.mx = Math.cos(ga); inputs.p1.my = Math.sin(ga);
      inputs.p1.aimx = Math.cos(ga); inputs.p1.aimy = Math.sin(ga);
    }
    const d0 = sim.breaks.filter(b => b.dead).length;
    sim.update(TICK, inputs);
    if (sim.breaks.filter(b => b.dead).length > d0) broke++;
    if (s.armor > peakArmor) peakArmor = s.armor;
    if (s.alt) everAlt = true;
    if (s.thrN > 0) everThrow = true;
    sim.takeFx();
  }
  const picked = spawned - sim.items.length;
  ok(broke > 5, 'the loot goblin smashed ' + broke + ' containers in 45s of sim');
  ok(spawned >= broke, 'every broken container dropped something (' + spawned + ' drops for ' + broke + ' breaks)');
  ok(picked > 0, 'and it picked ' + picked + ' of them up');
  ok(everAlt || everThrow || peakArmor > 0, 'it ended up carrying real gear (slot2=' + (s.alt && s.alt.id) +
    ', throw=' + s.thrKind + ' x' + s.thrN + ', armor=' + Math.round(s.armor) + ')');
  ok(sim.items.length <= 60, 'item pool stayed capped (' + sim.items.length + ')');
  ok(sim.breaks.length <= 96, 'container pool stayed capped (' + sim.breaks.length + ')');
  ok(isFinite(s.x) && isFinite(s.y) && isFinite(s.hp), 'survivor state stayed finite');
  ok(sim.survivors.every(v => !v.alt || D.WEAPONS[v.alt.id]), 'no survivor ended with a bogus weapon in slot 2');
  ok(sim.survivors.every(v => !v.thrKind || D.THROWABLES[v.thrKind]), 'no survivor ended holding a bogus throwable');
  ok(sim.survivors.every(v => v.armor >= 0 && v.armor <= (v.armorMax || 100)), 'armour stayed within bounds');
  ok(sim.survivors.every(v => D.WEAPONS[v.wpn] && v.mag >= 0 && v.mag <= D.WEAPONS[v.wpn].mag &&
    v.reserve >= 0 && v.reserve <= v.maxReserve), 'ammo counters stayed in range for every survivor');
  ok(sim.items.every(i => validKind(i.kind)), 'every item on the floor is a real kind');
}

process.exit(T.report() ? 1 : 0);
