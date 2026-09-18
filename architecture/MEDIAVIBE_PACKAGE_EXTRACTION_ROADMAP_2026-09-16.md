# MediaVibe package extraction roadmap

Status: active architecture decision, 2026-09-16.

LightTable remains a product and proving ground. MediaVibePackages owns only
contracts and runtimes that have a credible second consumer. Moving code is not
the goal by itself: a package must preserve one canonical state model, hot-path
performance, history semantics and resource ownership after extraction.

## Completed now

- `@lighttable/video-core` moved to sibling `@mediavibe/video-core`.
- LightTable consumes the package directly; Wavenux and LightAudio already use
  the same MediaVibe video package family.
- LightTable root dev, typecheck and build routes rebuild the required sibling
  `@mediavibe/media-core`, `@mediavibe/video-core`,
  `@mediavibe/effects-webgpu` and `@mediavibe/ui` packages
  before starting their host command. This prevents stale compiled contracts.

The migrated video layer is deliberately small: documents, source admission,
read-only session/presentation state, playback telemetry and frame-artifact
ports. Decode, DOM video elements and product UI remain adapter/host concerns.

- The first WebGPU effects foundation now lives in
  `@mediavibe/effects-webgpu`: adaptive alpha-Gaussian planning, sampled and
  dense alpha shaders, and lazy pipelines cached by `GPUDevice`, fullscreen
  module and target format. LightTable consumes these pipelines inside its
  existing command encoder and retains texture/cache/submission ownership, so
  the move adds no canvas, readback, texture copy or queue submission.
- This is an extraction foundation, not completion of the effects family.
  LightTable's Layer Style catalog, document mapping, field textures and final
  style composition remain local. Wavenux becomes the second runtime consumer
  when its WebGPU compositor lands; merely adding an unused dependency does
  not satisfy that gate.

## Extraction order

### P1 — move as coherent clusters when the second consumer lands

1. **Vector foundation:** `paint-core` -> `vector-core` ->
   `vector-rendering`, followed by `vector-webgpu` and `vector-vello` as backend
   packages. These boundaries are already host-neutral, but physical movement
   waits for a real title/vector-overlay consumer outside LightTable.
2. **Text foundation:** `text-core` -> `text-rendering` -> `text-webgpu`, with
   `text-layout-wasm` moved in the same coordinated pass. This is a strong fit
   for NLE titles and podcast graphics; Wasm asset resolution must remain one
   tested runtime contract rather than host-specific copy steps.
3. **Scene/interchange:** `paint-scene` and its adapters can move with the first
   non-LightTable scene consumer. `pdf-core` follows only when another product
   needs editable layout or export; it is not required merely to render video.
4. **GenAI contracts:** `genai-core` is provider-neutral and may move when a
   MediaVibe product consumes its job/provenance model. Provider adapters move
   separately so the core does not acquire vendor policy.

### P2 — separate policy before extraction

- **Filters:** generic filter descriptors and GPU kernels are valuable for NLE
  effects, but `filter-core` and `filter-webgpu` currently include parts of the
  LightTable/Photoshop catalog and control policy. Extract the shared kernel
  vocabulary first; leave product catalogs and inspector presentation local.
- **WebGPU runtime:** `webgpu-runtime` is generic but too small to justify an
  isolated migration. Move it with the first vector/text/filter backend cluster
  and prove one-device/resource-lifetime ownership in both hosts.
- **Transactions/history:** do not move the whole `editor-kernel`. First prove
  that LightTable and Wavenux share the same transaction, undo grouping and
  resource-lifetime semantics. Then extract that narrow kernel while each
  product keeps its own command catalog and domain operations.

## Keep in LightTable

- `command-contract`: its current command IDs, schemas and exposure profiles
  describe LightTable's product surface.
- `lighttable-app`: host composition, docks, tools, inspectors, raster engine,
  PSD policy and application workflows.
- Photoshop-specific interpretation, product defaults and compatibility policy.

These can depend on MediaVibe contracts; they must not be copied into a generic
package or used to create a second canonical state model.

## Gate for every later move

An extraction pass is complete only when:

1. a named second consumer exists and uses the package directly;
2. core code has no React, DOM, Electron, codec or product-command dependency;
3. package tests cover serialization/state invariants and the consumer tests
   cover adapter wiring;
4. LightTable boundary, typecheck and relevant product tests pass;
5. MediaVibePackages typecheck, tests and build pass;
6. old package/import paths are removed in the same pass, with no compatibility
   fork or duplicated mutable state left behind.

Until these gates are met, keep the code where its only real owner lives.
