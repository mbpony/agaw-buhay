# Worldgen V2 (zone grammar)
Hierarchy: Campaign > Act > Stage > Zone > Encounter > segments > props/loot/spawn nodes.
Current state: core/level.js generates spine path + biome geometry + nodes + breakables (deterministic per seed).
Target (master doc §14/§52): each stage = ordered zone list with purpose/encounter budget/loot budget/lighting/audio profile.
Rules: procedural variation INSIDE authored templates; connectivity + spawn-safety + escape-route validation mandatory (test many seeds).
Spawn nodes carry tags (behind_player, dark, rooftop, interior, flooded) + allowedEnemies + weight + cooldown (master doc §27).
Director never spawns inside a player's view cone (core/sim.js pickNode, tested in test/aware.js).
