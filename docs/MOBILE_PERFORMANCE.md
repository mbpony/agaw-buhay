# Mobile Performance
Day-one platform. Tiers: low/medium/high (renderer.tier), auto-downgrade only (autoTier).
Raycast path: column width 4/3/2 px (fpColW). 3D path: pixelRatio 0.7/1/min(2,dpr), shadows high-only, rain 0/1800/4200, fog density up on low, dressing hidden on low.
Touch: twin-stick (move + look, vertical axis = pitch), fire/reload/swap/pickup buttons, safe-area insets, 100dvh, landscape lock, PWA fullscreen + Add-to-Home-Screen.
Customizable HUD layout (client/hudlayout.js): Pause -> Customize HUD Layout. Drag any widget/touch button, SIZE +/- (0.5x-2x), FADE +/- (20-100%), per-widget or full reset; canvas panels (minimap/compass/health/ammo) move + fade via ghost handles in the editor and drawHud hooks (canvasPos). Offsets stored as viewport % in localStorage (abaw.hudlayout.v1), resolution/orientation independent. Presentation-only — input routing and sim untouched. Suite: test/hudlayout.js (34 asserts).
Budgets: sim <=35% one core (test), client frame >26ms sustained triggers downgrade.
