# Testing
node test/all.js runs: sim cost, balance matrix, prediction mirror, FP awareness (+spawn stealth), 3D presentation, dom contract, network protocol, headless desktop client, mobile touch, loot/breakables/inventory, deploy readiness.
Rules: suites spawn a FRESH server from the working tree; never trust a stale one.
3D tests are headless scene-graph (no WebGL): registry completeness, world-vs-grid instance counts, snapshot->3D mapping, viewmodel swap, tier scaling.
Generators tested across seeds; prediction tested against the authoritative sim tick-for-tick (0.00px).
A procedural generator is never trusted because one seed worked (master doc §54).
