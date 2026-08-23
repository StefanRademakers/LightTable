# @lighttable/vector-vello

Retained Vello/Wasm realization of validated `@lighttable/paint-scene` input.
The package synchronizes stable fragments, clips and opacity composition into a
bounded Rust scene cache and renders zero-copy into textures owned on
LightTable's shared browser `GPUDevice`.

It does not own SVG parsing, canonical vector layers, island planning,
compositor order or history. Sources and surfaces are derived resources with
explicit release, idempotent device-loss teardown and canonical rehydration.
Normal product builds use this package through per-island hybrid admission;
there is no standalone Vello product mode.
