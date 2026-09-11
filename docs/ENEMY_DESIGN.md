# Enemy Design (four layers each: gameplay / AI / presentation / audio)
common Bangkay: shambles, arms forward; red eyes; groan + drag footsteps.
runner Takas: sprint bursts, lean silhouette; sharp footfalls.
spitter Dumagat: bloated acid sac; ranged lob; bubble idle.
tiyanak: low crawl, infant cry deception (audio lies about bearing via occlusion), scream-then-leap, PINNING state.
batibat: heavy brute; tackle; breathing audio; camera obstruction on hit.
mangkukulam: caster; visible cast pose + orb glow; curse pool area denial; targets objective-holders.
pugot: headless; charge telegraph; formation breaker; wet stump sounds.
manananggal: Act 1 boss — flying, circling, rooftop landings, torso separation phase 2, swarm summon, scream locates it; vulnerable phase counterplay.
States (master doc §21): IDLE/PATROL/INVESTIGATE/CHASE/ATTACK/RECOVER/SEARCH/RETURN + PINNING/CASTING/CHARGING/FLYING/LANDING/ENRAGED/STUNNED.
Presentation: procedural 3D builders in client/r3d.js ENEMY_BUILDERS (silhouette-first); 2D billboard fallback in render.js drawBillboard.
