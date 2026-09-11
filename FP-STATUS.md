## Customizable HUD layout [shipped 2026-09-12]
- `client/hudlayout.js` (ABAW_HUDL): drag/scale/fade editor for 16 DOM widgets (status chips, objective, prompt, announcements, feed, fps, both touch pads, all 8 touch buttons) + 4 canvas panels (minimap, compass, health, ammo) via ghost handles; render.js drawHud gained `withPanel(key)` hooks consuming `canvasPos(W,H)`.
- Entry point: Pause (settings) -> "Customize HUD Layout". Toolbar: SIZE/FADE/RESET/RESET ALL/DONE; Esc = save. Per-device persistence in localStorage; offsets stored as viewport %.
- Game input suppressed while editing (loop renders preview only); bindPad/bindBtn ignore pointers in edit mode.
- test/hudlayout.js: 34 asserts (registry, apply, persistence round-trip, canvas px conversion, drawHud hook integration w/ recording ctx, edit lifecycle). ALL 11 SUITES PASSED.

## Phase 4 — TRUE 3D (Three.js) [shipped 2026-09-12, master-doc milestones 1-3 + parts of 4-5]
- `client/r3d.js`: SceneKit (testable scene graph) + Renderer3D (WebGL over the 2D HUD overlay) + buildWorld (instanced walls/roads/water/rubble + PH dressing: poles, jeepneys, tricycles) + ENEMY_BUILDERS (8 procedural folklore silhouettes incl. flapping Manananggal wings) + WEAPON_BUILDERS (6 3D viewmodels with muzzle anchors) + rain/fog/lightning + perf tiers.
- Three.js vendored at `client/vendor/three.min.js` (offline-safe UMD; no CDN).
- `client/main.js`: auto-selects 3D when WebGL exists; `?r2d` query (or no WebGL) falls back to the raycast renderer (master doc §56 debug flag).
- Sim/net/prediction/HUD code paths unchanged; renderer borrows the existing CODM HUD via prototype call.
- Director spawn stealth (§27-28): pickNode softly prefers nodes outside every alive player's view cone — tested 60/60 picks in test/aware.js.
- docs/: 14-file design/engineering set per master doc §62.
- New suite `test/r3d.js` (29 asserts, headless scene-graph: registries, world-vs-grid counts, snapshot->3D mapping, viewmodel swap, tier scaling). All suites green (net 69, client 100, mobile 101, loot 122, deploy 83, r3d 29, aware 21).
- Milestones 4-5 (shipped same day): pitch look (mouse Y / right-stick vertical, presentation-only, clamped) + airborne-Manananggal look-up assist; surface-aware footsteps (water/asphalt/metal/rubble/concrete via LV.tileAt + stride accumulator); zone streaming lite (dressing chunked at 720u, distance-culled at 2400u on med/low); worldgen spawn-node tags (flooded/street/interior/rubble/flood_edge/dark, serialize-safe, tested over 217 nodes). r3d suite now 42 asserts; ALL SUITES PASSED.
- NEXT: director consumes node tags for folklore-correct enemy placement (allowedEnemies/weight/cooldown); full Act 1 zone-grammar conversion in level.js; boss arena verticality pass.

# First-Person (2.5D) — Phase Status

**Decision (user-confirmed):** FP fully REPLACES top-down (top-down code deleted at the
end of the project, not before). FP must work on mobile from day one. Lag is a
first-class concern ("please do take note the lag too").

## Phase 1 — playable FP renderer  ✅ DONE (commit 5c1d6fe)
Sandbox storage fault (I/O errors on /usr/bin/git, ps, free; SIGBUS in node) blocked
`git commit` and the jsdom test suites on 2026-09-11. Backups in `backup/fp-phase1/`.
Commit + push as soon as the environment recovers, then re-run `node test/all.js`
(net 67 / loot 122 / deploy 80 were green with FP active; client.js + mobile.js crash
with SIGBUS even on PRE-FP code → environmental, not the game).

What shipped in Phase 1:
- `client/render.js` → `Renderer.drawFirstPerson()` (default view, `this.fp = true`):
  per-column DDA raycast over the existing 2D tile map, 60° FOV, distance fog
  (16 tiles), side/stripe shading, floor+ceiling gradients, head bob, vignette.
  Billboards (enemies/allies/items/breakables) sorted far→near, occluded by a
  per-column z-buffer, floor-anchored with eye height = 1.2 tiles (same as walls).
  Gun viewmodel + muzzle flash; tracers as short screen streaks.
  Cost scales with perf tier via `fpColW()` (4px low / 3 med / 2 high) → mobile day one.
- `client/main.js` → FP input: turn = mouse-x offset (desktop) or right stick (touch),
  movement rotated by yaw, shoot-where-you-look, muzzle-flash edge, `app.frameDt`.
- Minimap still drawn (main.js calls `drawMinimap` separately) for situational awareness.
- `tools/fp-preview.js [stageId] [yawDeg] [out.png]` — runs the REAL drawFirstPerson
  headlessly through a software ctx and writes a PNG. Use it to eyeball any angle.

Verified frames: fp-preview.png (yaw 0), fp-90.png (wall face, correct perspective),
fp-180.png (flat wall, floor+ceiling). Walls read as full-height, sprites stand on the
floor, gun sits bottom-centre.

## Phase 2 — netcode for FP  ✅ DONE (commit 889c834)
- client/predict.js mirrors Sim survivor movement exactly (0.00px divergence over
  120 ticks): normalised input * hero speed * sprint mult, 0.72 idle decay,
  terrain speedMul, axis-separated collision with the -0.08 bounce.
- Inputs carry `seq`; the server echoes the last simulated seq per player as
  `sv.isq`; the client replays un-acked samples on top of the authoritative
  snapshot position (replay() reconstructs the sim trajectory exactly) and folds
  residual error into an exp(-12t) decaying offset; >56px snaps (knockback).
- Own survivor renders at the predicted position → FP raycast origin + camera
  react on the input frame; 24 Hz snapshots correct, never drive, the view.
- test/predict.js (10 checks) + isq echo assertions in test/net.js.
- Suite after phase 2: 490 checks green (net 69, client 98, mobile 100,
  loot 122, deploy 81, balance 10, predict 10).

## Phase 3 — awareness + mobile perf + top-down DELETED  ✅ DONE
- Directional damage ring (hurt fx carries attacker pos), off-view threat
  chevrons + proximity pulse (Renderer.threatMarker, unit-tested), FP audio
  panning by bearing via AU.setListener (test/aware.js, 16 checks).
- Mobile perf: FP column width tier-scaled and asserted (4/3/2 px per column).
- TOP-DOWN RENDERER DELETED: 23 draw methods, chunk/atlas cache, particle &
  decal systems, weather, floating text, lighting pass — render.js went from
  2278 to 1170 lines. consumeFx is now audio-only (+damage direction). FPS
  stats + hurt vignette moved ahead of the FP draw (they were dead in FP).
- Suite after phase 3: net 69, client 98, mobile 101, loot 122, deploy 81,
  balance 10, predict 10, aware 16, dom + sim-cost = ALL GREEN.
- Off-screen enemy indicators / directional damage cues (FP hides what top-down showed).
- Audio panning per enemy bearing.
- Mobile perf validation on-device, then remove the top-down draw path entirely.
