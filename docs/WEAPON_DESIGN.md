# Weapon Design
Gameplay data lives in core/data.js WEAPONS (dmg/pellets/spread/range/rof/mag/reserve/reload) — deterministic, server-authoritative.
Presentation definition (master doc §19) maps id -> 3D viewmodel builder + muzzle anchor + anims:
client/r3d.js WEAPON_BUILDERS (procedural boxes/cyls: receiver, barrel, mag, optic, stock) with recoil kick, sway, bob, reload dip, muzzle PointLight.
Classes: shotgun (pump+tube), burst (carry handle), smg (compact), rifle (AR: optic+curved mag), revolver, lmg (box mag).
Audio: procedural SFX per class in client/audio.js (shot/reload/dry).
