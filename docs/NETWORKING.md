# Networking
Server-authoritative Sim at 60Hz ticks; snapshots 24Hz per room (server/index.js SNAP_HZ).
Client->server: input messages with seq (30Hz) — mx/my/aim/fire/sprint/reload/melee/ability/throw/swap.
Server->client: snap (survivors/enemies/items/tracers/objectives), fxp event lists, lobby/room/end messages.
Per-player snapshot fields: you, fxp, isq (last simulated input seq — reconcile fuel).
Client: prediction (client/predict.js mirror of sim movement) + reconciliation replay of un-acked inputs; exp(-12t) correction offset; >56px snaps.
Interpolation: 100ms back-buffer lerp (both renderers). Late join, reconnect seat tokens, AI takeover on disconnect — all preserved.
Never network: particles, rain, animation frames, bullet visuals (master doc §37).
