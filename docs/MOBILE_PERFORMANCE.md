# Mobile Performance
Day-one platform. Tiers: low/medium/high (renderer.tier), auto-downgrade only (autoTier).
Raycast path: column width 4/3/2 px (fpColW). 3D path: pixelRatio 0.7/1/min(2,dpr), shadows high-only, rain 0/1800/4200, fog density up on low, dressing hidden on low.
Touch: twin-stick (move + look), fire/reload/swap/pickup buttons, safe-area insets, 100dvh, landscape lock, PWA fullscreen + Add-to-Home-Screen.
Budgets: sim <=35% one core (test), client frame >26ms sustained triggers downgrade.
