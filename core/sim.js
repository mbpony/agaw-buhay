/* ============================================================
   AGAW-BUHAY: SURVIVAL  —  core/sim.js
   Authoritative fixed-timestep simulation.
   Runs on the Node host server (multiplayer) AND in-browser
   (offline single player with AI bots). Emits compact snapshots
   that the renderer consumes — identical code path for both.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./level.js'));
  else root.ABAW_SIM = factory(root.ABAW_DATA, root.ABAW_LEVEL);
})(typeof self !== 'undefined' ? self : this, function (D, LV) {
  'use strict';

  const SUR = D.SURVIVORS, WEP = D.WEAPONS, EN = D.ENEMIES;
  const BRK = D.BREAKABLES, THR = D.THROWABLES, EQP = D.EQUIPMENT;
  const MAX_BREAKS = 96;
  const MAX_ENEMIES = 168, MAX_TRACERS = 220, MAX_PROJ = 90, MAX_HAZ = 60, MAX_ITEMS = 60;
  const DOWN_TIME = 40;

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const hashish = (s) => ((s.x | 0) * 0.013 + (s.y | 0) * 0.021 + (s.id ? s.id.length : 0)) % 6.28;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  class Sim {
    constructor(cfg) {
      this.stage = cfg.stage;
      this.level = cfg.level || LV.generate(cfg.stage);
      this.diff = D.DIFFICULTIES[cfg.difficulty || 'normal'];
      this.diffId = cfg.difficulty || 'normal';
      this.friendlyFire = !!cfg.friendlyFire;
      this.rnd = LV.mulberry32(cfg.seed || (cfg.stage.seed ^ 0x9e37));
      this.time = 0; this.tick = 0;
      this.phase = 'playing';
      this.survivors = []; this.enemies = []; this.tracers = []; this.proj = [];
      this.hazards = []; this.items = []; this.corpses = []; this.fx = [];
      this.breaks = [];
      this.kills = 0; this.score = 0; this.headshots = 0;
      this.shake = 0; this.flash = 0;
      this.flowIdx = 0; this.flowT = 0; this.holdT = 0; this.extractT = 0;
      this.boss = null; this.bossBody = null;
      this.announce = null; this.announceT = 0;
      this.ff = null; this.ffT = -99;
      this.cam = { x: this.level.spawn.x, y: this.level.spawn.y, zoom: 1 };
      this.dir = {
        intensity: 0.25, budget: 6, timer: 2.5, hordeT: this.stage.director.hordeEvery * 0.6,
        wave: 0, lastEvent: '', eventT: 0, stress: 0, peak: false
      };
      this.dmgTakenRecent = 0; this.dmgWindow = [];
      this.msg = [];
      // pre-place some pickups
      this.seedItems();
      this.seedBreakables();
      this.pushFx('stage_start', { name: this.stage.name, obj: this.stage.objective });
      this.setAnnounce(this.stage.name.toUpperCase(), 4);
      this.objectives = (this.level.objectives || []).map(o => Object.assign({}, o));
      this.flow = this.stage.flow.map((f, i) => Object.assign({}, f, this.level.flowAnchors[i] || {}));
    }

    /* ---------------- survivors ---------------- */
    addSurvivor(p) {
      const hero = SUR[p.hero] || SUR.berto;
      const s = {
        id: p.id, name: p.name || hero.name, hero: hero.id, isBot: !!p.isBot,
        x: this.level.spawn.x + (this.survivors.length % 2 ? 34 : -34) * (1 + Math.floor(this.survivors.length / 2)),
        y: this.level.spawn.y + Math.floor(this.survivors.length / 2) * 40,
        vx: 0, vy: 0, z: 0, aim: this.level.startDir || 0,
        hp: hero.stats.maxHp, maxHp: hero.stats.maxHp, sta: hero.stats.stamina, maxSta: hero.stats.stamina,
        down: false, dead: false, bleed: 0, reviveP: 0, reviver: null,
        wpn: hero.weapon, alt: null,
        mag: WEP[hero.weapon].mag, reserve: Math.round(WEP[hero.weapon].reserve * hero.stats.ammoMul),
        maxReserve: Math.round(WEP[hero.weapon].reserve * hero.stats.ammoMul),
        thrKind: null, thrN: 0, throwCd: 0, swapCd: 0, lootCd: 0,
        armor: 0, armorMax: 0,
        fireCd: 0, reloading: 0, burstLeft: 0, burstCd: 0,
        abCd: 0, abActive: 0, abData: null,
        sprint: false, walk: 0, moving: 0, pin: 0, pinBy: null, iframe: 0,
        hurtT: 0, healT: 0, muzzle: 0, kills: 0, dmg: 0, downs: 0, revives: 0,
        interact: 0, interactTarget: null, staminaDrain: 0,
        bot: { state: 'follow', t: 0, target: null, strafe: this.rnd() < .5 ? 1 : -1, burst: 0, think: 0, wantRevive: null },
        lastFire: 0, radius: 14, meleeCd: 0, burning: 0, dashT: 0
      };
      this.survivors.push(s);
      return s;
    }
    hero(s) { return SUR[s.hero]; }
    weap(s) { return WEP[s.wpn] || WEP[this.hero(s).weapon]; }

    aliveSurvivors() { return this.survivors.filter(s => !s.dead); }
    standingSurvivors() { return this.survivors.filter(s => !s.dead && !s.down); }

    /* ---------------- input ---------------- */
    update(dt, inputs) {
      if (this.phase !== 'playing') { this.tick++; return; }
      dt = Math.min(dt, 1 / 20);
      this.time += dt; this.tick++;
      inputs = inputs || {};

      this.updateBots(dt);
      for (const s of this.survivors) { if (!s.isBot) this.updateSurvivor(s, dt, inputs[s.id] || {}); }
      this.updateFlow(dt);
      this.updateDirector(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateHazards(dt);
      this.updateTracers(dt);
      this.updateItems(dt);
      this.cleanup();
      this.updateCamera(dt);

      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 22);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
      if (this.announceT > 0) { this.announceT -= dt; if (this.announceT <= 0) this.announce = null; }

      // stress window decay
      this.dmgWindow = this.dmgWindow.filter(d => this.time - d.t < 8);
      this.dmgTakenRecent = this.dmgWindow.reduce((a, b) => a + b.v, 0);

      // end conditions
      if (this.phase === 'playing' && this.aliveSurvivors().length === 0) this.defeat('The squad was overrun. No one made it out of the Red Zone.');
    }

    setAnnounce(text, t, sub) { this.announce = { text, sub: sub || '' }; this.announceT = t || 3; }
    pushFx(type, d) { if (this.fx.length < 260) this.fx.push(Object.assign({ type, t: this.time }, d || {})); }
    say(text) { this.msg.push({ text, t: this.time }); if (this.msg.length > 6) this.msg.shift(); }

    /* ---------------- survivor update ---------------- */
    updateSurvivor(s, dt, inp) {
      if (s.dead) return;
      const hero = this.hero(s), w = this.weap(s);
      if (s.hurtT > 0) s.hurtT -= dt;
      if (s.healT > 0) s.healT -= dt;
      if (s.muzzle > 0) s.muzzle -= dt;
      if (s.iframe > 0) s.iframe -= dt;
      if (s.abCd > 0) s.abCd -= dt;
      if (s.abActive > 0) { s.abActive -= dt; this.tickAbility(s, dt); }
      if (s.fireCd > 0) s.fireCd -= dt;
      if (s.meleeCd > 0) s.meleeCd -= dt;
      if (s.burstCd > 0) { s.burstCd -= dt; if (s.burstCd <= 0 && s.burstLeft > 0) this.fireShot(s); }

      // pinned
      if (s.pin > 0) {
        s.pin -= dt * ((inp.interact || inp.mash) ? 1.9 : 1);
        s.vx *= 0.8; s.vy *= 0.8;
        s.sta = Math.max(0, s.sta - dt * 22);
        if (s.pin <= 0) { s.pin = 0; if (s.pinBy && !s.pinBy.dead) { this.damageEnemy(s.pinBy, 40, s, true); } s.pinBy = null; this.pushFx('breakfree', { x: s.x, y: s.y }); }
        return this.postMove(s, dt);
      }

      // downed: crawl
      if (s.down) {
        s.bleed += dt;
        const sp = 46;
        const m = Math.hypot(inp.mx || 0, inp.my || 0);
        if (m > 0.1) { s.vx = (inp.mx / m) * sp; s.vy = (inp.my / m) * sp; s.walk += dt * 6; }
        else { s.vx *= 0.8; s.vy *= 0.8; }
        this.moveEntity(s, dt, 0.7);
        // revive progress is driven by the rescuer (handleInteract) and Rhea's aura
        if (s.reviver && (s.reviver.dead || s.reviver.down || s.reviver.pin > 0)) s.reviver = null;
        if (!s.reviver) s.reviveP = Math.max(0, s.reviveP - dt * 0.10);
        if (s.reviveP >= 1) {
          s.down = false; s.reviveP = 0; s.hp = Math.round(s.maxHp * 0.42); s.bleed = 0;
          s.iframe = 1.2; this.pushFx('revive', { x: s.x, y: s.y, by: s.reviver ? s.reviver.name : '' });
          if (s.reviver) { s.reviver.revives++; this.score += 120; }
          s.reviver = null; this.setAnnounce(s.name + ' IS BACK UP', 2);
        }
        if (s.bleed >= DOWN_TIME) { this.killSurvivor(s, 'bled out'); }
        return;
      }

      // reload
      if (s.reloading > 0) {
        s.reloading -= dt;
        if (s.reloading <= 0) {
          const need = w.mag - s.mag, take = Math.min(need, s.reserve);
          s.mag += take; s.reserve -= take; s.reloading = 0;
          this.pushFx('reload_end', { x: s.x, y: s.y, id: s.id });
        }
      }
      if (inp.reload && s.reloading <= 0 && s.mag < w.mag && s.reserve > 0) this.startReload(s);

      // stamina / sprint
      const wantSprint = !!(inp.sprint) && !s.down;
      const m0 = Math.hypot(inp.mx || 0, inp.my || 0);
      s.sprint = wantSprint && m0 > 0.2 && s.sta > 2 && s.reloading <= 0;
      if (s.sprint) { s.sta = Math.max(0, s.sta - dt * 17); }
      else { s.sta = Math.min(s.maxSta, s.sta + dt * (m0 > 0.2 ? 9 : 19)); }

      // movement
      let sp = hero.stats.speed * (s.sprint ? 1.42 : 1);
      if (s.reloading > 0) sp *= 0.86;
      if (s.sta <= 0.5) sp *= 0.82;
      if (m0 > 0.08) {
        const len = Math.max(1, m0);
        s.vx = ((inp.mx || 0) / len) * sp; s.vy = ((inp.my || 0) / len) * sp;
        s.walk += dt * (s.sprint ? 13 : 9); s.moving = 1;
      } else { s.vx *= 0.72; s.vy *= 0.72; s.moving *= 0.8; }
      if (inp.aimx !== undefined && (inp.aimx || inp.aimy)) s.aim = Math.atan2(inp.aimy, inp.aimx);
      this.moveEntity(s, dt, 1);

      // firing
      if (inp.fire && s.reloading <= 0 && s.fireCd <= 0 && s.burstLeft <= 0) {
        if (s.mag > 0) {
          if (w.burst) { s.burstLeft = w.burst - 1; s.burstCd = w.rof; this.fireShot(s); s.fireCd = w.burstGap; }
          else { this.fireShot(s); s.fireCd = w.rof; }
        } else { this.startReload(s); this.pushFx('dry', { x: s.x, y: s.y }); }
      }
      if (!inp.fire) { s.burstLeft = 0; }

      // melee (Batuta / Scalpel / Wrench / Itak)
      if (inp.melee && s.meleeCd <= 0) this.melee(s);

      // weapon swap (Q / SWAP) and throwables (G / THROW)
      if (s.swapCd > 0) s.swapCd -= dt;
      if (s.throwCd > 0) s.throwCd -= dt;
      if (s.lootCd > 0) s.lootCd -= dt;
      if (inp.swap && s.swapCd <= 0) this.swapWeapon(s);
      if (inp.throw && s.throwCd <= 0) this.throwItem(s);

      // ability
      if (inp.ability && s.abCd <= 0 && s.abActive <= 0) this.useAbility(s);

      // interact (generators / revives / objectives)
      this.handleInteract(s, dt, !!inp.interact);

      this.postMove(s, dt);
    }

    postMove(s, dt) {
      // out-of-combat regen: 6s without a hit and the survivor starts recovering
      if (!s.down && s.hp < s.maxHp) {
        s.noHitT = (s.noHitT || 0) + dt;
        if (s.noHitT > 6) {
          s.hp = Math.min(s.maxHp, s.hp + dt * 3.4);
          if (this.tick % 90 === 0) this.pushFx('regen', { x: s.x, y: s.y, id: s.id });
        }
      }
      // hazards damage (per-survivor tick so a pooled survivor is not double-dipped)
      s.hazT = (s.hazT || 0) - dt;
      if (s.hazT <= 0) {
        for (const h of this.hazards) {
          if (h.dead) continue;
          if (h.friendly && !this.friendlyFire) continue;   // your own molotov must not cook the squad
          const rr = h.r + 12;
          if (dist2(s.x, s.y, h.x, h.y) < rr * rr) {
            s.hazT = 0.55;
            this.damageSurvivor(s, h.dmg, null, h.kind);
            if (h.kind === 'fire') s.burning = 1.0;
            this.pushFx('haz_hit', { x: s.x, y: s.y, kind: h.kind });
            break;
          }
        }
      }
      if (s.burning > 0) { s.burning -= dt; if (this.rnd() < dt * 3) this.damageSurvivor(s, 2, null, 'fire'); }
    }

    melee(s) {
      const md = { berto: 62, rhea: 34, junjun: 40, sarge: 56 }[s.hero] || 40;
      s.meleeCd = 0.62;
      const a0 = s.aim;
      this.pushFx('melee', { x: s.x, y: s.y, a: a0, id: s.id, hero: s.hero });
      let hitAny = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
        if (d > 74 + e.radius) continue;
        let da = Math.atan2(dy, dx) - a0;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > 1.05) continue;
        hitAny = true;
        this.damageEnemy(e, md, s, false, false);
        const ka = Math.atan2(dy, dx);
        e.vx += Math.cos(ka) * (e.boss ? 20 : 260); e.vy += Math.sin(ka) * (e.boss ? 20 : 260);
        e.stun = Math.max(e.stun || 0, 0.28);
        this.pushFx('blood', { x: e.x, y: e.y, a: ka, n: 4, c: '#8e1b1b' });
      }
      // the same swing smashes loot containers in the arc
      for (const b of this.breaks) {
        if (b.dead) continue;
        const bx = b.x - s.x, by = b.y - s.y;
        const rr = 58 + (BRK[b.t].r || 15);
        if (bx * bx + by * by > rr * rr) continue;
        let da = Math.atan2(by, bx) - a0;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > 1.15) continue;
        this.damageBreak(b, md * 0.6, s);   // a swing chips containers; guns open them faster
        hitAny = true;
      }
      if (hitAny) this.shake = Math.min(12, this.shake + 3);
    }

    startReload(s) {
      const w = this.weap(s);
      if (s.reserve <= 0 || s.mag >= w.mag) return;
      s.reloading = w.reload; s.burstLeft = 0;
      this.pushFx('reload', { x: s.x, y: s.y, id: s.id });
    }

    moveEntity(e, dt) {
      const L = this.level;
      const mul = LV.speedMul(L, e.x, e.y);
      let nx = e.x + e.vx * dt * mul, ny = e.y + e.vy * dt * mul;
      const r = (e.radius || 14);
      // axis separated collision
      if (!this.blocked(nx, e.y, r)) e.x = nx; else e.vx *= -0.08;
      if (!this.blocked(e.x, ny, r)) e.y = ny; else e.vy *= -0.08;
      // deadly gaps (skyway breaches): scramble back onto the deck
      if (LV.isDeadly(L, e.x, e.y)) {
        if (e.safeX === undefined) { const w = this.findWalkable(e.x, e.y); e.safeX = w.x; e.safeY = w.y; }
        e.x = e.safeX; e.y = e.safeY;
        e.vx *= -0.3; e.vy *= -0.3;
        if (e.hero && this.time - (e.lastFall || -9) > 1.4) {
          e.lastFall = this.time;
          this.damageSurvivor(e, 10, null, 'fall');
          this.pushFx('fall', { x: e.x, y: e.y });
        }
      } else { e.safeX = e.x; e.safeY = e.y; }
      e.x = clamp(e.x, 8, L.w * L.tile - 8);
      e.y = clamp(e.y, 8, L.h * L.tile - 8);
    }
    blocked(x, y, r) {
      const L = this.level;
      for (const [ox, oy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r * .7, -r * .7], [r * .7, r * .7], [-r * .7, r * .7], [r * .7, -r * .7]])
        if (LV.isSolid(L, x + ox, y + oy)) return true;
      return false;
    }

    /* ---------------- shooting ---------------- */
    fireShot(s) {
      const w = this.weap(s);
      if (s.mag <= 0) return;
      s.mag--; s.muzzle = 0.07; s.lastFire = this.time;
      this.shake = Math.min(14, this.shake + w.shake * (s.sprint ? 1.2 : 1));
      const pellets = w.pellets || 1;
      for (let p = 0; p < pellets; p++) {
        const spread = (w.spread || 0.04) * (s.sprint ? 1.5 : 1) * (s.moving > 0.5 ? 1.15 : 1);
        const a = s.aim + (this.rnd() - 0.5) * spread * 2;
        this.raycast(s, a, w, p === 0);
      }
      // recoil kick
      s.vx -= Math.cos(s.aim) * (w.knock || 20) * 0.16;
      s.vy -= Math.sin(s.aim) * (w.knock || 20) * 0.16;
      this.pushFx('shot', { x: s.x + Math.cos(s.aim) * 20, y: s.y + Math.sin(s.aim) * 20, a: s.aim, id: s.id, w: s.wpn, dual: w.dual ? (s.mag % 2) : 0 });
      this.dir.stress = Math.min(1.6, this.dir.stress + 0.012);
    }

    raycast(shooter, angle, w, primary) {
      const L = this.level;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const range = w.range;
      let hitX = shooter.x + dx * range, hitY = shooter.y + dy * range, hitWall = true;
      const step = 7;
      let pierceLeft = w.pierce || 0;
      const hitSet = new Set();
      // wall clip
      for (let d = 12; d < range; d += step) {
        const px = shooter.x + dx * d, py = shooter.y + dy * d;
        if (LV.isSolid(L, px, py)) { hitX = px; hitY = py; hitWall = true; break; }
        hitX = px; hitY = py; hitWall = false;
      }
      // enemy hits (sorted by distance)
      const cands = [];
      for (const e of this.enemies) {
        if (e.dead) continue;
        const ex = e.x - shooter.x, ey = e.y - shooter.y;
        const proj = ex * dx + ey * dy;
        if (proj < 0 || proj > range) continue;
        const perp = Math.abs(ex * dy - ey * dx);
        const rr = (e.radius || 16) + 3;
        if (perp < rr) cands.push({ e, d: proj, perp });
      }
      // loot containers stop a round and take the damage
      for (const b of this.breaks) {
        if (b.dead) continue;
        const ex = b.x - shooter.x, ey = b.y - shooter.y;
        const proj = ex * dx + ey * dy;
        if (proj < 0 || proj > range) continue;
        const perp = Math.abs(ex * dy - ey * dx);
        if (perp < (BRK[b.t].r || 15) + 2) cands.push({ b, d: proj, perp });
      }
      cands.sort((a, b) => a.d - b.d);
      let finalX = hitX, finalY = hitY;
      for (const c of cands) {
        if (c.d > (hitWall ? Math.hypot(hitX - shooter.x, hitY - shooter.y) : range)) break;
        if (c.b) {
          this.damageBreak(c.b, w.dmg, shooter);
          finalX = c.b.x; finalY = c.b.y;
          this.pushFx('spark', { x: c.b.x, y: c.b.y, a: angle });
          break;
        }
        if (hitSet.has(c.e.id)) continue;
        const crit = c.perp < (c.e.radius || 16) * 0.42;
        let dmg = w.dmg * (crit ? 1.7 : 1) * (c.e.boss ? 1 : 1);
        this.damageEnemy(c.e, dmg, shooter, false, crit);
        hitSet.add(c.e.id);
        finalX = c.e.x; finalY = c.e.y;
        this.pushFx('blood', { x: c.e.x, y: c.e.y, a: angle, n: crit ? 9 : 5, c: c.e.boss ? '#ff2d55' : '#8e1b1b', by: shooter && shooter.id });
        if (pierceLeft-- <= 0) break;
      }
      // friendly fire on teammates
      if (this.friendlyFire && !shooter.isBot) {
        for (const o of this.survivors) {
          if (o === shooter || o.dead || o.down) continue;
          const ex = o.x - shooter.x, ey = o.y - shooter.y;
          const proj = ex * dx + ey * dy;
          if (proj < 0 || proj > range) continue;
          if (Math.abs(ex * dy - ey * dx) < 15) { this.damageSurvivor(o, w.dmg * 0.55, shooter, 'ff'); break; }
        }
      }
      if (primary !== false) {
        this.tracers.push({ x: shooter.x + dx * 18, y: shooter.y + dy * 18, x2: finalX, y2: finalY, life: 0.07, max: 0.07, w: w.tracer || 2, wall: hitWall && !hitSet.size });
        if (hitWall && !hitSet.size) this.pushFx('spark', { x: finalX, y: finalY, a: angle });
      }
    }

    damageEnemy(e, dmg, src, knockImmune, crit) {
      if (e.dead) return;
      // hitting the pinning creature shakes the survivor loose
      if (e.pinTarget && e.pinTarget.pin > 0 && !e.pinTarget.dead) {
        e.pinTarget.pin = 0; e.pinTarget.pinBy = null;
        this.pushFx('breakfree', { x: e.pinTarget.x, y: e.pinTarget.y });
        e.pinTarget = null;
      }
      e.hp -= dmg * (e.vuln === undefined ? 1 : e.vuln); e.flash = 0.12; e.lastHit = this.time;
      if (src && src.kills !== undefined) src.dmg += dmg;
      if (crit) this.headshots++;
      if (e.hp <= 0) this.killEnemy(e, src, crit);
      else {
        if (src && !knockImmune && !e.boss) {
          const a = Math.atan2(e.y - src.y, e.x - src.x), k = (this.weap(src).knock || 20) / (e.k || 1);
          e.vx += Math.cos(a) * k; e.vy += Math.sin(a) * k;
        }
        if (e.boss) e.rage = Math.min(1, (e.rage || 0) + 0.02);
      }
    }

    killEnemy(e, src, crit) {
      e.dead = true; e.deathT = this.time;
      const killDist = src ? Math.hypot(e.x - src.x, e.y - src.y) : 9999;
      this.kills++; this.score += Math.round((e.xp || 10) * this.diff.scoreMul * (crit ? 1.25 : 1));
      if (src) { src.kills++; }
      this.pushFx('die', { x: e.x, y: e.y, type: e.type, r: e.radius, a: e.aim || 0, boss: !!e.boss });
      this.corpses.push({ x: e.x, y: e.y, type: e.type, a: e.aim || 0, t: this.time, r: e.radius });
      if (this.corpses.length > 90) this.corpses.shift();
      // spitter ruptures into acid — but only if you killed it up close
      if (e.type === 'spitter' && killDist < 165) this.addHazard({ x: e.x, y: e.y, r: 54, dmg: 2.6, life: 4.5, kind: 'acid' });
      if (e.type === 'mangkukulam') { for (let i = 0; i < 2; i++) this.addHazard({ x: e.x + (this.rnd() - .5) * 80, y: e.y + (this.rnd() - .5) * 80, r: 44, dmg: 2.6, life: 4, kind: 'acid' }); }
      if (e.boss) this.onBossDeath(e);
      // drops
      const r = this.rnd();
      if (r < 0.15) this.spawnItem(e.x, e.y, 'ammo');
      else if (r < 0.225) this.spawnItem(e.x, e.y, 'medkit');
      else if (r < 0.275) this.spawnItem(e.x, e.y, 'pills');
      else if (r < 0.30) this.spawnItem(e.x, e.y, 'adrenaline');
    }

    onBossDeath(e) {
      if (e.isBody && this.bossBody === e) {
        this.bossBody = null;
        this.setAnnounce('LOWER HALF DESTROYED', 3, 'The torso is vulnerable — finish it!');
        if (this.boss) this.boss.vuln = 1;
        this.pushFx('boss_part', { x: e.x, y: e.y });
        const cur = this.flow[this.flowIdx];
        if (cur && cur.type === 'boss' && !this.boss) this.advanceFlow();
      } else if (!e.isBody) {
        this.boss = null;
        this.pushFx('boss_die', { x: e.x, y: e.y });
        this.shake = 26; this.flash = 1;
        this.setAnnounce('MANANANGGAL SLAIN', 4, 'Get to the extraction chopper!');
        this.score += 5000;
        if (this.bossBody && !this.bossBody.dead) { this.damageEnemy(this.bossBody, 99999, null); }
        const cur = this.flow[this.flowIdx];
        if (cur && cur.type === 'boss') this.advanceFlow();
      }
    }

    /* ---------------- survivor damage / down ---------------- */
    damageSurvivor(s, dmg, src, kind) {
      if (s.dead || s.iframe > 0) return;
      if (s.abActive > 0 && s.hero === 'junjun') return; // roll i-frames
      s.noHitT = 0;
      dmg = dmg * this.diff.dmgMul * (s.hero === 'berto' ? 0.88 : 1);
      // a downed survivor cannot be executed outright — creature damage accelerates the bleedout
      if (s.down) {
        if (kind !== 'ff' && kind !== 'acid' && kind !== 'fire' && kind !== 'bile' && kind !== 'fall') {
          s.bleed += dmg * 0.10; s.hurtT = 0.3;
        }
        this.pushFx('hurt_down', { x: s.x, y: s.y, id: s.id });
        return;
      }
      // kevlar soaks a share of every hit until the pool is empty
      if (s.armor > 0 && dmg > 0) {
        const soak = Math.min(s.armor, dmg * ((EQP.armor && EQP.armor.absorb) || 0.45));
        s.armor -= soak; dmg -= soak;
        this.pushFx('armor', { x: s.x, y: s.y, id: s.id, v: Math.round(soak) });
        if (s.armor <= 0) { s.armor = 0; this.pushFx('armor_break', { x: s.x, y: s.y, id: s.id }); }
      }
      if (dmg <= 0) { s.hurtT = 0.3; return; }
      s.hp -= dmg; s.hurtT = 0.42;
      this.shake = Math.min(18, this.shake + dmg * 0.16);
      this.dmgWindow.push({ t: this.time, v: dmg });
      this.pushFx('hurt', { x: s.x, y: s.y, id: s.id, kind: kind || 'hit', sx: src && src.x !== undefined ? +src.x.toFixed(1) : undefined, sy: src && src.y !== undefined ? +src.y.toFixed(1) : undefined });
      if (kind === 'ff') this.pushFx('ff', { id: s.id });
      if (src && src.isEnemy) this.dir.stress = Math.min(1.8, this.dir.stress + 0.05);
      if (s.hp <= 0) {
        if (!s.down) {
          s.down = true; s.hp = 1; s.bleed = 0; s.reviveP = 0; s.pin = 0; s.downs++;
          this.pushFx('down', { x: s.x, y: s.y, id: s.id, name: s.name });
          this.setAnnounce(s.name + ' IS DOWN', 2.6, 'Reach them and hold [E] to revive');
          this.dir.stress = Math.min(2, this.dir.stress + 0.35);
        } else this.killSurvivor(s, kind);
      }
    }
    killSurvivor(s, kind) {
      s.dead = true; s.down = false; s.hp = 0;
      this.pushFx('death', { x: s.x, y: s.y, id: s.id, name: s.name, kind });
      this.setAnnounce(s.name + ' HAS DIED', 3.4);
      this.corpses.push({ x: s.x, y: s.y, type: 'survivor', hero: s.hero, a: s.aim, t: this.time, r: 16 });
    }

    /* ---------------- abilities ---------------- */
    useAbility(s) {
      const ab = this.hero(s).ability;
      s.abCd = ab.cd; s.abActive = ab.duration;
      this.pushFx('ability', { id: s.id, hero: s.hero, x: s.x, y: s.y, a: s.aim });
      if (s.hero === 'berto') {
        this.shake = Math.min(20, this.shake + 12);
        for (const e of this.enemies) {
          if (e.dead) continue;
          const d = Math.hypot(e.x - s.x, e.y - s.y);
          if (d < 148) {
            const a = Math.atan2(e.y - s.y, e.x - s.x);
            this.damageEnemy(e, 68, s, true);
            e.vx += Math.cos(a) * (e.boss ? 30 : 430); e.vy += Math.sin(a) * (e.boss ? 30 : 430);
            e.stun = Math.max(e.stun || 0, 0.7);
          }
        }
      } else if (s.hero === 'rhea') {
        s.abData = { x: s.x, y: s.y, r: 150 };
      } else if (s.hero === 'junjun') {
        s.iframe = ab.duration + 0.1;
        const sp = 620;
        s.vx = Math.cos(s.aim) * sp; s.vy = Math.sin(s.aim) * sp;
        s.dashT = ab.duration;
      } else if (s.hero === 'sarge') {
        for (let i = -1; i <= 1; i++) {
          const a = s.aim + i * 0.30, d = 210 + Math.abs(i) * 26;
          this.proj.push({ kind: 'molotov', x: s.x, y: s.y, vx: Math.cos(a) * d * 1.5, vy: Math.sin(a) * d * 1.5, life: 0.62, z: 0, vz: 190, owner: s, r: 8 });
        }
      }
      this.dir.stress = Math.min(2, this.dir.stress + 0.08);
    }
    tickAbility(s, dt) {
      if (s.hero === 'rhea' && s.abData) {
        const a = s.abData;
        for (const o of this.survivors) {
          if (o.dead) continue;
          if (dist2(o.x, o.y, a.x, a.y) < a.r * a.r) {
            if (o.down) o.reviveP = Math.min(0.99, o.reviveP + dt * 0.055);
            else if (o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + dt * 13); o.healT = 0.2; }
            o.sta = Math.min(o.maxSta, o.sta + dt * 26);
          }
        }
        if (this.tick % 6 === 0) this.pushFx('aura', { x: a.x, y: a.y, r: a.r });
      }
      if (s.hero === 'junjun' && s.dashT > 0) { s.dashT -= dt; s.vx *= 0.94; s.vy *= 0.94; }
    }

    /* ---------------- interact ---------------- */
    handleInteract(s, dt, held) {
      s.interactTarget = null; s.interact = 0;
      // revive teammate
      let best = null, bd = 62 * 62;
      for (const o of this.survivors) {
        if (o === s || o.dead || !o.down) continue;
        const d = dist2(o.x, o.y, s.x, s.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        s.interactTarget = { kind: 'revive', id: best.id, p: best.reviveP };
        if (held) {
          if (best.reviver !== s) { best.reviver = s; }
          best.reviveP += dt * SUR[s.hero].stats.reviveSpeed / 2.0;
          s.interact = best.reviveP;
          s.vx *= 0.4; s.vy *= 0.4;
        } else if (best.reviver === s) { best.reviver = null; best.reviveP = Math.max(0, best.reviveP - dt * 0.35); }
        return;
      }
      // slotted loot: taken on press, no hold needed
      if ((s.lootCd || 0) <= 0) {
        let bi = null, bd2 = 54 * 54;
        for (const it of this.items) {
          if (it.taken || D.lootInfo(it.kind).slot === 'use') continue;
          const d = dist2(it.x, it.y, s.x, s.y);
          if (d < bd2) { bd2 = d; bi = it; }
        }
        if (bi) {
          const info = D.lootInfo(bi.kind);
          s.interactTarget = { kind: 'loot', id: bi.id, label: info.name, color: info.color };
          if (held) this.pickupSlotted(s, bi);
          return;
        }
      }
      // generators
      for (const g of this.objectives) {
        if (g.done) continue;
        if (dist2(g.x, g.y, s.x, s.y) < 74 * 74) {
          s.interactTarget = { kind: g.kind, id: g.id, p: g.progress };
          if (held) {
            g.progress += dt / 6.0; s.interact = g.progress; s.vx *= 0.4; s.vy *= 0.4;
            if (this.tick % 10 === 0) this.pushFx('wrench', { x: g.x, y: g.y, id: s.id });
            if (g.progress >= 1) {
              g.done = true;
              this.pushFx('gen_on', { x: g.x, y: g.y });
              this.level.lights.push({ x: g.x, y: g.y, r: 420, c: '#ffe6a8', f: 1, flicker: false, dyn: true });
              this.setAnnounce('GENERATOR ONLINE', 2.4);
              this.score += 400;
              const remaining = this.objectives.filter(o => !o.done).length;
              if (remaining === 0) this.advanceFlow();
            }
          } else g.progress = Math.max(0, g.progress - dt * 0.2);
          return;
        }
      }
    }

    /* ---------------- stage flow / objectives ---------------- */
    curFlow() { return this.flow[this.flowIdx]; }
    squadProgress() {
      const marks = this.level.marks;
      let best = 0;
      const alive = this.aliveSurvivors();
      if (!alive.length) return 0;
      for (const s of alive) {
        let bt = 0, bd = Infinity;
        for (let i = 0; i < marks.length; i += 2) {
          const d = dist2(s.x, s.y, marks[i].x, marks[i].y);
          if (d < bd) { bd = d; bt = marks[i].t; }
        }
        best = Math.max(best, bt);
      }
      return best;
    }
    updateFlow(dt) {
      const f = this.curFlow();
      if (!f) return;
      this.flowT += dt;
      const anchor = f;
      if (f.type === 'clear') {
        // reach the anchor, then wipe everything within it
        const p = this.squadProgress();
        f.progress = clamp(p / Math.max(0.001, f.dist), 0, 1);
        const all = this.standingSurvivors();
        const near = all.filter(s => this.survivorProgress(s) >= f.dist - 0.05);
        if (all.length && near.length === all.length) {
          const threats = this.enemies.filter(e => !e.dead && !e.boss &&
            (e.x - anchor.x) * (e.x - anchor.x) + (e.y - anchor.y) * (e.y - anchor.y) < 380 * 380).length;
          f.threats = threats;
          if (threats <= 2) { this.clearT = (this.clearT || 0) + dt; f.progress = clamp(0.55 + (this.clearT / 3.5) * 0.45, 0, 1); }
          else { this.clearT = Math.max(0, (this.clearT || 0) - dt * 0.5); f.progress = clamp(0.55 * (this.clearT / 3.5), 0, 0.55); }
          if (this.clearT >= 3.5) { this.clearT = 0; this.advanceFlow(); }
        }
      } else if (f.type === 'traverse') {
        const p = this.squadProgress();
        f.progress = clamp(p / Math.max(0.001, f.dist), 0, 1);
        const all = this.standingSurvivors();
        const near = all.filter(s => this.survivorProgress(s) >= f.dist - 0.045);
        if (all.length && near.length === all.length) this.advanceFlow();
        this.catchUpStragglers(dt);
      } else if (f.type === 'hold') {
        const inZone = this.standingSurvivors().filter(s => dist2(s.x, s.y, anchor.x, anchor.y) < anchor.r * anchor.r);
        f.progress = clamp(this.survivorProgressFor(inZone) / Math.max(0.001, f.dist), 0, 1);
        if (inZone.length && inZone.length >= Math.max(1, this.standingSurvivors().length)) {
          this.holdT += dt;
          f.holdProgress = this.holdT / f.holdTime;
          this.dir.peak = true;
          if (this.holdT >= f.holdTime) this.advanceFlow();
        } else { this.holdT = Math.max(0, this.holdT - dt * 0.55); f.holdProgress = this.holdT / f.holdTime; this.dir.peak = false; }
      } else if (f.type === 'objective') {
        const done = this.objectives.filter(o => o.done).length;
        f.progress = done / (f.count || 1);
      } else if (f.type === 'boss') {
        if (!this.boss && !this.bossSpawned) this.spawnBoss(f.boss || 'manananggal');
        f.progress = this.boss ? 1 - clamp(this.boss.hp / this.boss.maxHp, 0, 1) : 1;
      } else if (f.type === 'extract') {
        const zone = this.level.extract;
        const inZone = this.standingSurvivors().filter(s => dist2(s.x, s.y, zone.x, zone.y) < 230 * 230);
        if (inZone.length >= Math.max(1, this.standingSurvivors().length) && inZone.length > 0) {
          this.extractT += dt; this.dir.peak = true;
          f.progress = this.extractT / (f.extractTime || 70);
          if (this.extractT >= (f.extractTime || 70)) this.victory();
        } else { this.extractT = Math.max(0, this.extractT - dt * 0.4); f.progress = this.extractT / (f.extractTime || 70); this.dir.peak = false; }
      }
    }
    /** Walk the carved corridor toward a path fraction instead of beelining
        (essential on the Skyway, where the deck curves behind barriers). */
    markRoute(sv, wantT, lookahead) {
      const marks = this.level.marks;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < marks.length; i++) {
        const d = dist2(marks[i].x, marks[i].y, sv.x, sv.y);
        if (d < bd) { bd = d; bi = i; }
      }
      const ti = clamp(Math.round(clamp(wantT, 0, 1) * (marks.length - 1)), 0, marks.length - 1);
      const la = lookahead === undefined ? 4 : lookahead;
      const step = bi < ti ? Math.min(ti, bi + la) : Math.max(ti, bi - la);
      return { m: marks[step], atGoal: Math.abs(bi - ti) <= 1 };
    }

    catchUpStragglers(dt) {
      const stand = this.standingSurvivors();
      if (stand.length < 2) return;
      let lead = 0, leader = null;
      for (const s of stand) { const p = this.survivorProgress(s); if (p > lead) { lead = p; leader = s; } }
      for (const s of stand) {
        if (s === leader || !s.isBot) continue;
        const d = Math.hypot(s.x - leader.x, s.y - leader.y);
        if (d > 900) s.stragT = (s.stragT || 0) + dt; else s.stragT = 0;
        if ((s.stragT || 0) > 7) {
          s.stragT = 0;
          const p = this.findWalkable(leader.x + (this.rnd() - .5) * 120, leader.y + (this.rnd() - .5) * 120);
          this.pushFx('catchup', { x: s.x, y: s.y });
          s.x = p.x; s.y = p.y; s.iframe = Math.max(s.iframe, 1.2);
          this.pushFx('catchup', { x: s.x, y: s.y });
        }
      }
    }

    survivorProgress(s) {
      const marks = this.level.marks;
      let bd = Infinity, bt = 0;
      for (let i = 0; i < marks.length; i += 2) {
        const d = dist2(s.x, s.y, marks[i].x, marks[i].y);
        if (d < bd) { bd = d; bt = marks[i].t; }
      }
      return bt;
    }
    survivorProgressFor(list) {
      let best = 0; for (const s of list) best = Math.max(best, this.survivorProgress(s)); return best;
    }
    advanceFlow() {
      const f = this.curFlow();
      if (f) { this.pushFx('flow_done', { label: f.label }); this.score += 900; }
      this.flowIdx++; this.holdT = 0; this.dir.peak = false;
      const n = this.curFlow();
      if (!n) { this.victory(); return; }
      this.setAnnounce('OBJECTIVE UPDATE', 3, n.label);
      this.pushFx('objective', { label: n.label });
      // reward resupply between flow steps
      const alive = this.aliveSurvivors();
      alive.forEach((s, i) => {
        if (i < 2) this.spawnItem(s.x + (this.rnd() - .5) * 60, s.y + (this.rnd() - .5) * 60, 'ammo');
      });
      if (this.flowIdx % 2 === 0) this.spawnItem(n.x, n.y, 'medkit');
    }
    victory() {
      if (this.phase !== 'playing') return;
      this.phase = 'victory';
      const alive = this.aliveSurvivors().length;
      this.score += 2500 + alive * 900;
      this.pushFx('victory', { alive, total: this.survivors.length });
    }
    defeat(reason) {
      if (this.phase !== 'playing') return;
      this.phase = 'defeat'; this.defeatReason = reason;
      this.pushFx('defeat', { reason });
    }

    /* ---------------- AI DIRECTOR (GDD §6) ---------------- */
    updateDirector(dt) {
      const dir = this.dir, cfg = this.stage.director, f = this.curFlow();
      const alive = this.aliveSurvivors(), stand = this.standingSurvivors();
      const n = Math.max(1, alive.length);
      const avgHp = alive.reduce((a, s) => a + s.hp / s.maxHp, 0) / n;
      const avgAmmo = alive.reduce((a, s) => a + (s.mag / this.weap(s).mag * 0.6 + s.reserve / Math.max(1, s.maxReserve) * 0.4), 0) / n;
      const downs = alive.filter(s => s.down).length;
      const progress = this.squadProgress();

      // stress = f(health, ammo, downs, recent damage, proximity of enemies)
      let near = 0;
      for (const s of alive) for (const e of this.enemies) { if (e.dead) continue; if (dist2(s.x, s.y, e.x, e.y) < 210 * 210) { near++; break; } }
      const stress = clamp(
        (1 - avgHp) * 0.55 + (1 - avgAmmo) * 0.30 + downs * 0.22 +
        clamp(this.dmgTakenRecent / 220, 0, 0.5) + (near / n) * 0.18 + dir.stress * 0.18, 0, 1.6);
      dir.stress = Math.max(0, dir.stress - dt * 0.22);
      dir.stressAvg = stress;

      // intensity: ramps with time+progress, backs off when the squad is hurting
      const ramp = cfg.base + progress * cfg.ramp;
      const mercy = stress > 0.95 ? 0.42 : stress > 0.72 ? 0.68 : 1;
      const peakBoost = dir.peak ? 1.5 : 1;
      // a 'clear' objective that is nearly done gets a breather so it can finish
      const clearCalm = (f && f.type === 'clear' && (f.threats || 0) <= 2) ? 0.22 : 1;
      const target = clamp(ramp * mercy * peakBoost * clearCalm * (0.55 + n * 0.16), 0.18, 2.6);
      dir.intensity += (target - dir.intensity) * Math.min(1, dt * 0.55);

      // spawn budget — a boss step is a duel: the Director stands the commons down
      const bossStep = !!(f && f.type === 'boss' && (this.boss || this.bossBody));
      const popTarget = bossStep
        ? Math.round(clamp(4 + dir.intensity * 2.2, 4, 9))
        : Math.round(clamp(4 + dir.intensity * 8 * this.diff.spawnMul, 4, 40));
      dir.timer -= dt;
      const aliveEnemies = this.enemies.filter(e => !e.dead).length;
      if (dir.timer <= 0 && aliveEnemies < popTarget && this.time > 5) {
        dir.timer = clamp(1.5 / Math.max(0.35, dir.intensity), 0.4, 2.6);
        this.spawnWave(Math.max(1, Math.round((1 + dir.intensity * 1.9) * this.diff.spawnMul)), false);
      }
      // scheduled hordes
      dir.hordeT -= dt * (bossStep ? 0 : dir.peak ? 1.6 : clearCalm < 1 ? 0.25 : 1);
      if (dir.hordeT <= 0 && this.time > 26 && !bossStep) {
        dir.hordeT = cfg.hordeEvery * (0.85 + this.rnd() * 0.5);
        dir.wave++;
        this.spawnWave(Math.round((8 + dir.intensity * 7) * this.diff.spawnMul), true);
        this.setAnnounce('HORDE INCOMING', 2.6, 'Brace — they heard you');
        this.pushFx('horde', { n: dir.wave });
      }
      // specials
      if (cfg.specials && this.time > 22) {
        const specials = this.enemies.filter(e => !e.dead && e.special).length;
        const cap = Math.round(clamp(1 + dir.intensity * 1.5, 1, 6) * (n >= 3 ? 1.25 : 1));
        const cap2 = Math.min(cap, Math.max(1, Math.round(popTarget * 0.22)));
        if (specials < cap2 && this.rnd() < dt * 0.24 * dir.intensity) this.spawnSpecial();
      }
      if (dir.eventT > 0) dir.eventT -= dt;

      // ---- anti-turtle: Ang Lason ng Lupa spreads if the squad stops moving ----
      const prog = this.squadProgress();
      if (prog > (this.maxProg || 0) + 0.012) { this.maxProg = prog; this.stallT = 0; this.turtle = 0; }
      else this.stallT = (this.stallT || 0) + dt;
      if (this.stallT > 58 && this.phase === 'playing') {
        if (!this.turtle) {
          this.turtle = 1;
          this.setAnnounce('ANG LASON NG LUPA IS RISING', 4, 'The miasma is flooding the streets — MOVE FORWARD');
          this.pushFx('miasma', {});
        }
        this.turtle = Math.min(2.4, this.turtle + dt * 0.035);
        dir.intensity = Math.min(3, dir.intensity * (1 + dt * 0.35));
        if (!bossStep) dir.hordeT -= dt * 1.4;
        // creeping toxic surge behind the squad
        this.surgeT = (this.surgeT || 0) - dt;
        if (this.turtle > 1.6 && this.surgeT <= 0) {
          this.surgeT = 1;
          for (const sv of this.aliveSurvivors()) {
            if (this.survivorProgress(sv) < (this.maxProg || 0) - 0.02) {
              this.damageSurvivor(sv, 5 * this.turtle, null, 'miasma');
              if (this.tick % 60 === 0) this.pushFx('miasma_hit', { x: sv.x, y: sv.y });
            }
          }
        }
      } else if (this.stallT <= 58) this.turtle = 0;
    }

    pickNode(minDist, maxDist) {
      const alive = this.aliveSurvivors();
      if (!alive.length) return { x: this.level.spawn.x, y: this.level.spawn.y };
      let best = null, bestScore = -Infinity, tries = 0;
      while (tries++ < 22) {
        const nd = this.level.nodes[Math.floor(this.rnd() * this.level.nodes.length)];
        if (!nd) break;
        let dmin = Infinity;
        for (const s of alive) dmin = Math.min(dmin, Math.hypot(nd.x - s.x, nd.y - s.y));
        if (dmin < (minDist || 300) || dmin > (maxDist || 1500)) continue;
        // master doc §28: never materialise a monster inside a player's view cone
        let inView = false;
        for (const s of alive) {
          const dx = nd.x - s.x, dy = nd.y - s.y, d = Math.hypot(dx, dy);
          if (d > 460) continue;
          if ((dx / d) * Math.cos(s.aim) + (dy / d) * Math.sin(s.aim) > 0.64 &&
              LV.lineOfSight(this.level, s.x, s.y, nd.x, nd.y)) { inView = true; break; }
        }
        // soft preference: off-view nodes win when available, but the director
        // never starves (a starved director stalls pacing -> stalled runs)
        const score = -Math.abs(dmin - 620) + this.rnd() * 260 - (inView ? 900 : 0);
        if (score > bestScore) { bestScore = score; best = nd; }
      }
      if (!best) {
        const s = alive[Math.floor(this.rnd() * alive.length)];
        const a = this.rnd() * Math.PI * 2, d = 520 + this.rnd() * 260;
        best = { x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d };
      }
      // nudge into a walkable spot
      return this.findWalkable(best.x, best.y);
    }
    findWalkable(x, y) {
      const L = this.level;
      if (!LV.isSolid(L, x, y) && !LV.isDeadly(L, x, y)) return { x, y };
      for (let r = 1; r <= 6; r++) for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const nx = x + Math.cos(ang) * r * L.tile * 0.5, ny = y + Math.sin(ang) * r * L.tile * 0.5;
        if (!LV.isSolid(L, nx, ny) && !LV.isDeadly(L, nx, ny)) return { x: nx, y: ny };
      }
      return { x: L.spawn.x, y: L.spawn.y };
    }

    spawnWave(count, horde) {
      const pop = this.enemies.filter(e => !e.dead).length;
      const cap = Math.round(clamp(4 + this.dir.intensity * 8 * this.diff.spawnMul, 4, 40));
      const room = Math.max(0, Math.round(cap * (horde ? 1.75 : 1.25) - pop));
      count = Math.min(count, room);
      if (count <= 0) return;
      const groups = horde ? Math.min(3, count) : 1 + (this.rnd() < 0.4 ? 1 : 0);
      for (let g = 0; g < groups; g++) {
        const nd = this.pickNode(horde ? 420 : 330, horde ? 1250 : 1050);
        const per = Math.ceil(count / groups);
        for (let i = 0; i < per; i++) {
          if (this.enemies.filter(e => !e.dead).length >= MAX_ENEMIES) return;
          const jx = nd.x + (this.rnd() - .5) * 150, jy = nd.y + (this.rnd() - .5) * 150;
          const p = this.findWalkable(jx, jy);
          let type = horde && this.rnd() < 0.22 ? 'runner' : D.COMMON_POOL[Math.floor(this.rnd() * D.COMMON_POOL.length)];
          if (this.stage.biome === 'skyway' && type === 'spitter' && this.rnd() < 0.6) type = 'runner';
          this.spawnEnemy(type, p.x, p.y, { horde });
        }
        if (horde) this.pushFx('horde_spawn', { x: nd.x, y: nd.y });
      }
    }
    spawnSpecial() {
      const nd = this.pickNode(430, 1100);
      const pool = D.SPECIAL_POOL;
      let type = pool[Math.floor(this.rnd() * pool.length)];
      // stage-gated flavour: more Tiyanak in the dark station
      if (this.stage.biome === 'station' && this.rnd() < 0.4) type = 'tiyanak';
      const p = this.findWalkable(nd.x, nd.y);
      const e = this.spawnEnemy(type, p.x, p.y, { special: true });
      if (e) { e.special = true; this.pushFx('special_spawn', { x: p.x, y: p.y, type }); this.dir.lastEvent = EN[type].name; this.dir.eventT = 3; }
      return e;
    }

    spawnEnemy(type, x, y, opt) {
      const def = EN[type]; if (!def) return null;
      const e = {
        id: 'e' + (++this._eid || (this._eid = 1)), type, def, isEnemy: true,
        x, y, z: 0, vx: 0, vy: 0, radius: def.radius, height: def.height,
        hp: def.hp * this.diff.hpMul * (opt && opt.horde ? 0.94 : 1), maxHp: 0,
        speed: def.speed * (0.9 + this.rnd() * 0.22), dmg: def.dmg, xp: def.xp,
        aim: this.rnd() * 6.28, walk: this.rnd() * 6, state: 'idle', t: 0,
        atkCd: 0.6 + this.rnd(), flash: 0, stun: 0, dead: false, k: def.weight || 1,
        special: !!(opt && opt.special), boss: !!def.boss, ph: this.rnd() * 6.28,
        leap: 0, charge: 0, castT: 0, cry: 0, vuln: def.boss ? 0.35 : 1
      };
      e.maxHp = e.hp;
      this.enemies.push(e);
      return e;
    }

    spawnBoss(type) {
      this.bossSpawned = true;
      const f = this.curFlow();
      const nd = this.findWalkable(f.x, f.y);
      const e = this.spawnEnemy(type, nd.x, nd.y - 220, { special: true });
      e.boss = true; e.special = true; e.phase = 1;
      this.boss = e;
      this.shake = 22; this.flash = 0.7;
      // the miasma parts as she descends — a clean arena for the duel
      for (const h of this.hazards) if (!h.dead && h.kind !== 'fire') { h.dead = true; h.life = 0; }
      this.dir.intensity = Math.min(this.dir.intensity, 0.5);
      this.dir.hordeT = Math.max(this.dir.hordeT, 45);
      this.setAnnounce('MANANANGGAL', 4.5, 'The flying horror blocks the Skyway — bring it down');
      this.pushFx('boss_spawn', { x: e.x, y: e.y });
      this.score += 0;
      // escort pressure
      for (let i = 0; i < 5; i++) { const p = this.findWalkable(nd.x + (this.rnd() - .5) * 500, nd.y + (this.rnd() - .5) * 500); this.spawnEnemy('runner', p.x, p.y, {}); }
    }

    /* ---------------- enemy AI ---------------- */
    updateEnemies(dt) {
      const alive = this.aliveSurvivors();
      if (!alive.length) return;
      // refresh flow field periodically
      if (this.time - this.ffT > 0.42) { this.ff = LV.flowField(this.level, alive.map(s => ({ x: s.x, y: s.y }))); this.ffT = this.time; }
      const L = this.level, ff = this.ff;
      // uniform grid for separation queries
      const cs = this.gridSize = 72;
      const grid = this.grid = this.grid || new Map();
      grid.clear();
      for (const e of this.enemies) {
        if (e.dead) continue;
        const k = Math.floor(e.x / cs) + ':' + Math.floor(e.y / cs);
        let b = grid.get(k); if (!b) { b = []; grid.set(k, b); }
        b.push(e);
      }

      for (const e of this.enemies) {
        if (e.dead) continue;
        e.t += dt;
        if (e.flash > 0) e.flash -= dt;
        if (e.stun > 0) { e.stun -= dt; e.vx *= 0.86; e.vy *= 0.86; e.x += e.vx * dt; e.y += e.vy * dt; continue; }
        if (e.atkCd > 0) e.atkCd -= dt;
        // acquire target
        let tgt = e.target && !e.target.dead && !e.target.dead ? e.target : null;
        if (!tgt || this.rnd() < dt * 0.5) {
          let bd = Infinity;
          for (const s of alive) { const d = dist2(s.x, s.y, e.x, e.y); if (d < bd) { bd = d; tgt = s; } }
          e.target = tgt; e.td = Math.sqrt(bd);
        }
        if (!tgt) continue;
        const dx = tgt.x - e.x, dy = tgt.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.td = d;
        const los = d < 900 ? LV.lineOfSight(L, e.x, e.y, tgt.x, tgt.y) : false;
        e.los = los;
        const bh = e.def.behavior;

        let mvx = 0, mvy = 0, sp = e.speed;

        if (bh === 'chaser' || bh === 'runner') {
          if (los && d < 520) { mvx = dx / d; mvy = dy / d; if (bh === 'runner') sp *= 1.06 + Math.sin(e.t * 3) * 0.1; }
          else this.flowSteer(e, ff, L, out => { mvx = out[0]; mvy = out[1]; });
          if (d < e.radius + 22 && e.atkCd <= 0) this.enemyAttack(e, tgt);
        } else if (bh === 'spitter') {
          const want = 250;
          if (los && d < want - 40) { mvx = -dx / d; mvy = -dy / d; }
          else if (los && d > want + 60) { mvx = dx / d; mvy = dy / d; }
          else if (!los) this.flowSteer(e, ff, L, out => { mvx = out[0]; mvy = out[1]; });
          else { mvx = -dy / d * 0.6; mvy = dx / d * 0.6; }
          e.castT -= dt;
          if (los && d < 480 && e.castT <= 0 && e.atkCd <= 0) {
            e.castT = 2.6 + this.rnd(); e.state = 'cast'; e.aim = Math.atan2(dy, dx);
            this.proj.push({ kind: 'bile', x: e.x, y: e.y, z: 20, vx: dx / d * 250, vy: dy / d * 250, vz: 90, life: d / 250, owner: e, r: 9, dmg: e.dmg });
            this.pushFx('spit', { x: e.x, y: e.y, a: e.aim });
          }
        } else if (bh === 'lurk') {   // Tiyanak
          e.cry -= dt;
          if (e.cry <= 0) { e.cry = 3 + this.rnd() * 4; this.pushFx('cry', { x: e.x, y: e.y, type: 'tiyanak' }); }
          if (d > 190) { // lurk in darkness, creep closer
            if (los) { mvx = dx / d * 0.55; mvy = dy / d * 0.55; sp *= 0.8; }
            else this.flowSteer(e, ff, L, out => { mvx = out[0] * 0.9; mvy = out[1] * 0.9; });
            e.state = 'lurk';
          } else if (e.leap <= 0 && e.atkCd <= 0) {
            e.state = 'leap'; e.leap = 0.55; e.aim = Math.atan2(dy, dx);
            e.vx = Math.cos(e.aim) * 460; e.vy = Math.sin(e.aim) * 460;
            this.pushFx('leap', { x: e.x, y: e.y, a: e.aim });
          }
          if (e.leap > 0) {
            e.leap -= dt; e.z = Math.sin((1 - e.leap / 0.55) * Math.PI) * 46;
            e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.97; e.vy *= 0.97;
            if (d < e.radius + 20 && !tgt.down && tgt.iframe <= 0 && tgt.pin <= 0) {
              this.pinSurvivor(tgt, e, 3.2); e.leap = 0; e.atkCd = 3;
            }
            if (e.leap <= 0) { e.z = 0; e.atkCd = 1.4; }
            continue;
          }
          if (d < e.radius + 20 && e.atkCd <= 0) this.enemyAttack(e, tgt);
        } else if (bh === 'suffocate') {  // Batibat
          if (d > 130) { if (los) { mvx = dx / d; mvy = dy / d; } else this.flowSteer(e, ff, L, out => { mvx = out[0]; mvy = out[1]; }); }
          else if (e.atkCd <= 0 && !tgt.down && tgt.iframe <= 0 && tgt.pin <= 0) {
            e.state = 'tackle'; this.pinSurvivor(tgt, e, 4.4); e.atkCd = 7;
            this.pushFx('tackle', { x: tgt.x, y: tgt.y });
          } else if (e.atkCd <= 0) this.enemyAttack(e, tgt);
        } else if (bh === 'caster') {  // Mangkukulam
          const want = 340;
          if (los && d < want - 60) { mvx = -dx / d; mvy = -dy / d; }
          else if (!los || d > want + 90) this.flowSteer(e, ff, L, out => { mvx = out[0]; mvy = out[1]; });
          else { mvx = -dy / d * 0.7; mvy = dx / d * 0.7; }
          e.castT -= dt;
          if (e.castT <= 0 && d < 620) {
            e.castT = 3.4 + this.rnd() * 1.6; e.state = 'cast';
            // acid curse pools under 1-2 survivors
            const victims = alive.filter(s => !s.down).slice().sort(() => this.rnd() - 0.5).slice(0, this.survivors.length > 2 ? 2 : 1);
            for (const v of victims) {
              this.pushFx('curse_warn', { x: v.x, y: v.y });
              this.proj.push({ kind: 'curse', x: v.x, y: v.y, z: 200, vx: 0, vy: 0, vz: -260, life: 0.78, owner: e, r: 10, tele: true, tx: v.x, ty: v.y });
            }
          }
        } else if (bh === 'charger') {  // Pugot
          if (e.charge > 0) {
            e.charge -= dt; e.state = 'charge';
            e.x += e.vx * dt; e.y += e.vy * dt;
            if (LV.isSolid(L, e.x, e.y)) { e.x -= e.vx * dt; e.y -= e.vy * dt; e.charge = 0; e.stun = 0.9; this.shake = Math.min(16, this.shake + 8); this.pushFx('smash', { x: e.x, y: e.y }); }
            for (const s of alive) {
              if (dist2(s.x, s.y, e.x, e.y) < (e.radius + 18) * (e.radius + 18)) {
                this.damageSurvivor(s, e.dmg, e, 'charge');
                const a = Math.atan2(s.y - e.y, s.x - e.x);
                s.vx += Math.cos(a) * (s.hero === 'berto' ? 130 : 330); s.vy += Math.sin(a) * (s.hero === 'berto' ? 130 : 330);
                if (!s.down && this.rnd() < 0.35 && s.iframe <= 0) this.pinSurvivor(s, e, 1.6);
                e.charge = 0; e.stun = 0.55; this.pushFx('smash', { x: e.x, y: e.y });
                break;
              }
            }
            if (e.charge <= 0) { e.atkCd = 2.2; e.vx = 0; e.vy = 0; }
            e.walk += dt * 20;
            continue;
          }
          if (d < 460 && (los || d < 200) && e.atkCd <= 0) {
            e.state = 'wind'; e.wind = 0.62; e.aim = Math.atan2(dy, dx);
            this.pushFx('charge_warn', { x: e.x, y: e.y, a: e.aim });
          } else if (los) { mvx = dx / d; mvy = dy / d; sp *= 0.85; }
          else this.flowSteer(e, ff, L, out => { mvx = out[0]; mvy = out[1]; });
          if (e.wind > 0) {
            e.wind -= dt; mvx = 0; mvy = 0;
            if (e.wind <= 0) { e.charge = 0.85; e.vx = Math.cos(e.aim) * 520; e.vy = Math.sin(e.aim) * 520; this.pushFx('charge_go', { x: e.x, y: e.y, a: e.aim }); }
            continue;
          }
          if (d < e.radius + 22 && e.atkCd <= 0) this.enemyAttack(e, tgt);
        } else if (bh === 'boss_fly') {
          this.updateBoss(e, dt, alive, tgt, d, dx, dy, los);
          continue;
        }

        // separation from nearby enemies (uniform grid)
        let sx = 0, sy = 0;
        const cell = this.grid, cs = this.gridSize;
        const gx0 = Math.floor(e.x / cs), gy0 = Math.floor(e.y / cs);
        for (let cy = gy0 - 1; cy <= gy0 + 1; cy++) for (let cx = gx0 - 1; cx <= gx0 + 1; cx++) {
          const bucket = cell.get(cx + ':' + cy);
          if (!bucket) continue;
          for (const o of bucket) {
            if (o === e || o.dead || o.boss) continue;
            const ox = e.x - o.x, oy = e.y - o.y;
            const dd = ox * ox + oy * oy, rr = (e.radius + o.radius);
            if (dd < rr * rr && dd > 0.01) { const l = Math.sqrt(dd); sx += ox / l * (1 - l / rr); sy += oy / l * (1 - l / rr); }
          }
        }
        mvx += sx * 1.5; mvy += sy * 1.5;
        const ml = Math.hypot(mvx, mvy);
        if (ml > 0.001) {
          e.vx += ((mvx / ml) * sp - e.vx) * Math.min(1, dt * 7);
          e.vy += ((mvy / ml) * sp - e.vy) * Math.min(1, dt * 7);
          e.aim = Math.atan2(e.vy, e.vx);
          e.walk += dt * (sp / 26);
        } else { e.vx *= 0.85; e.vy *= 0.85; }
        this.moveEnemy(e, dt);
      }
    }

    flowSteer(e, ff, L, out) {
      if (!ff) { out([0, 0]); return; }
      const gx = clamp(Math.floor(e.x / L.tile), 0, L.w - 1), gy = clamp(Math.floor(e.y / L.tile), 0, L.h - 1);
      let best = ff[gy * L.w + gx], bx = 0, by = 0;
      if (best < 0) best = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = gx + ox, ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
        const v = ff[ny * L.w + nx];
        if (v >= 0 && v < best) { best = v; bx = ox; by = oy; }
      }
      out([bx, by]);
    }
    moveEnemy(e, dt) {
      const L = this.level;
      if (!e.flying && LV.isDeadly(L, e.x + e.vx * dt, e.y + e.vy * dt)) { e.vx *= -0.4; e.vy *= -0.4; }
      const mul = e.flying ? 1 : LV.speedMul(L, e.x, e.y);
      const nx = e.x + e.vx * dt * mul, ny = e.y + e.vy * dt * mul;
      if (e.flying) { e.x = nx; e.y = ny; e.x = clamp(e.x, 10, L.w * L.tile - 10); e.y = clamp(e.y, 10, L.h * L.tile - 10); return; }
      if (!this.blocked(nx, e.y, e.radius * 0.8)) e.x = nx; else { e.vx *= -0.2; e.nudge = 0.4; }
      if (!this.blocked(e.x, ny, e.radius * 0.8)) e.y = ny; else { e.vy *= -0.2; e.nudge = 0.4; }
      if (e.nudge > 0) { e.nudge -= dt; e.x += (this.rnd() - .5) * 26 * dt * 8; }
    }

    meleeTokens() {
      const log = this.atkLog = (this.atkLog || []).filter(t => this.time - t < 0.85);
      return log.length;
    }
    enemyAttack(e, tgt) {
      e.atkCd = 1.45 + this.rnd() * 0.85;
      e.state = 'attack'; e.atkT = 0.28; e.aim = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      // only a few creatures can land blows at once — the rest circle and snarl
      const cap = 1 + Math.ceil(this.standingSurvivors().length / 2) + (this.diffId === 'nightmare' ? 2 : this.diffId === 'veteran' ? 1 : 0);
      if (this.meleeTokens() >= cap) { e.atkCd = 0.55; e.state = 'circle'; return; }
      this.atkLog.push(this.time);
      this.pushFx('swipe', { x: e.x, y: e.y, a: e.aim, type: e.type });
      if (tgt.iframe > 0 || tgt.dead) return;
      this.damageSurvivor(tgt, e.dmg, e, 'melee');
      const a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      const kr = tgt.hero === 'berto' ? 0.35 : 1;
      tgt.vx += Math.cos(a) * 90 * kr; tgt.vy += Math.sin(a) * 90 * kr;
    }
    pinSurvivor(s, e, dur) {
      if (s.dead || s.down || s.iframe > 0) return;
      s.pin = dur; s.pinBy = e; e.pinTarget = s; s.vx = 0; s.vy = 0;
      this.pushFx('pin', { x: s.x, y: s.y, id: s.id, by: e.type });
      this.setAnnounce(s.name + ' IS PINNED', 2.2, 'Mash [E] or shoot the ' + (EN[e.type] ? EN[e.type].name : 'creature'));
      this.dir.stress = Math.min(2, this.dir.stress + 0.25);
      this.damageSurvivor(s, e.dmg * 0.4, e, 'pin');
    }

    /* ---------------- MANANANGGAL BOSS ---------------- */
    updateBoss(e, dt, alive, tgt, d, dx, dy, los) {
      const hpFrac = e.hp / e.maxHp;
      if (e.phase === 1 && hpFrac < 0.62 && !this.bossBody) {
        e.phase = 2; e.flying = true; e.z = 120;
        this.shake = 20; this.flash = 0.8;
        this.setAnnounce('IT SEPARATED!', 3.4, 'Destroy the LOWER HALF — the torso is nearly immune');
        this.pushFx('boss_split', { x: e.x, y: e.y });
        // lower half
        const body = this.spawnEnemy('manananggal', e.x, e.y, { special: true });
        body.isBody = true; body.boss = true; body.phase = 2; body.hp = body.maxHp = 1250 * this.diff.hpMul;
        body.speed = 42; body.radius = 34; body.def = Object.assign({}, EN.manananggal, { behavior: 'boss_body' });
        this.bossBody = body;
        e.vuln = 0.18;
      }
      if (e.isBody) {
        // lower half: crawls, summons swarms, spits viscera
        e.castT -= dt;
        if (los && d > 200) { e.vx += (dx / d) * 30 * dt * 6; e.vy += (dy / d) * 30 * dt * 6; }
        e.vx *= 0.9; e.vy *= 0.9;
        if (e.castT <= 0) {
          e.castT = 8.5; e.state = 'summon';
          const n = 3 + Math.floor(this.rnd() * 2);
          this.pushFx('summon', { x: e.x, y: e.y });
          for (let i = 0; i < n; i++) {
            const a = this.rnd() * Math.PI * 2, r = 70 + this.rnd() * 130;
            const p = this.findWalkable(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
            this.spawnEnemy(this.rnd() < 0.4 ? 'runner' : 'common', p.x, p.y, {});
          }
        }
        if (d < e.radius + 30 && e.atkCd <= 0) this.enemyAttack(e, tgt);
        e.walk += dt * 4;
        this.moveEnemy(e, dt);
        return;
      }
      // torso: flies, dive-bombs, throws viscera
      e.z += ((e.phase === 2 ? 118 : 0) - e.z) * Math.min(1, dt * 3);
      e.flyT = (e.flyT || 0) - dt;
      e.atkCd -= dt;
      const hover = 190;
      if (e.dive > 0) {
        e.dive -= dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.z = Math.max(10, e.z - dt * 420);
        for (const s of alive) {
          if (dist2(s.x, s.y, e.x, e.y) < (e.radius + 20) * (e.radius + 20) && s.iframe <= 0) {
            this.damageSurvivor(s, e.dmg, e, 'dive');
            const a = Math.atan2(s.y - e.y, s.x - e.x);
            s.vx += Math.cos(a) * 380; s.vy += Math.sin(a) * 380;
            this.shake = Math.min(20, this.shake + 10);
            e.dive = 0; e.z = 90; e.atkCd = 2.6;
            this.pushFx('dive_hit', { x: s.x, y: s.y });
            break;
          }
        }
        if (e.dive <= 0) { e.atkCd = 2.4; e.z = 100; }
        e.walk += dt * 24;
        return;
      }
      // reposition above a target
      if (!e.hoverT || e.hoverT <= 0) {
        const pick = alive[Math.floor(this.rnd() * alive.length)];
        e.htx = pick.x + (this.rnd() - .5) * 180; e.hty = pick.y + (this.rnd() - .5) * 180;
        e.hoverT = 2.2 + this.rnd() * 1.6;
      }
      e.hoverT -= dt;
      const hx = e.htx - e.x, hy = e.hty - e.y, hd = Math.hypot(hx, hy) || 1;
      const sp = e.speed * 1.5;
      e.vx += ((hx / hd) * sp - e.vx) * Math.min(1, dt * 2.4);
      e.vy += ((hy / hd) * sp - e.vy) * Math.min(1, dt * 2.4);
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = clamp(e.x, 20, this.level.w * this.level.tile - 20);
      e.y = clamp(e.y, 20, this.level.h * this.level.tile - 20);
      e.aim = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      e.walk += dt * 10;
      if (e.atkCd <= 0) {
        const roll = this.rnd();
        if (roll < 0.45 && d < 620) {         // dive bomb
          e.dive = 0.62; e.state = 'dive';
          const a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
          e.vx = Math.cos(a) * 520; e.vy = Math.sin(a) * 520;
          this.pushFx('dive_warn', { x: tgt.x, y: tgt.y });
          e.atkCd = 3.2 + this.rnd() * 1.2;
          this.shake = Math.min(12, this.shake + 5);
        } else {                              // viscera volley
          e.state = 'cast';
          for (let i = -1; i <= 1; i += 2) {
            const a = e.aim + i * 0.20;
            this.proj.push({ kind: 'viscera', x: e.x, y: e.y, z: e.z, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, vz: -60, life: 1.6, owner: e, r: 11, dmg: 11 });
          }
          this.pushFx('boss_cast', { x: e.x, y: e.y, z: e.z });
          e.atkCd = 2.6 + this.rnd() * 1.2;
        }
      }
    }

    /* ---------------- projectiles ---------------- */
    updateProjectiles(dt) {
      const L = this.level;
      for (const p of this.proj) {
        if (p.dead) continue;
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vz !== undefined) { p.z += p.vz * dt; p.vz -= 340 * dt; if (p.z < 0) p.z = 0; }
        if (p.kind === 'molotov' || p.kind === 'bomb') {
          const tw = p.thrown ? THR[p.kind] : null;
          const wallHit = p.kind === 'bomb' && LV.isSolid(L, p.x, p.y);
          if (p.life <= 0 || p.z <= 0.5 || wallHit) {
            p.dead = true;
            if (p.kind === 'molotov') {
              const r = tw ? tw.aoe * 0.78 : 88, life = tw ? tw.linger : 6, hd = tw ? tw.dmg : 7;
              this.addHazard({ x: p.x, y: p.y, r, dmg: hd, life, kind: 'fire', friendly: true });
              this.pushFx('explode', { x: p.x, y: p.y, r: tw ? tw.aoe : 104, kind: 'fire' });
              this.shake = Math.min(16, this.shake + 6);
              const burst = tw ? tw.dmg * 2.6 : 40;
              for (const e of this.enemies) if (!e.dead && dist2(e.x, e.y, p.x, p.y) < 130 * 130) this.damageEnemy(e, burst, p.owner, true);
              if (tw) this.damageBreaksIn(p.x, p.y, tw.aoe, burst * 0.6, p.owner);
            } else {
              this.detonate(p.x, p.y, tw ? tw.dmg : 150, tw ? tw.aoe : 168, p.owner, 'boom');
            }
          }
          continue;
        }
        if (p.kind === 'curse') {
          if (p.life <= 0) {
            p.dead = true;
            this.addHazard({ x: p.tx, y: p.ty, r: 76, dmg: 3.2, life: 5, kind: 'acid' });
            this.pushFx('explode', { x: p.tx, y: p.ty, r: 92, kind: 'acid' });
          }
          continue;
        }
        // bile / viscera: impact on survivors or ground
        if (LV.isSolid(L, p.x, p.y) || p.life <= 0 || (p.z <= 0 && p.vz < 0 && p.kind !== 'molotov')) {
          p.dead = true;
          const kind = p.kind === 'viscera' ? 'blood' : 'acid';
          this.addHazard({ x: p.x, y: p.y, r: p.kind === 'viscera' ? 40 : 56, dmg: p.kind === 'viscera' ? 4 : 3, life: kind === 'blood' ? 2.4 : 4.5, kind });
          this.pushFx('explode', { x: p.x, y: p.y, r: 60, kind });
          continue;
        }
        for (const s of this.survivors) {
          if (s.dead || s.iframe > 0) continue;
          const rr = 15 + (p.r || 8);
          if (dist2(s.x, s.y, p.x, p.y) < rr * rr) {
            p.dead = true;
            this.damageSurvivor(s, p.dmg || 8, p.owner, p.kind);
            this.pushFx('explode', { x: p.x, y: p.y, r: 46, kind: p.kind === 'viscera' ? 'blood' : 'acid' });
            break;
          }
        }
      }
    }
    addHazard(h) {
      if (this.hazards.length >= MAX_HAZ) this.hazards.shift();
      if (h.kind === 'acid') {
        const acids = this.hazards.filter(z => z.kind === 'acid' && !z.dead);
        if (acids.length >= 12) { acids[0].dead = true; acids[0].life = 0; }
      }
      this.hazards.push(Object.assign({ t: this.time, dead: false, id: 'h' + (++this._hid || (this._hid = 1)) }, h));
    }
    updateHazards(dt) {
      for (const h of this.hazards) {
        if (h.dead) continue;
        h.life -= dt;
        if (h.life <= 0) { h.dead = true; this.pushFx('haz_end', { x: h.x, y: h.y, kind: h.kind }); }
        if (h.kind === 'fire' && this.tick % 8 === 0) this.pushFx('flame', { x: h.x + (this.rnd() - .5) * h.r, y: h.y + (this.rnd() - .5) * h.r, r: h.r });
        // fire hurts enemies too
        if (h.kind === 'fire') {
          for (const e of this.enemies) {
            if (e.dead || e.boss) continue;
            if (dist2(e.x, e.y, h.x, h.y) < h.r * h.r) { e.burn = (e.burn || 0); if (this.time - (e.lastBurn || 0) > 0.5) { e.lastBurn = this.time; this.damageEnemy(e, h.dmg * 0.8, null, true); } }
          }
        }
      }
    }
    updateTracers(dt) {
      for (const t of this.tracers) { t.life -= dt; if (t.life <= 0) t.dead = true; }
    }

    /* ---------------- items ---------------- */
    seedItems() {
      const p = this.level.path;
      for (let i = 0; i < p.length; i += 11) {
        const pt = p[i];
        const kind = this.rnd() < 0.55 ? 'ammo' : this.rnd() < 0.6 ? 'medkit' : 'pills';
        const pos = this.findWalkable((pt.x + 0.5) * this.level.tile + (this.rnd() - .5) * 90, (pt.y + 0.5) * this.level.tile + (this.rnd() - .5) * 90);
        this.spawnItem(pos.x, pos.y, kind);
      }
    }
    spawnItem(x, y, kind) {
      if (this.items.length >= MAX_ITEMS) this.items.shift();
      const pos = this.findWalkable(x, y);
      const it = { id: 'i' + (++this._iid || (this._iid = 1)), kind, x: pos.x, y: pos.y, t: this.time, taken: false, bob: this.rnd() * 6 };
      this.items.push(it);
      return it;
    }
    updateItems(dt) {
      for (const it of this.items) {
        if (it.taken) continue;
        it.bob += dt * 3;
        // weapons / armour / throwables occupy a slot, so they are taken
        // deliberately with USE instead of by walking over them
        if (D.lootInfo(it.kind).slot !== 'use') continue;
        for (const s of this.survivors) {
          if (s.dead || s.down) continue;
          if (dist2(s.x, s.y, it.x, it.y) < 30 * 30) {
            it.taken = true;
            if (it.kind === 'ammo') { const add = Math.round(this.weap(s).mag * 2.2); s.reserve = Math.min(s.maxReserve, s.reserve + add); this.pushFx('pickup', { x: s.x, y: s.y, kind: 'ammo', id: s.id, txt: '+' + add }); }
            else if (it.kind === 'medkit') { s.hp = Math.min(s.maxHp, s.hp + 68); s.healT = 0.6; this.pushFx('pickup', { x: s.x, y: s.y, kind: 'medkit', id: s.id, txt: '+68 HP' }); }
            else if (it.kind === 'pills') { s.hp = Math.min(s.maxHp, s.hp + 30); s.healT = 0.4; this.pushFx('pickup', { x: s.x, y: s.y, kind: 'pills', id: s.id, txt: '+30 HP' }); }
            else if (it.kind === 'adrenaline') { s.sta = s.maxSta; s.iframe = Math.max(s.iframe, 2.2); s.hp = Math.min(s.maxHp, s.hp + 10); this.pushFx('pickup', { x: s.x, y: s.y, kind: 'adrenaline', id: s.id, txt: 'ADRENALINE' }); }
            this.score += 25;
            break;
          }
        }
      }
    }

    /* =============== BREAKABLES & LOOT =============== */
    seedBreakables() {
      const list = this.level.breakables || [];
      this.breaks = [];
      for (let i = 0; i < list.length && this.breaks.length < MAX_BREAKS; i++) {
        const b = list[i], def = BRK[b.t];
        if (!def) continue;
        this.breaks.push({
          n: i, id: b.id, t: b.t, x: b.x, y: b.y, rot: b.rot || 0, seed: b.seed || 0,
          hp: def.hp, maxHp: def.hp, dead: false, flash: 0
        });
      }
    }
    damageBreak(b, dmg, src) {
      if (b.dead || !(dmg > 0)) return;
      b.hp -= dmg; b.flash = 0.12;
      if (b.hp <= 0) this.breakOpen(b, src);
    }
    breakOpen(b, src) {
      if (b.dead) return;
      b.dead = true; b.hp = 0;
      const def = BRK[b.t] || {};
      this.score += def.score || 5;
      this.pushFx('break', { x: b.x, y: b.y, t: b.t, c: def.color || '#a9762f', n: 9 });
      // ONE roll, server-side, from the sim RNG — every client sees the same drop
      const roll = D.rollLoot(def.table || 'crate', this.rnd);
      this.spawnItem(b.x + (this.rnd() - .5) * 14, b.y + (this.rnd() - .5) * 14, roll.kind);
      if (def.explode) this.detonate(b.x, b.y, def.explode.dmg, def.explode.r, src, 'boom', def.explode);
    }
    /** Radial damage to enemies, survivors and neighbouring breakables. */
    detonate(x, y, dmg, r, src, sfx, opt) {
      opt = opt || {};
      if ((this._detDepth || 0) > 12) return;           // chain guard
      this._detDepth = (this._detDepth || 0) + 1;
      this.pushFx('explode', { x, y, r, kind: sfx === 'boom' ? 'boom' : 'fire' });
      this.shake = Math.min(22, this.shake + r * 0.06);
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d2 = dist2(e.x, e.y, x, y);
        if (d2 > r * r) continue;
        const f = 1 - Math.sqrt(d2) / r;
        this.damageEnemy(e, dmg * (0.45 + 0.55 * f), src, true);
      }
      for (const sv of this.survivors) {
        if (sv.dead) continue;
        const d2 = dist2(sv.x, sv.y, x, y);
        if (d2 > r * r) continue;
        const f = 1 - Math.sqrt(d2) / r;
        // you catch less of your own blast, but never none: don't hug barrels
        this.damageSurvivor(sv, dmg * (0.32 + 0.42 * f) * (src === sv ? 0.4 : 1), src, 'boom');
      }
      this.damageBreaksIn(x, y, r * 0.92, dmg * 0.7, src);
      if (opt.burn) this.addHazard({ x, y, r: r * 0.6, dmg: opt.burn * 1.6, life: opt.burn, kind: 'fire', friendly: true });
      this._detDepth--;
    }
    damageBreaksIn(x, y, r, dmg, src) {
      for (const b of this.breaks) {
        if (b.dead) continue;
        if (dist2(b.x, b.y, x, y) > r * r) continue;
        this.damageBreak(b, dmg, src);
      }
    }

    /* =============== INVENTORY =============== */
    swapWeapon(s) {
      s.swapCd = 0.3;
      if (!s.alt) { this.pushFx('deny', { x: s.x, y: s.y, id: s.id }); return; }
      const a = s.alt;
      s.alt = { id: s.wpn, mag: s.mag, res: s.reserve, maxRes: s.maxReserve };
      s.wpn = a.id; s.mag = a.mag; s.reserve = a.res; s.maxReserve = a.maxRes;
      s.reloading = 0; s.burstLeft = 0; s.burstCd = 0; s.fireCd = Math.max(s.fireCd, 0.18);
      this.pushFx('swap', { x: s.x, y: s.y, id: s.id, w: s.wpn });
    }
    throwItem(s) {
      if (!s.thrKind || s.thrN <= 0) { s.throwCd = 0.25; this.pushFx('deny', { x: s.x, y: s.y, id: s.id }); return; }
      const kind = s.thrKind, t = THR[kind];
      s.throwCd = 0.55;
      if (--s.thrN <= 0) s.thrKind = null;
      this.proj.push({
        kind, thrown: true, x: s.x, y: s.y, z: 14,
        vx: Math.cos(s.aim) * 430, vy: Math.sin(s.aim) * 430, vz: 165,
        life: t.fuse, owner: s, r: 7
      });
      this.pushFx('throw', { x: s.x, y: s.y, a: s.aim, id: s.id, k: t.icon });
    }
    pickupSlotted(s, it) {
      const info = D.lootInfo(it.kind);
      s.lootCd = 0.4;
      const ammoMul = (SUR[s.hero] && SUR[s.hero].stats.ammoMul) || 1;
      if (info.slot === 'weapon') {
        const id = it.kind.slice(2), w = WEP[id];
        if (!w) return;
        if (s.wpn === id && !s.alt) {
          // already carrying this gun: take it as spare ammo instead
          const add = Math.round(w.mag * 1.5);
          if (s.reserve >= s.maxReserve) { s.lootCd = 0.25; this.pushFx('deny', { x: s.x, y: s.y, id: s.id }); return; }
          s.reserve = Math.min(s.maxReserve, s.reserve + add);
          it.taken = true;
          this.pushFx('pickup', { x: s.x, y: s.y, kind: 'ammo', id: s.id, txt: '+' + add });
          return;
        }
        if (s.alt) this.dropSlotted(s, 'w:' + s.alt.id);
        s.alt = { id, mag: w.mag, res: Math.round(w.reserve * ammoMul), maxRes: Math.round(w.reserve * ammoMul) };
        it.taken = true;
        this.score += 40;
        this.pushFx('pickup', { x: s.x, y: s.y, kind: 'weapon', id: s.id, txt: w.name.toUpperCase() });
      } else if (info.slot === 'throw') {
        const id = it.kind.slice(2), t = THR[id];
        if (!t) return;
        if (s.thrKind === id) {
          if (s.thrN >= t.max) { this.pushFx('deny', { x: s.x, y: s.y, id: s.id }); return; }  // stack full: leave it
          s.thrN++;
        } else {
          if (s.thrKind && s.thrN > 0) this.dropSlotted(s, 't:' + s.thrKind);
          s.thrKind = id; s.thrN = 1;
        }
        it.taken = true;
        this.score += 30;
        this.pushFx('pickup', { x: s.x, y: s.y, kind: 'throw', id: s.id, txt: t.name.toUpperCase() + (s.thrN > 1 ? ' x' + s.thrN : '') });
      } else if (info.slot === 'equip') {
        const max = (EQP.armor && EQP.armor.max) || 100;
        if (s.armor >= max) { this.pushFx('deny', { x: s.x, y: s.y, id: s.id }); return; }
        s.armor = max; s.armorMax = max;
        it.taken = true;
        this.score += 35;
        this.pushFx('pickup', { x: s.x, y: s.y, kind: 'armor', id: s.id, txt: 'KEVLAR ' + max });
      }
    }
    dropSlotted(s, kind) {
      const a = s.aim + Math.PI + (this.rnd() - .5) * 0.9;
      this.spawnItem(s.x + Math.cos(a) * 28, s.y + Math.sin(a) * 28, kind);
    }

    /* =============== CROSS-STAGE CARRY ===============
       Act 1 keeps everything you are holding when the next stage loads. */
    exportCarry() {
      const out = {};
      for (const s of this.survivors) {
        out[s.hero] = {
          wpn: s.wpn, mag: s.mag, res: s.reserve, maxRes: s.maxReserve,
          alt: s.alt ? { id: s.alt.id, mag: s.alt.mag, res: s.alt.res, maxRes: s.alt.maxRes } : null,
          thrKind: s.thrKind, thrN: s.thrN, armor: s.armor, armorMax: s.armorMax,
          hp: Math.max(1, Math.round(s.hp)), maxHp: s.maxHp
        };
      }
      return out;
    }
    importCarry(carry) {
      if (!carry) return;
      for (const s of this.survivors) {
        const c = carry[s.hero];
        if (!c) continue;
        if (WEP[c.wpn]) { s.wpn = c.wpn; s.mag = c.mag; s.reserve = c.res; s.maxReserve = c.maxRes; }
        if (c.alt && WEP[c.alt.id]) s.alt = { id: c.alt.id, mag: c.alt.mag, res: c.alt.res, maxRes: c.alt.maxRes };
        if (c.thrKind && THR[c.thrKind]) { s.thrKind = c.thrKind; s.thrN = Math.min(c.thrN, THR[c.thrKind].max); }
        if (c.armorMax > 0) { s.armorMax = c.armorMax; s.armor = Math.min(c.armor, c.armorMax); }
        if (c.hp > 0) s.hp = Math.min(s.maxHp, c.hp);
      }
    }

    /* ---------------- bots (GDD §2: Single Player w/ 3 AI teammates) ---------------- */
    updateBots(dt) {
      const stand = this.standingSurvivors();
      const alive = this.aliveSurvivors();
      if (!alive.length) return;
      // squad centroid for cohesion
      let cx = 0, cy = 0;
      for (const s of stand) { cx += s.x; cy += s.y; }
      if (stand.length) { cx /= stand.length; cy /= stand.length; }
      // assign ONE rescuer per downed survivor (closest standing bot)
      const rescue = new Map();
      for (const d of this.survivors) {
        if (d.dead || !d.down) continue;
        let best = null, bd = Infinity;
        for (const s of stand) {
          if (!s.isBot) continue;
          const dd = dist2(s.x, s.y, d.x, d.y);
          if (dd < bd) { bd = dd; best = s; }
        }
        if (best) rescue.set(best.id, d);
      }
      // assign generators to distinct bots
      const gens = this.objectives.filter(o => !o.done);

      for (const s of this.survivors) {
        if (!s.isBot || s.dead) continue;
        const b = s.bot;
        const inp = { mx: 0, my: 0, aimx: Math.cos(s.aim), aimy: Math.sin(s.aim), fire: false, ability: false, reload: false, interact: false, sprint: false, melee: false };
        if (s.pin > 0) { inp.interact = true; this.updateSurvivor(s, dt, inp); continue; }

        // ---- perception ----
        let target = null, td = Infinity;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const d = dist2(e.x, e.y, s.x, s.y);
          if (d < td) { td = d; target = e; }
        }
        const engage = target && td < 560 * 560 && (!target.boss || td < 760 * 760);
        const hpF = s.hp / s.maxHp;
        const rescuee = rescue.get(s.id);
        const myGen = gens.length ? gens[this.survivors.filter(x => x.isBot).indexOf(s) % gens.length] : null;

        // ---- goal priority: rescue > objective > advance > cohesion ----
        let goal = null, wantInteract = false;
        if (rescuee && (hpF > 0.25 || dist2(s.x, s.y, rescuee.x, rescuee.y) < 150 * 150)) {
          goal = rescuee; wantInteract = true;
        } else if (this.curFlow() && this.curFlow().type === 'objective' && myGen) {
          goal = myGen; wantInteract = true;
        } else if (hpF < 0.5 || s.reserve < this.weap(s).mag) {
          // detour for supplies
          let bi = null, bd2 = 420 * 420;
          for (const it of this.items) {
            if (it.taken) continue;
            const good = (hpF < 0.5 && (it.kind === 'medkit' || it.kind === 'pills' || it.kind === 'adrenaline')) ||
                         (s.reserve < this.weap(s).mag && it.kind === 'ammo');
            if (!good) continue;
            const d2 = dist2(it.x, it.y, s.x, s.y);
            if (d2 < bd2) { bd2 = d2; bi = it; }
          }
          if (bi) goal = bi;
        }
        if (!goal) {
          const f = this.curFlow();
          const humans = this.survivors.filter(o => !o.isBot && !o.dead && !o.down);
          let leader = null, ld = Infinity;
          for (const h of humans) { const d2 = dist2(h.x, h.y, s.x, s.y); if (d2 < ld) { ld = d2; leader = h; } }
          if (leader && ld > 300 * 300) {
            goal = leader;                       // stick with the human squad
          } else if (f) {
            if (f.type === 'hold' || f.type === 'extract') {
              const c = f.type === 'extract' ? this.level.extract : f;
              const wantT = f.type === 'extract' ? 1 : (f.dist === undefined ? 1 : f.dist);
              const dAnchor = Math.hypot(c.x - s.x, c.y - s.y);
              if (dAnchor > 250 || !LV.lineOfSight(this.level, s.x, s.y, c.x, c.y)) {
                goal = this.markRoute(s, wantT, 4).m;      // follow the corridor first
              } else {
                const ang = this.time * 0.45 + s.x * 0.013 + s.y * 0.007;
                const orbit = 70 + (hashish(s) % 60);
                goal = { x: c.x + Math.cos(ang) * orbit, y: c.y + Math.sin(ang) * orbit };
              }
            } else {
              // advance to the CURRENT objective anchor — never past the human's progress
              let capT = f.dist === undefined ? 1 : f.dist;
              if (leader) capT = Math.min(capT + 0.03, Math.max(this.survivorProgress(leader), this.survivorProgress(s)) + 0.05);
              capT = clamp(capT, 0, 1);
              const mark = this.markRoute(s, capT, 4).m;
              const ang2 = this.time * 0.3 + hashish(s);
              goal = { x: mark.x + Math.cos(ang2) * 34, y: mark.y + Math.sin(ang2) * 34 };
            }
          }
        }
        // cohesion: never stray far from the squad
        if (goal && stand.length > 1) {
          const dSquad = Math.hypot(s.x - cx, s.y - cy);
          const dGoal = Math.hypot(goal.x - cx, goal.y - cy);
          if (dSquad > 460 && dGoal > dSquad * 0.6 && !wantInteract) goal = { x: cx, y: cy };
        }

        // ---- steering ----
        if (goal) {
          let dx = goal.x - s.x, dy = goal.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > (wantInteract ? 44 : 60)) {
            dx /= d; dy /= d;
            // hazard avoidance (acid / fire) — strongest steering weight
            let hx = 0, hy = 0;
            for (const h of this.hazards) {
              if (h.dead) continue;
              const ox = s.x + dx * 40 - h.x, oy = s.y + dy * 40 - h.y;
              const dd = Math.hypot(ox, oy), rr = h.r + 78;
              if (dd < rr && dd > 0.1) { const w = (1 - dd / rr) * 5.5; hx += ox / dd * w; hy += oy / dd * w; }
            }
            // personal space so one acid pool cannot cook the whole squad
            for (const o of stand) {
              if (o === s) continue;
              const ox = s.x - o.x, oy = s.y - o.y, dd = Math.hypot(ox, oy);
              if (dd < 74 && dd > 0.1) { hx += ox / dd * 0.8; hy += oy / dd * 0.8; }
            }
            // avoid walking off the skyway
            if (this.level.biome === 'skyway') {
              const fx = s.x + dx * 52, fy = s.y + dy * 52;
              if (LV.isDeadly(this.level, fx, fy)) {
                hx += -dy * 2.2 * b.strafe; hy += dx * 2.2 * b.strafe;
                if (this.rnd() < dt) b.strafe *= -1;
              }
            }
            // wall feeler
            if (LV.isSolid(this.level, s.x + dx * 40, s.y + dy * 40)) {
              const p = b.strafe;
              hx += -dy * p * 1.7; hy += dx * p * 1.7;
              if (this.rnd() < dt * 0.8) b.strafe *= -1;
            }
            // kite only when it is actually safe and useful — never into a wall,
            // and never when the squad has stopped advancing (that causes corner-stalls)
            const brute = target && target.def && (target.def.behavior === 'charger' || target.def.behavior === 'suffocate');
            const scared = hpF < 0.45 || brute;
            b.noAdv = (this.survivorProgress(s) > (b.lastProg || 0) + 0.004) ? 0 : (b.noAdv || 0) + dt;
            b.lastProg = this.survivorProgress(s);
            if (engage && td < 130 * 130 && scared && (b.noAdv || 0) < 2.5) {
              const kd = Math.max(1, Math.sqrt(td));
              let kx = -(target.x - s.x) / kd * 0.55, ky = -(target.y - s.y) / kd * 0.55;
              if (!LV.isSolid(this.level, s.x + kx * 52, s.y + ky * 52) && !LV.isDeadly(this.level, s.x + kx * 52, s.y + ky * 52)) {
                dx += kx; dy += ky;
              } else {
                // no room behind: strafe instead
                dx += -dy * b.strafe * 0.6; dy += dx * b.strafe * 0.6;
              }
            }
            dx += hx; dy += hy;
            const ml = Math.hypot(dx, dy) || 1;
            inp.mx = dx / ml; inp.my = dy / ml;
            inp.sprint = d > 330 && s.sta > 35 && !engage;
          } else if (wantInteract) inp.interact = true;
        }

        // ---- stuck recovery (window-based, so jitter does not reset it) ----
        b.chkT = (b.chkT || 0) - dt;
        if (b.chkT <= 0) {
          b.chkT = 0.5;
          const cx0 = b.chkX === undefined ? s.x : b.chkX, cy0 = b.chkY === undefined ? s.y : b.chkY;
          const moved = Math.hypot(s.x - cx0, s.y - cy0);
          b.chkX = s.x; b.chkY = s.y;
          const goalDist = goal ? Math.hypot(goal.x - s.x, goal.y - s.y) : 0;
          if (moved < 26 && goalDist > 80) b.stuckT = (b.stuckT || 0) + 0.5;
          else b.stuckT = 0;
          if ((b.stuckT || 0) >= 1.0 && (b.unstick || 0) <= 0) {
            b.unstick = 0.85;
            b.unstickDir = b.unstickDir === 1 ? -1 : 1;
          }
          if ((b.stuckT || 0) > 9) {
            // hard recovery: hop to the current objective so the run can never soft-lock
            b.stuckT = 0;
            const ff2 = this.curFlow();
            const tgt = ff2 && ff2.x ? { x: ff2.x, y: ff2.y } : (leader ? { x: leader.x, y: leader.y } : this.level.spawn);
            const np = this.findWalkable(tgt.x + (this.rnd() - .5) * 180, tgt.y + (this.rnd() - .5) * 180);
            this.pushFx('catchup', { x: s.x, y: s.y });
            s.x = np.x; s.y = np.y; s.vx = 0; s.vy = 0;
            s.iframe = Math.max(s.iframe, 1.2);
            this.pushFx('catchup', { x: s.x, y: s.y });
          }
        }
        if ((b.unstick || 0) > 0) {
          b.unstick -= dt;
          const gd = goal ? Math.atan2(goal.y - s.y, goal.x - s.x) : s.aim;
          const pa = gd + (b.unstickDir || 1) * Math.PI / 2;
          inp.mx = Math.cos(pa); inp.my = Math.sin(pa); inp.sprint = false;
        }

        // ---- aim & fire ----
        if (engage && target) {
          const w = this.weap(s);
          const lead = clamp(Math.sqrt(td) / 1400, 0, 0.16);
          const px = target.x + (target.vx || 0) * lead, py = target.y + (target.vy || 0) * lead;
          const err = (this.rnd() - 0.5) * (target.boss ? 0.05 : 0.085);
          const a = Math.atan2(py - s.y, px - (s.y - 18)) + err;
          inp.aimx = Math.cos(a); inp.aimy = Math.sin(a);
          const dd = Math.hypot(px - s.x, py - s.y);
          if (dd < w.range * 0.92 && LV.lineOfSight(this.level, s.x, s.y, target.x, target.y) && s.mag > 0) {
            // don't shoot through a downed mate we are reviving
            if (!(wantInteract && rescuee)) inp.fire = true;
          }
          if (dd < 70 && s.meleeCd <= 0 && s.mag <= 0) inp.melee = true;
          // abilities
          if (s.abCd <= 0) {
            if (s.hero === 'berto' && td < 155 * 155) inp.ability = true;
            else if (s.hero === 'junjun' && (td < 130 * 130 || hpF < 0.35)) inp.ability = true;
            else if (s.hero === 'sarge' && td < 430 * 430 && td > 130 * 130 &&
              this.enemies.filter(e => !e.dead && dist2(e.x, e.y, target.x, target.y) < 170 * 170).length >= 2) inp.ability = true;
            else if (s.hero === 'rhea' && (alive.some(o => o.hp / o.maxHp < 0.55) || rescuee)) inp.ability = true;
          }
        }
        if (s.mag === 0 || (s.mag < this.weap(s).mag * 0.35 && s.reserve > 0)) inp.reload = true;
        if (s.down) {
          // crawl toward whoever is still standing
          let near = null, nd = Infinity;
          for (const o of stand) { if (o === s) continue; const d2 = dist2(o.x, o.y, s.x, s.y); if (d2 < nd) { nd = d2; near = o; } }
          if (near && nd > 60 * 60) {
            const a = Math.atan2(near.y - s.y, near.x - s.x);
            inp.mx = Math.cos(a); inp.my = Math.sin(a);
          }
        }
        this.updateSurvivor(s, dt, inp);
      }
    }

    /* ---------------- camera ---------------- */
    updateCamera(dt) {
      const alive = this.aliveSurvivors();
      if (!alive.length) return;
      let cx = 0, cy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const s of alive) { cx += s.x; cy += s.y; minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
      cx /= alive.length; cy /= alive.length;
      const spread = Math.max(maxX - minX, maxY - minY);
      const zoom = clamp(1.32 - spread / 2100, 0.62, 1.32);
      this.cam.x += (cx - this.cam.x) * Math.min(1, dt * 4.2);
      this.cam.y += (cy - this.cam.y) * Math.min(1, dt * 4.2);
      this.cam.zoom += (zoom - this.cam.zoom) * Math.min(1, dt * 2.2);
    }

    cleanup() {
      if (this.enemies.length > MAX_ENEMIES + 40) this.enemies = this.enemies.filter(e => !e.dead);
      else if (this.tick % 120 === 0) this.enemies = this.enemies.filter(e => !e.dead || this.time - e.deathT < 0.1);
      // cull enemies absurdly far away & idle
      if (this.tick % 240 === 0) {
        const alive = this.aliveSurvivors();
        this.enemies = this.enemies.filter(e => {
          if (e.dead || e.boss) return true;
          let dmin = Infinity;
          for (const s of alive) dmin = Math.min(dmin, dist2(s.x, s.y, e.x, e.y));
          return dmin < 2600 * 2600;
        });
      }
      this.tracers = this.tracers.filter(t => !t.dead);
      this.proj = this.proj.filter(p => !p.dead);
      this.hazards = this.hazards.filter(h => !h.dead);
      this.items = this.items.filter(i => !i.taken);
    }

    /** drain one-shot FX events (called by the host after each step) */
    takeFx() { const f = this.fx; this.fx = []; return f; }

    /* ---------------- snapshot ---------------- */
    snapshot() {
      const f = this.curFlow();
      return {
        v: 1, tick: this.tick, time: +this.time.toFixed(3), phase: this.phase,
        stage: this.stage.id, diff: this.diffId, ff: this.friendlyFire ? 1 : 0,
        surv: this.survivors.map(s => ({
          id: s.id, hero: s.hero, name: s.name, bot: s.isBot ? 1 : 0,
          x: Math.round(s.x), y: Math.round(s.y), a: +s.aim.toFixed(3),
          hp: Math.round(s.hp), mhp: s.maxHp, sta: Math.round(s.sta), msta: s.maxSta,
          mag: s.mag, res: s.reserve, rl: s.reloading > 0 ? +s.reloading.toFixed(2) : 0,
          ab: s.abCd > 0 ? +s.abCd.toFixed(1) : 0, abA: s.abActive > 0 ? +s.abActive.toFixed(2) : 0,
          dn: s.down ? 1 : 0, dd: s.dead ? 1 : 0, bl: Math.round(s.bleed), rv: +s.reviveP.toFixed(2),
          pn: s.pin > 0 ? +s.pin.toFixed(2) : 0, mv: +(s.moving || 0).toFixed(2), wk: +s.walk.toFixed(2),
          ht: s.hurtT > 0 ? 1 : 0, mz: s.muzzle > 0 ? 1 : 0, k: s.kills, sp: s.sprint ? 1 : 0,
          it: s.interactTarget || null, ip: +((s.interact) || 0).toFixed(2), ml: s.meleeCd > 0 ? +s.meleeCd.toFixed(2) : 0, bn: s.burning > 0 ? 1 : 0, ifr: s.iframe > 0 ? 1 : 0,
          adb: s.abData ? { x: Math.round(s.abData.x), y: Math.round(s.abData.y), r: s.abData.r } : null,
          wp: s.wpn, w2: s.alt ? s.alt.id : null, m2: s.alt ? s.alt.mag : 0, r2: s.alt ? s.alt.res : 0,
          th: s.thrKind, tn: s.thrN, ar: Math.round(s.armor), arm: s.armorMax
        })),
        en: this.enemies.filter(e => !e.dead).map(e => ({
          i: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z || 0),
          hp: Math.round(e.hp), mhp: Math.round(e.maxHp), a: +e.aim.toFixed(2), w: +e.walk.toFixed(2),
          s: e.state, f: e.flash > 0 ? 1 : 0, b: e.boss ? 1 : 0, ib: e.isBody ? 1 : 0, p: e.phase || 1,
          vn: e.vuln !== undefined && e.vuln < 1 ? 1 : 0
        })),
        tr: this.tracers.map(t => ({ x: Math.round(t.x), y: Math.round(t.y), x2: Math.round(t.x2), y2: Math.round(t.y2), l: +(t.life / t.max).toFixed(2), w: t.w })),
        pr: this.proj.map(p => ({ k: p.kind, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z || 0) })),
        hz: this.hazards.map(h => ({ k: h.kind, x: Math.round(h.x), y: Math.round(h.y), r: Math.round(h.r), l: +h.life.toFixed(1) })),
        it: this.items.map(i => ({ k: i.kind, x: Math.round(i.x), y: Math.round(i.y), b: +i.bob.toFixed(2), s: D.lootInfo(i.kind).slot === 'use' ? 0 : 1 })),
        bk: this.breaks.filter(b => b.dead || b.hp < b.maxHp).map(b => ({ n: b.n, h: b.dead ? -1 : Math.round(b.hp / b.maxHp * 100) })),
        cp: this.corpses.slice(-60).map(c => ({ t: c.type, h: c.hero, x: Math.round(c.x), y: Math.round(c.y), a: +c.a.toFixed(2) })),
        cam: { x: Math.round(this.cam.x), y: Math.round(this.cam.y), z: +this.cam.zoom.toFixed(3), sh: +this.shake.toFixed(2) },
        obj: f ? {
          type: f.type, label: f.label, p: +(f.progress || 0).toFixed(3),
          hp: f.holdProgress !== undefined ? +f.holdProgress.toFixed(3) : undefined,
          x: Math.round(f.x || 0), y: Math.round(f.y || 0), r: Math.round(f.r || 0),
          idx: this.flowIdx, total: this.flow.length,
          cnt: f.count ? this.objectives.filter(o => o.done).length : undefined
        } : null,
        dir: { i: +this.dir.intensity.toFixed(2), s: +(this.dir.stressAvg || 0).toFixed(2), w: this.dir.wave, ev: this.dir.lastEvent, peak: this.dir.peak ? 1 : 0, tur: +(this.turtle || 0).toFixed(2), stall: Math.round(this.stallT || 0) },
        sc: this.score, kl: this.kills, hs: this.headshots,
        an: this.announce ? { t: this.announce.text, s: this.announce.sub, k: +this.announceT.toFixed(1) } : null,
        fx: this.fx, gn: this.objectives.map(o => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), p: +o.progress.toFixed(2), d: o.done ? 1 : 0 })),
        boss: this.boss ? { hp: Math.round(this.boss.hp), mhp: Math.round(this.boss.maxHp), ph: this.boss.phase, nm: 'MANANANGGAL' } : (this.bossBody ? { hp: 0, mhp: 1, ph: 2, nm: 'MANANANGGAL' } : null),
        bossBody: this.bossBody ? { hp: Math.round(this.bossBody.hp), mhp: Math.round(this.bossBody.maxHp) } : null,
        ext: this.extractT > 0 ? +this.extractT.toFixed(1) : 0
      };
    }
  }

  return { Sim };
});
