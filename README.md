# AGAW-BUHAY: SURVIVAL — Act 1 Vertical Slice

A 4-player co-op, top-down / 2.5D **survival horror shooter** built from the design document
`AGAW_BUHAY_SURVIVAL_DOCUMENTATION.pdf`. Metro Manila is a locked-down Red Zone: *Ang Lason ng
Lupa* (The Earth's Poison) has ruptured beneath Quiapo Church during typhoon season, and the
miasma turns the infected into creatures out of Filipino folklore. Four survivors fight from the
flooded avenue to the Skyway, where a **Manananggal** blocks the extraction.

Everything here is **procedural**: levels are generated from a seed, and every sprite, wall,
jeepney, balete tree, rain sheet, muzzle flash, gunshot, drone and scream is drawn or synthesised
in code. There are **zero image, font or audio files** — the repo is pure JS/HTML/CSS.

```
8,450 lines · 6 test suites (249 checks) · 0 binary assets · no build step · one dependency (ws)
Desktop **and** landscape mobile · deployable to render.com with the bundled blueprint
```

---

## Run it

```bash
cd agaw-buhay
npm install          # only needed once (installs `ws`; jsdom is dev-only, for tests)
npm start            # → http://localhost:3000
```

Then open **http://localhost:3000** in 2–4 browser tabs/windows to play co-op locally, or host on
a machine your friends can reach and send them the URL. The same URL works on a
phone — turn it sideways and it switches to twin-stick touch controls.

To put it on the public internet instead, see **[Deploy it online](#deploy-it-online-rendercom)**
below: a `render.yaml` blueprint is included, so it is two clicks on render.com.

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port (one process serves both) |

```bash
PORT=8080 npm start
```

Requirements: Node ≥ 18. No compilation, no bundler, no assets to fetch.

### Playing together

* **Quick Join** — one click. Drops you into an active public session, or makes you the host if
  there isn't one.
* **Host Lobby** — pick Act/Stage, difficulty, playstyle, friendly fire, AI backfill, public or
  private. You get a 5-character session code.
* **Find Match** — server browser with ping / stage / playstyle filters, or join by code.
* **Single Player** — fully offline. The authoritative sim runs in your browser with 3 AI
  teammates. Nothing needs to be running.

Sessions are **server-authoritative**: the host process owns the simulation, clients send input
and render interpolated snapshots. Anyone can join mid-run (late joiners spawn next to the squad
with 2.5 s of invulnerability), a player who disconnects leaves their survivor in the hands of the
AI instead of ending the run, and the host migrates automatically if the host leaves.

### Controls

| Key | Action | Key | Action |
|---|---|---|---|
| `WASD` / arrows | Move | `LMB` | Fire |
| Mouse | Aim | `Shift` | Sprint (stamina) |
| `Space` | Ability | `R` | Reload |
| `E` | Interact / pick up / revive / break pin (hold) | `F` | Melee (also smashes containers) |
| `Q` | Swap weapon (hero gun ⇄ slot 2) | `G` | Throw molotov / bomb |
| `T` | Squad chat | `Tab` | Scoreboard (hold) |
| `Esc` | Pause | `M` | Mute |

### On a phone (landscape)

Open the same URL on a mobile browser. The game detects a finger as the primary
pointer and switches to a twin-stick layout — no separate build, no app store.

```
┌───────────────────────────────────────────────────────────────────┐
│  [GFX]                                        [II]  ▫ minimap     │
│  stage · score · tension                             session      │
│                                                                   │
│                     objective + boss bar                          │
│                                                                   │
│   squad                                                     ammo  │
│                                                                   │
│            [USE][RLD][HIT][SWAP]                                  │
│   ( move ) [RUN][FIRE][ABILITY][THROW]  ( aim )                    │
└───────────────────────────────────────────────────────────────────┘
```

* **Left pad** — move. Push it all the way to the rim to sprint.
* **Right pad** — aim. Deflecting it past the deadzone **auto-fires**, so you
  never have to lift a thumb to shoot.
* **Aim assist** — with no thumb on the aim pad, your survivor tracks the
  nearest threat in front of them. Firing still needs the aim pad or `FIRE`.
* **FIRE / ABILITY / USE / RLD / HIT / RUN / SWAP / THROW** — eight-button thumb
  cluster in a 4-column grid (46 px targets). `USE` relabels itself to `TAKE`,
  `REVIVE`, `POWER` or `BREAK` depending on what you're standing next to;
  `ABILITY` shows a cooldown ring; `RUN` latches; `SWAP` and `THROW` dim when
  there's nothing to swap to or throw.
* **II** pauses, **GFX** cycles graphics quality.
* Both pads are multi-touch, so you can strafe and shoot at the same time.
* Rotating to portrait **auto-pauses** and shows a rotate prompt — you won't
  die to a horde while turning over in bed.
* Tapping anywhere requests immersive fullscreen and asks Android to lock
  landscape (iOS ignores the lock request safely; use the rotate prompt).
* Notch, home bar and rounded corners are handled with `env(safe-area-inset-*)`.
* `?touch=1` forces the touch layout on a desktop browser, `?touch=0` forces it
  off — useful for a touchscreen laptop that would otherwise be detected as a
  phone.

#### Performance

The renderer runs in three tiers and picks one for you:

| Tier | Pixel ratio cap | Rain | Fog | Grain | Light buffer | Particles | Glow pass |
|---|---|---|---|---|---|---|---|
| Low | 1.0 | 46 | 5 | off | 34% | 45% | 150 decals, off |
| Medium | 1.5 | 110 | 10 | 26 | 42% | 70% | 300 decals, on |
| High | 2.0 | 190 | 16 | 90 | 50% | 100% | 460 decals, on |

A 2 GB / 4-core phone starts on Low, a healthier one on Medium, a desktop on
High. If the frame budget is missed for ~1.5 s the tier steps down
automatically; picking one by hand (pause menu or `GFX`) turns auto-adjust off.
A phone reporting DPR 3 renders at 1.0× instead of 3× — that is 9× fewer
pixels for a picture that is indistinguishable at arm's length.

#### Staying connected on a phone

Mobile radios drop. When the socket closes mid-run the client freezes the view,
shows *Connection lost — reconnecting…*, and retries every 1.2 s. The server
hands your survivor to the AI, **freezes the whole run for 90 seconds**, and
keeps your seat. Reconnecting presents a seat token, so you get *your*
survivor back — same hero, same position, same health — with 2.5 s of spawn
protection, rather than a fifth body spawning at the start. If you died while
away you come back downed next to the squad with ~12 s on the bleed-out clock,
so a teammate can still pick you up. A full page refresh works the same way
(the token is kept in `sessionStorage`).

---

### Loot & loadout

Every stage seeds **destructible props** at positions derived from the stage
seed, so all four players in a co-op session see exactly the same loot. Smash
them with `F`, shoot them, or blow up a barrel next to them.

| Prop | HP | Leans toward |
|---|---|---|
| Cardboard box | 16 | cheap consumables |
| Explosive barrel | 20 | the rare tier — and it detonates, chaining to other barrels |
| Trash can | 24 | consumables, a bit of equipment |
| Cabinet | 28 | equipment, with its own medical drop pool |
| Wooden crate | 34 | **weapons** (2.4× weapon bias) |
| Vending machine | 46 | consumables, with its own snack/pills drop pool |

**Drop tiers** — every container is guaranteed exactly one drop:

| Tier | Base chance | Pool |
|---|---|---|
| Consumable | 55% | ammo, medkit, pills, adrenaline |
| Equipment | 25% | kevlar vest, adrenaline, medkit |
| Weapon | 15% | shotgun, SMG, rifle, burst rifle, revolver, LMG |
| Rare | 5% | molotov, pipe bomb, kevlar vest |

Each prop multiplies those odds with its own bias, so a crate is the place to
look for a gun and a barrel is the place to find a bomb.

Ammo, medkits, pills and adrenaline are **auto-picked-up** on contact. Weapons,
armour and throwables drop to the floor and wait for `E` / `USE`, so you never
lose a gun you were saving for.

**Two weapon slots.** Your hero's signature gun is permanent (Berto's pump
shotgun, Jun-Jun's SMG, and so on). Slot 2 holds one found weapon. `Q` / `SWAP`
flips between them instantly — each slot keeps its own magazine and reserve, so
swapping mid-fight never costs you a reload. Picking up a gun you already carry
converts to spare ammo instead of wasting the slot, and taking a third gun drops
whatever was in slot 2 back on the floor.

**Throwables** stack per type: up to **3 molotovs**, up to **2 pipe bombs**.
`G` / `THROW` lobs them along your aim. A molotov shatters into a fire pool
(16 impact damage, 116 radius, burning for 7 s); a pipe bomb detonates after a
2.5 s fuse for 175 damage across 176 units, and will set off barrels — and other
bombs — for a chain reaction.

**Armour.** The kevlar vest is a 100-point pool that soaks **45% of every hit**
until it's empty, then your health takes the whole thing. It's a buffer, not a
second health bar.

**Carry-over.** Clearing a stage exports your whole loadout — slot-2 weapon and
its ammo, throwables, armour — into the next one. Dying wipes it, so a defeat
sends you back out with only your hero's starting kit.

## Deploy it online (render.com)

The repo ships a **`render.yaml` blueprint**, so deployment is two clicks once
the code is in a Git host.

### Option A — Blueprint (recommended)

1. Push this folder to a GitHub or GitLab repo (the `.gitignore` already
   excludes `node_modules`).
2. On [render.com](https://dashboard.render.com) → **New → Blueprint** → pick the repo.
3. Render reads `render.yaml` and creates the web service. Click **Apply**.
4. Wait for the build (~40 s — it only installs `ws`), then open the
   `https://agaw-buhay.onrender.com` URL it gives you.

That's it. Send the URL to up to 3 friends: everyone loads the page, hits
**Quick Join**, and lands in the same session. HTTPS is automatic, and the
client upgrades its socket to `wss://` on its own.

### Option B — Manual web service

| Field | Value |
|---|---|
| Runtime | **Node** |
| Build command | `npm install --omit=dev` |
| Start command | `npm start` |
| Instance type | Free (or Starter for always-on) |
| Health check path | `/health` |
| Plan / region | Free · **Singapore** is closest to PH; Ohio or Frankfurt for US/EU squads |

Render injects `PORT`; the server already reads `process.env.PORT` and binds
`0.0.0.0`, so nothing else needs configuring. Verify with:

```bash
curl https://YOUR-SERVICE.onrender.com/health
# {"ok":true,"rooms":0,"v":"1.0.0-act1"}
```

### Add to home screen (phone)

Open the URL in mobile Safari or Chrome → Share / ⋮ → **Add to Home Screen**.
It launches full-bleed with no browser chrome, which on a phone is the
difference between a playable view and a cramped one.

### Things to know about the free tier

* **Spin-down.** A free service sleeps after ~15 minutes with no requests. The
  next visitor waits ~30–60 s for a cold start. Fine for a demo; use a paid
  Starter instance if you want it always warm.
* **One instance only.** `render.yaml` pins `numInstances: 1` on purpose: rooms
  live in process memory, so two instances would show different session lists
  and players could never find each other. Scaling out needs a room→instance
  router or Redis pub/sub — out of scope for a vertical slice.
* **Deploys end runs.** Every deploy sends `SIGTERM`; the server tells connected
  players *"Server is restarting — reconnecting…"*, closes sockets cleanly and
  exits 0. Clients reconnect automatically, but an in-flight run does not
  survive the restart (nothing is persisted).
* **512 MB RAM** is plenty: the sim uses ~1.5% of one core for a full 4-player
  room and holds no assets in memory beyond generated level grids.
* No database, no env vars, no secrets. The auth screen is a local simulation —
  no player data ever reaches the server.

### Anywhere else

Any Node host works the same way (Fly.io, Railway, a VPS): `npm install`,
`npm start`, expose one port, and make sure the proxy forwards WebSocket
upgrades on `/ws`. Behind nginx that means:

```nginx
location /ws {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;      # long-lived game sockets
}
```

---

## What's in the slice

### Survivors (all four, per the GDD)

| | Name | Role | HP | Speed | Weapon | Ability (cooldown) |
|---|---|---|---|---|---|---|
| ! | **Berto Cruz** | Tank / Enforcer | 125 | 158 | Pump Shotgun (8 pellets) | **Sweep Blast** — radial shockwave, heavy knockback (14 s) |
| + | **Rhea Mercado** | Field Medic | 100 | 168 | Burst Rifle | **Adrenaline Aura** — healing canister for the whole squad, 6 s (22 s) |
| » | **Jun-Jun Santos** | Scout / Speedster | 90 | 205 | Dual SMGs | **Evasive Roll** — dash with i-frames, escapes pins and charges (6 s) |
| ✸ | **Sarge Ramos** | Demolition / Heavy | 110 | 165 | Assault Rifle | **Molotov Barrage** — 3 lobbed molotovs, burning ground (26 s) |

Downed survivors crawl and bleed out (40 s) until a teammate holds `E` to revive. Some creatures
**pin** you (Batibat suffocation, Tiyanak grab) — mash/hold `E` to break free.

### Enemies

| Creature | Tier | HP | Behaviour |
|---|---|---|---|
| **Bangkay** | common | 44 | Shambler, swarms by weight of numbers |
| **Takas** | common | 30 | Fast runner, flanks and chases down stragglers |
| **Dumagat** | common | 90 | Ranged spitter — lobs bile. Ruptures into acid **only if you kill it up close**, so shoot from range |
| **Tiyanak** | special | 62 | Lurks invisibly, wails, ambushes |
| **Batibat** | special | 300 | Suffocates whoever it pins — heavy, slow, lethal |
| **Mangkukulam** | special | 120 | Caster: curses and bile pools, keeps its distance |
| **Pugot** | special | 230 | Headless charger — telegraphs, then commits |
| **MANANANGGAL** | **boss** | 2100 | Flies, dive-bombs, spits viscera. **Phase 1:** torso is nearly invulnerable (18% damage). **Phase 2** at 62% HP: it splits — destroy the lower half (1250 HP), then the torso becomes vulnerable |

### Act 1 — *Dilim sa Maynila* (3 stages)

| Stage | Biome | Objective chain |
|---|---|---|
| **1-1 Avenida Nightfall** | Flooded avenue, jeepneys, stalls, balete trees | Push down the avenue → Clear the subway entrance → Hold the barricade (45 s) → Reach the overpass |
| **1-2 LRT Station Zero** | Dark station, train cars, platforms | Descend into the station → Restart 2 backup generators → Defend the lit platform (60 s, horde) → Clear the tracks to the service tunnel |
| **1-3 Skyway Escape** | Elevated expressway, guard rails, void on both sides | Ascend the collapsed ramp → Repair the barricade (45 s) → **MANANANGGAL** → Survive the extraction countdown (55 s) |

Levels are regenerated from a seed each run: a self-avoiding spine walk carves the route, biomes
scatter props, a guaranteed 3-tile lane is re-carved through the clutter, then a BFS
**connectivity verifier** repairs any route it can't reach. On the Skyway a guard-rail pass runs
last so the void can never be walked into, and every spawn node is BFS-filtered for reachability.

Acts 2–4 (*Sumpa sa Bukid* / Kapre, *Kagubatan* / Tikbalang, *Ang Bulkan* / Bungisngis) appear in
the UI as **locked**, per scope.

### AI Director

A stress model drives everything: squad health, ammo, downs, recent damage taken and enemy
proximity feed a `stress` value, which the Director trades against a progress-based intensity ramp.
It decides population targets, wave sizes, scheduled hordes and "mercy" back-offs when the squad is
hurting, and it sets peak pressure during hold/extract set-pieces. It also runs **anti-turtle**
logic: stall for ~58 s and the miasma surges against survivors who are behind the progress front,
so camping is never a strategy.

| Difficulty | Enemy HP | Enemy damage | Spawn rate | Ammo | Score |
|---|---|---|---|---|---|
| Normal | ×0.95 | ×0.78 | ×0.88 | ×1.15 | ×1.0 |
| Veteran | ×1.30 | ×1.10 | ×1.10 | ×1.00 | ×1.5 |
| Nightmare | ×1.75 | ×1.45 | ×1.35 | ×0.80 | ×2.2 |

---

## Architecture

```
core/data.js    UMD design data (GDD §2–§5): survivors, weapons, enemies, stages, acts,
                difficulties, pickups, tile enum. Shared by server AND browser.
core/level.js   Deterministic seeded generator (mulberry32): spine walk, biome builds,
                props/lights, objectives, spawn nodes, BFS flow field, LOS, serialize/deserialize.
core/sim.js     The authoritative fixed-timestep simulation: hitscan weapons, 4 abilities,
                per-behaviour enemy AI, boss phases, AI Director, objective flow, hazards,
                pickups, bot teammates, camera, snapshot().
server/index.js One process: static file server + WebSocket host. Rooms, lobby, matchmaking,
                60 Hz sim / 24 Hz snapshots, late join, disconnect→bot, host transfer.
client/         index.html (all screens + HUD + CSS + touch layer), audio.js (WebAudio synth),
                render.js (procedural 2.5D renderer, 3 quality tiers), main.js (app shell,
                netcode, keyboard+mouse and twin-stick touch input, reconnect).
test/           Six suites — see below.
render.yaml     Deployment blueprint for render.com.
```

**Simulation contract.** `core/sim.js` is a pure, deterministic model with no DOM or timer
dependencies. The server owns it in co-op; the browser owns an identical copy in single player.
The client never mutates game state — it sends input and renders what it's told.

**Networking.** Clients send `input` at their frame rate; the server steps the sim at a fixed
1/60 s (max 6 catch-up steps per frame) and broadcasts a snapshot at 24 Hz. Snapshots are compact
(`surv`, `en`, `tr`acers, `pr`ojectiles, `hz` hazards, `it`ems, `cp` corpses, `cam`, `obj`, `dir`,
`gn` objectives, `boss`, `ext`) with rounded coordinates. FX events accumulate per client and ship
once, so nobody sees somebody else's muzzle flash twice. The static level is serialised once as a
run-length tile string and sent with the `level` message; the client then interpolates snapshots
with a ~95 ms buffer plus light local prediction for the player's own survivor.

**Rendering.** Chunked 8×8-tile ground and extruded-wall caches with LRU eviction, per-biome tile
variants, row-interleaved 2.5D drawing so entities sort correctly against walls, half-resolution
light-multiply canvas with additive glows, typhoon weather (rain, fog, lightning, film grain), and
a particle/decal/ring/floating-text FX system fed by the snapshot's event stream.

**Audio.** A WebAudio synth engine: per-weapon shots, impacts, deaths, the Tiyanak's cry, the
boss roar, abilities, pickups, a heartbeat that tracks your HP, horde stingers, thunder, UI clicks,
spatialised with pan/volume by position, over rain/wind/drone ambience and a tension score driven
by the Director's intensity.

---

## Tests

```bash
npm test                 # all seven suites (starts a server itself if none is running)
npm run test:balance     # headless play-throughs
npm run test:dom         # DOM contract
npm run test:net         # network protocol
npm run test:client      # headless browser (desktop)
npm run test:mobile      # headless browser (landscape phone + touch)
npm run test:loot        # breakables, loot tables, inventory, carry-over
npm run test:deploy      # render.com readiness
```

| Suite | What it does | Asserts |
|---|---|---|
| **balance** | A competent-player proxy (waypoint navigation, hazard avoidance, target priority, revives, abilities) plays all 3 stages × 3 difficulties × 2 seeds headlessly | Normal and Veteran must be winnable everywhere; Nightmare must be brutal but not impossible; no stage may soft-lock; sim cost must stay under 35% of one core (measured: **1.6%**) — **10 contract checks** |
| **dom** | Cross-references every `#id` main.js touches against index.html | No dangling element references (this caught a boot-time crash on `#fps`) — all **107** referenced ids exist among the **147** in the document |
| **net** | Two-to-five real WebSocket clients against the live server | Static serving, path-traversal block, handshake, lobby, duplicate-pick rejection, host authority over config/start, level + snapshot delivery, ~24 Hz rate, authoritative input, chat relay, late join, disconnect→bot takeover, host transfer, **seat-token reconnect reclaim**, room cleanup — **66 checks** |
| **client** | Boots the actual client in jsdom with a stubbed canvas/WebAudio/WebSocket, then plays it | No errors during boot or play; menus and auth flows; a full offline single-player run with a ticking clock, live HUD and 150k+ draw calls; WASD/aim/fire/ability/reload/melee; **smashing a container with `F` and watching the drop hit the floor and the renderer**; `E` pickups into slot 2, `Q` swaps and the HUD following the *active* gun, `G` throws, the gear-strip chips, kevlar soak maths; pause, scoreboard, mute, quality selector; then a **real networked co-op match** against the live server including lobby, launch and squad HUD — **86 checks** |
| **mobile** | Boots the same client as an 844×390 landscape phone (DPR 3, 2 GB RAM, 4 cores) and drives it with synthesised touch events | Touch detection; low tier auto-selected with grain/glow off and DPR capped; rotate gate in portrait; twin-stick deadzone, rim clamping and full-tilt sprint; **the survivor physically moves around the map on thumb power**; aim stick + auto-fire; simultaneous multi-touch; every cluster button; ability cooldown ring; aim assist locking the nearest threat; GFX cycling; pause; auto-pause on rotate; then a **second boot with PointerEvent removed** to exercise the TouchEvent fallback — **87 checks** |
| **loot** | Headless sim-level coverage of the whole loot system, with a seeded RNG so the statistical tests can't flake | Deterministic breakable seeding; destruction by melee, bullet and overkill; exactly-one-drop guarantee; tier distribution measured over many rolls; per-container character (crates favour weapons, barrels favour the rare tier); barrel detonation, chaining and mass-detonation without stack overflow; auto-pickup vs slotted pickup; the 2-slot inventory (swap, duplicate-gun-to-ammo, third-gun-drop); throwable stack caps, fuses, molotov fire pools, bomb blasts; kevlar absorb; cross-stage carry-over and defeat wiping it; snapshot fields; plus a 45-second "loot goblin" stability run — **122 checks** |
| **deploy** | Static + live checks of the render.com contract | Blueprint fields, package scripts, `PORT`/`0.0.0.0`/SIGTERM/exception guards, no-cache static serving, no hard-coded host in the client, `wss://` upgrade on HTTPS, mobile viewport metas and safe-area insets, no third-party origins; then **spawns the server on an injected port**, hits `/health`, and asserts a clean exit 0 on SIGTERM — **51 checks** |

Current state: **all seven suites green** — 66 + 86 + 87 + 122 + 51 = 412 counted checks, plus the balance and dom contracts.

---

## Tuning guide

| I want to change… | Look in |
|---|---|
| Damage, HP, cooldowns, magazine sizes | `core/data.js` → `WEAPONS`, `SURVIVORS`, `ENEMIES` |
| Objective chains, hold/extract timers | `core/data.js` → `STAGES[].flow` |
| Difficulty multipliers | `core/data.js` → `DIFFICULTIES` |
| Spawn pressure, hordes, mercy, anti-turtle | `core/sim.js` → `updateDirector()` |
| Boss phases and attacks | `core/sim.js` → `updateBoss()` / `spawnBoss()` |
| Level shape, prop density, biome rules | `core/level.js` → `generate()` |
| Snapshot rate / tick rate | `server/index.js` → `SNAP_HZ`, `TICK` |
| Bot teammate skill | `core/sim.js` → `updateBots()` |
| Colours, HUD layout, screens | `client/index.html` (CSS is inline) |

---

## Scope and known limits

This is a **vertical slice**, agreed up front: Act 1 fully playable and polished (3 stages, all 4
survivors, the Manananggal, the AI Director, menus + HUD), with Acts 2–4 present in the UI as
locked. Out of scope by design: the remaining 9 stages and 3 bosses, persistent accounts (the
auth screen simulates guest/Google/Discord locally — no data leaves the session), and any
external art or audio asset.

Server lifecycle: rooms are reaped 20 s after their last player leaves, finished runs clear after
6 minutes, idle lobbies after 20, and sockets that vanish without a close frame (crash, sleep,
dropped wifi) are terminated by a 20 s heartbeat. An empty or all-bot room never burns CPU
simulating for nobody.

Other limits worth knowing:

* One Node process hosts up to 24 rooms; there's no cross-process matchmaking or database.
* Snapshots are JSON at 24 Hz, which is fine for 4 players on a LAN or a small host but is not
  a bit-packed e-sports netcode. There's no lag compensation or rewind.
* Bots are competent teammates, not humans — they navigate, kite, avoid hazards, revive each
  other and get teleported forward if they fall hopelessly behind.
* The Skyway is deliberately the hardest stage: a narrow deck, the void on both sides, and a boss.
* Mobile input is thumb-optimised, not mouse-equivalent: aim assist and auto-fire
  do real work. Nobody has played this on a 5-inch screen in anger yet — the
  layout is verified headlessly, and pad sizes/positions are the first thing to
  tune against a real handset.
* iOS Safari cannot lock orientation or go truly fullscreen from JS, so portrait
  is handled with a rotate prompt and an auto-pause rather than a forced rotation.
* Rooms live in one process's memory: one instance only, and a deploy or a
  free-tier spin-down ends any run in progress.
