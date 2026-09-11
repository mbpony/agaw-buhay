/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  core/data.js
   Shared design data (GDD sections 2-5). Loaded by BOTH the
   authoritative Node server and the browser client (UMD).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ABAW_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 3. THE FOUR SURVIVORS ---------- */
  const SURVIVORS = {
    berto: {
      id: 'berto', name: 'Berto Cruz', tag: 'The Tanod', role: 'Tank / Enforcer',
      weapon: 'shotgun', melee: 'Batuta',
      color: '#2f6fb5', accent: '#ffd24a', skin: '#8d5a34',
      stats: { maxHp: 125, speed: 158, stamina: 100, reviveSpeed: 1.0, ammoMul: 1.0 },
      passive: '+25% Health, knockback resistance',
      ability: {
        name: 'Sweep Blast', key: '360° batuta sweep', cd: 14, duration: 0.35,
        desc: 'Radial shockwave — heavy knockback + damage to everything within 3.2m'
      }
    },
    rhea: {
      id: 'rhea', name: 'Rhea Mercado', tag: 'Nursing Student', role: 'Field Medic',
      weapon: 'burst', melee: 'Scalpel',
      color: '#d94f6a', accent: '#8ef0c0', skin: '#a9724a',
      stats: { maxHp: 100, speed: 168, stamina: 100, reviveSpeed: 1.5, ammoMul: 1.0 },
      passive: '+50% revive speed',
      ability: {
        name: 'Adrenaline Aura', key: 'Canister burst', cd: 22, duration: 6,
        desc: 'Drops an adrenaline canister — healing aura for the whole squad (6s)'
      }
    },
    junjun: {
      id: 'junjun', name: 'Jun-Jun Santos', tag: 'Jeepney Driver', role: 'Scout / Speedster',
      weapon: 'smg', melee: 'Wrench',
      color: '#e08a2c', accent: '#5ad1ff', skin: '#9c6438',
      stats: { maxHp: 90, speed: 205, stamina: 130, reviveSpeed: 1.0, ammoMul: 1.0 },
      passive: '+20% speed',
      ability: {
        name: 'Evasive Roll', key: 'Dodge w/ i-frames', cd: 6, duration: 0.45,
        desc: 'Dash roll with invulnerability frames — escapes pins and charges'
      }
    },
    sarge: {
      id: 'sarge', name: 'Sarge Ramos', tag: 'Ex-ROTC Cadet', role: 'Demolition / Heavy',
      weapon: 'rifle', melee: 'Itak',
      color: '#4f8f4a', accent: '#ff8a3c', skin: '#8a5c36',
      stats: { maxHp: 110, speed: 165, stamina: 110, reviveSpeed: 1.0, ammoMul: 1.3 },
      passive: '+30% ammo capacity',
      ability: {
        name: 'Molotov Barrage', key: 'Incendiary throw', cd: 26, duration: 8,
        desc: 'Lobs 3 molotovs in a spread — burning ground that melts hordes'
      }
    }
  };
  const SURVIVOR_ORDER = ['berto', 'rhea', 'junjun', 'sarge'];

  /* ---------- WEAPONS ---------- */
  const WEAPONS = {
    shotgun: {
      name: 'Pump Shotgun', dmg: 17, pellets: 8, spread: 0.30, range: 300, rof: 0.85,
      mag: 6, reserve: 42, reload: 2.3, shellReload: true, knock: 190, pierce: 0,
      sfx: 'shotgun', tracer: 2.4, shake: 5.5
    },
    burst: {
      name: 'Burst Rifle', dmg: 15, pellets: 1, spread: 0.045, range: 560, rof: 0.14,
      burst: 3, burstGap: 0.34, mag: 30, reserve: 180, reload: 1.9, knock: 22,
      sfx: 'rifle', tracer: 3.4, shake: 2.0, healPerKill: 0
    },
    smg: {
      name: 'Dual SMGs', dmg: 9, pellets: 1, spread: 0.10, range: 400, rof: 0.072,
      mag: 40, reserve: 240, reload: 1.7, knock: 14, dual: true,
      sfx: 'smg', tracer: 3.0, shake: 1.5
    },
    rifle: {
      name: 'Assault Rifle', dmg: 22, pellets: 1, spread: 0.055, range: 620, rof: 0.115,
      mag: 35, reserve: 210, reload: 2.1, knock: 34, pierce: 1,
      sfx: 'rifle', tracer: 4.0, shake: 2.6
    },
    molotov: { name: 'Molotov', dmg: 12, aoe: 108, burn: 7, sfx: 'fire' }
  };

  /* ---------- 4. ENEMY ROSTER ---------- */
  const ENEMIES = {
    tiyanak: {
      id: 'tiyanak', name: 'Tiyanak', variant: 'Baby Demon', tier: 'special',
      hp: 62, speed: 132, dmg: 11, radius: 15, height: 26, xp: 22,
      color: '#b9a7c9', eye: '#ff3b3b', weight: 3,
      behavior: 'lurk', // hides in darkness emitting infant cries, leaps + pins
      desc: 'Lurks in darkness emitting infant cries; leaps and pins survivors.'
    },
    batibat: {
      id: 'batibat', name: 'Batibat', variant: 'Nightmare Brute', tier: 'special',
      hp: 300, speed: 74, dmg: 18, radius: 30, height: 62, xp: 60,
      color: '#6d4a7a', eye: '#ffe066', weight: 1.4,
      behavior: 'suffocate', // tackles, pins, drains stamina
      desc: 'Massive entity that tackles and suffocates players, draining stamina.'
    },
    mangkukulam: {
      id: 'mangkukulam', name: 'Mangkukulam', variant: 'Witch / Shaman', tier: 'special',
      hp: 120, speed: 88, dmg: 9, radius: 19, height: 48, xp: 48,
      color: '#3f7d55', eye: '#a8ff60', weight: 2,
      behavior: 'caster', // acid curse pools from distance
      desc: 'Casts acid curse pools from distance, forcing players out of cover.'
    },
    pugot: {
      id: 'pugot', name: 'Pugot', variant: 'Headless Brute', tier: 'special',
      hp: 230, speed: 118, dmg: 24, radius: 26, height: 56, xp: 55,
      color: '#8c4a3a', eye: '#ff7043', weight: 1.6,
      behavior: 'charger', // high-speed charge, shatters formations
      desc: 'Charges forward at high speed, shattering survivor formations.'
    },
    common: {
      id: 'common', name: 'Bangkay', variant: 'Infected Civilian', tier: 'common',
      hp: 44, speed: 104, dmg: 8, radius: 15, height: 44, xp: 8,
      color: '#7b7f6a', eye: '#d7ff5c', weight: 6,
      behavior: 'chaser',
      desc: 'Miasma-twisted civilians. Weak alone, lethal in a flood.'
    },
    runner: {
      id: 'runner', name: 'Takas', variant: 'Sprint Infected', tier: 'common',
      hp: 30, speed: 186, dmg: 7, radius: 14, height: 42, xp: 10,
      color: '#9a8f5f', eye: '#ff9d3c', weight: 4,
      behavior: 'runner',
      desc: 'Freshly turned — still fast. Flanks and closes gaps in seconds.'
    },
    spitter: {
      id: 'spitter', name: 'Dumagat', variant: 'Bloated Infected', tier: 'common',
      hp: 90, speed: 70, dmg: 6, radius: 21, height: 46, xp: 18,
      color: '#6a8a55', eye: '#c9ff70', weight: 2,
      behavior: 'spitter', // lobs bile, dies in an acid burst
      desc: 'Bloated with miasma. Lobs bile; ruptures into acid on death.'
    },
    manananggal: {
      id: 'manananggal', name: 'Manananggal', variant: 'Act 1 Boss — Flying Horror',
      tier: 'boss', hp: 2100, speed: 128, dmg: 26, radius: 38, height: 84, xp: 900,
      color: '#5a2436', eye: '#ff2d55', weight: 0, boss: true,
      behavior: 'boss_fly',
      desc: 'Separates torso in Phase 2, attacking from air while the lower half summons swarms.'
    }
  };
  const COMMON_POOL = ['common', 'common', 'runner', 'spitter'];
  const SPECIAL_POOL = ['tiyanak', 'batibat', 'mangkukulam', 'pugot'];

  /* ---------- 5. CAMPAIGN: ACT 1 — DILIM SA MAYNILA ---------- */
  const STAGES = [
    {
      id: '1-1', act: 1, name: 'Avenida Nightfall', theme: 'Urban Ruins',
      objective: 'Navigate the flooded avenues and reach the Rizal Avenue overpass.',
      seed: 20250911, w: 96, h: 96, tile: 46, biome: 'avenue',
      flow: [
        { type: 'traverse', label: 'Push down the flooded avenue', dist: 0.0 },
        { type: 'clear', label: 'Clear the subway track entrance', dist: 0.42 },
        { type: 'hold', label: 'Hold the barricade while it is breached', dist: 0.66, holdTime: 45 },
        { type: 'traverse', label: 'Reach the overpass extraction', dist: 1.0 }
      ],
      director: { base: 0.62, ramp: 0.95, specials: true, boss: null, hordeEvery: 52 },
      ambient: 'rain_heavy', light: 0.20
    },
    {
      id: '1-2', act: 1, name: 'LRT Station Zero', theme: 'Urban Ruins',
      objective: 'Restart the station generators, then clear the subway tracks.',
      seed: 771204, w: 88, h: 100, tile: 46, biome: 'station',
      flow: [
        { type: 'traverse', label: 'Descend into LRT Station Zero', dist: 0.0 },
        { type: 'objective', label: 'Restart 2 backup generators', dist: 0.35, count: 2, kind: 'generator' },
        { type: 'hold', label: 'Defend the lit platform — horde incoming', dist: 0.62, holdTime: 60 },
        { type: 'traverse', label: 'Clear the subway tracks to the service tunnel', dist: 1.0 }
      ],
      director: { base: 0.70, ramp: 1.00, specials: true, boss: null, hordeEvery: 46 },
      ambient: 'dark_indoor', light: 0.10
    },
    {
      id: '1-3', act: 1, name: 'Skyway Escape', theme: 'Urban Ruins',
      objective: 'Fight up the Skyway ramp and kill the Manananggal before it grounds the chopper.',
      seed: 990413, w: 100, h: 104, tile: 46, biome: 'skyway',
      flow: [
        { type: 'traverse', label: 'Ascend the collapsed Skyway ramp', dist: 0.0 },
        { type: 'hold', label: 'Repair the ramp barricade under fire', dist: 0.34, holdTime: 45 },
        { type: 'boss', label: 'MANANANGGAL — destroy the lower half, then the torso', dist: 0.66, boss: 'manananggal' },
        { type: 'extract', label: 'Survive the extraction countdown', dist: 1.0, extractTime: 55 }
      ],
      director: { base: 0.80, ramp: 1.10, specials: true, boss: 'manananggal', hordeEvery: 40 },
      ambient: 'rain_storm', light: 0.16
    }
  ];

  /* ---------- ACTS (Act 1 unlocked; 2-4 shown as locked) ---------- */
  const ACTS = [
    { id: 1, name: 'Dilim sa Maynila', sub: 'Urban Ruins', stages: ['1-1', '1-2', '1-3'], unlocked: true },
    { id: 2, name: 'Sumpa sa Bukid', sub: 'Rural Countryside', stages: ['2-1', '2-2', '2-3'], unlocked: false, boss: 'Kapre' },
    { id: 3, name: 'Kagubatan', sub: 'Sierra Madre', stages: ['3-1', '3-2', '3-3'], unlocked: false, boss: 'Tikbalang' },
    { id: 4, name: 'Ang Bulkan', sub: 'Mount Mayon', stages: ['4-1', '4-2', '4-3'], unlocked: false, boss: 'Bungisngis' }
  ];

  const DIFFICULTIES = {
    normal:   { name: 'Normal',   hpMul: 0.95, dmgMul: 0.78, spawnMul: 0.88, scoreMul: 1.0, ammoMul: 1.15 },
    veteran:  { name: 'Veteran',  hpMul: 1.30, dmgMul: 1.10, spawnMul: 1.10, scoreMul: 1.5, ammoMul: 1.00 },
    nightmare:{ name: 'Nightmare',hpMul: 1.75, dmgMul: 1.45, spawnMul: 1.35, scoreMul: 2.2, ammoMul: 0.80 }
  };

  /* ---------- PICKUPS ---------- */
  const PICKUPS = {
    ammo:    { name: 'Ammo Box',    color: '#ffcc44', radius: 13 },
    medkit:  { name: 'Med Kit',     color: '#5cff9d', radius: 13 },
    pills:   { name: 'Pain Pills',  color: '#9ad7ff', radius: 11 },
    adrenaline:{ name: 'Adrenaline',color: '#ff6ad5', radius: 11 }
  };

  const TILE = { FLOOR: 0, WALL: 1, WATER: 2, RUBBLE: 3, RAIL: 4, ROAD: 5, BLOCK: 6, GAP: 7 };

  return {
    SURVIVORS, SURVIVOR_ORDER, WEAPONS, ENEMIES, COMMON_POOL, SPECIAL_POOL,
    STAGES, ACTS, DIFFICULTIES, PICKUPS, TILE,
    VERSION: '1.0.0-act1',
    stageById: (id) => STAGES.find(s => s.id === id) || null
  };
});
