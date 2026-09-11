# Audio Design (procedural WebAudio, client/audio.js)
FP listener: AU.setListener(() => ({fp, x, y, yaw})) — every SFX pans by bearing relative to view, distance falloff 1000u.
Horror system (master doc §29): tiyanak cry deception, wing flap bearing, footsteps by surface (speedMul tile kinds), silence beats.
Surface-aware footsteps target: concrete/asphalt/metal/wood/mud/water/grass/rubble -> filter+noise variants (WIP milestone 4+).
Zone ambience profiles (§31): rain_city, underpass drip, jungle insects, ash wind — ambience beds via startAmbience/setTension.
