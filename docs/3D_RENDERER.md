# 3D Renderer (client/r3d.js)
Three.js (vendored UMD at client/vendor/three.min.js — offline-safe, no CDN).
SceneKit (headless-testable): scene, FogExp2, hemi+moon lights, camera SpotLight flashlight, muzzle PointLight, rain Points, lightning flashes, instanced walls/roads/water/rubble, PH street dressing (poles/jeepneys/tricycles).
Renderer3D: WebGLRenderer + 2D overlay canvas reusing the raycast renderer's HUD methods (drawHud/drawAwareness/drawMinimapFP) via prototype .call with a hud-state shim.
Snapshot flow: push() buffers -> sample() interpolates (100ms back) -> sync() maps sim (x,y)->3D (x,z), rotation.y=-a -> viewmodel animateVm -> weather -> render -> HUD overlay.
Prediction: renderer.predOwn (main.js) overrides own entity before camera — same contract as raycast path.
Fallback: no WebGL or ?r2d query -> classic raycast Renderer (debug flag per master doc §56).
Tiers: high/medium/low -> pixelRatio, shadows, rain count, fog density, dressing visibility; autoTier downgrades on sustained >26ms frames.
