# World Design
Acts: 1 Dilim sa Maynila (urban flood), 2 Sumpa sa Bukid (rural Bulacan), 3 Kagubatan (Sierra Madre rainforest), 4 Ang Bulkan (Mayon ashlands).
Environment kits (procedural, no external assets): Urban / Rural / Jungle / Volcanic — see client/r3d.js buildWorld dressing + core/level.js biome props.
Landmarks per zone: sari-sari store, barangay hall, chapel, basketball court, jeepney/tricycle lines, utility poles + tangled cables, drainage, underpass, skyway ramps.
Water: flooded tiles (TILE.WATER) render as 3D instanced water with bob; gameplay: speedMul + sound muffling (core/level.js speedMul).
