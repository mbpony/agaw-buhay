# First-Person (2.5D) — Phase Status

**Decision (user-confirmed):** FP fully REPLACES top-down (top-down code deleted at the
end of the project, not before). FP must work on mobile from day one. Lag is a
first-class concern ("please do take note the lag too").

## Phase 1 — playable FP renderer  ✅ BUILT, visually verified, ⚠️ UNCOMMITTED
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

## Phase 2 — netcode for FP (NEXT)
- Client-side prediction + reconciliation for position AND yaw (server stays
  authoritative at 24 Hz snapshots; current code only nudges position, no yaw predict).
- Local yaw applied instantly (never wait for server) → turning feels lag-free.
- View-rate audit: keep FP draw under budget on the low tier.

## Phase 3 — awareness + polish, then DELETE top-down
- Off-screen enemy indicators / directional damage cues (FP hides what top-down showed).
- Audio panning per enemy bearing.
- Mobile perf validation on-device, then remove the top-down draw path entirely.
