# Audio Design (procedural WebAudio, client/audio.js)
FP listener: AU.setListener(() => ({fp, x, y, yaw})) — every SFX pans by bearing relative to view, distance falloff 1000u.
Horror system (master doc §29): tiyanak cry deception, wing flap bearing, footsteps by surface (speedMul tile kinds), silence beats.
Surface-aware footsteps SHIPPED: own-player stride accumulator in main.js samples LV.tileAt -> water/asphalt/metal/rubble/concrete variants of AU.SFX.step (backward compatible with the legacy water boolean).
Zone ambience profiles (§31): rain_city, underpass drip, jungle insects, ash wind — ambience beds via startAmbience/setTension.
