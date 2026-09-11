# Asset Pipeline
HARD CONSTRAINT (user): zero external art/audio files — everything procedural (canvas 2D + Three.js primitives + WebAudio synthesis).
Registry pattern (master doc §42) implemented as code registries: ENEMY_BUILDERS / WEAPON_BUILDERS (client/r3d.js), billboard vectors (render.js), SFX (audio.js).
If binary assets ever enter (GLB/glTF), they go under assets/ with the registry mapping id -> path + animations; simulation never depends on them.
Icons/PWA: tools/gen-icons.js procedural PNG encoder.
