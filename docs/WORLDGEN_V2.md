# Worldgen V2 (zone grammar)
Hierarchy: Campaign > Act > Stage > Zone > Encounter > segments > props/loot/spawn nodes.
Current state: core/level.js generates spine path + biome geometry + nodes + breakables (deterministic per seed).
Target (master doc §14/§52): each stage = ordered zone list with purpose/encounter budget/loot budget/lighting/audio profile.
Rules: procedural variation INSIDE authored templates; connectivity + spawn-safety + escape-route validation mandatory (test many seeds).
Spawn nodes SHIP with semantic tags (core/level.js tagNode): flooded / street / interior / rubble / flood_edge / dark (distance from nearest light >430u). Tags are plain data, survive serialize -> deserialize, and are covered by test/r3d.js across all 3 Act 1 stages (217 nodes).
Remaining §27 work: allowedEnemies + weight + cooldown fields consumed by the director's enemy placement (data groundwork done; sim wiring pending to protect balance).
Director never spawns inside a player's view cone (core/sim.js pickNode, tested in test/aware.js).
