# AI Director
Lives in core/sim.js (dir state): stress/intensity from player hp, ammo, downs, recent damage, proximity.
Pacing curve (master doc §23): CALM->BUILD->PRESSURE->PEAK->RELIEF ... CRESCENDO->PEAK->SAFE.
Encounter templates (§24): ambush, horde, special pressure, rescue, holdout, traversal, crescendo, boss arena — mapped onto stage flow objectives.
Spawn stealth (§28): pickNode rejects nodes inside any alive player's 50-deg view cone within 460px with LOS (tested).
Budgets: horde size, special count, loot trickle scale with difficulty + director stress.
