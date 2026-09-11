# 3D Renderer (client/r3d.js)
Three.js (vendored UMD at client/vendor/three.min.js — offline-safe, no CDN).
SceneKit (headless-testable): scene, FogExp2, hemi+moon lights, camera SpotLight flashlight, muzzle PointLight, rain Points, lightning flashes, instanced walls/roads/water/rubble, PH street dressing (poles/jeepneys/tricycles).
Renderer3D: WebGLRenderer + 2D overlay canvas reusing the raycast renderer's HUD methods (drawHud/drawAwareness/drawMinimapFP) via prototype .call with a hud-state shim.
Snapshot flow: push() buffers -> sample() interpolates (100ms back) -> sync() maps sim (x,y)->3D (x,z), rotation.y=-a -> viewmodel animateVm -> weather -> render -> HUD overlay.
Prediction: renderer.predOwn (main.js) overrides own entity before camera — same contract as raycast path.
Fallback: no WebGL or ?r2d query -> classic raycast Renderer (debug flag per master doc §56).
Tiers: high/medium/low -> pixelRatio, shadows, rain count, fog density, dressing visibility; autoTier downgrades on sustained >26ms frames.
Pitch look (milestone 4): presentation-only vertical look (mouse movementY / right-stick vertical), clamped +/-1.15 rad, consumed by Renderer3D via pitchInput; gentle auto look-up assist when an airborne Manananggal (z>26) is within 1100u. Sim aiming stays 2D yaw.
Zone streaming lite: street dressing is bucketed into 720u chunks at build time; chunks beyond 2400u of the camera are hidden on medium/low tiers.
