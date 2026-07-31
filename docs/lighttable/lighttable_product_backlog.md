# LightTable product backlog

Explicit later work that must not disappear while the implementation roadmap is
being executed. Items here are capabilities, not the current implementation
order.

Status: retained capability inventory, reviewed 31 July 2026. An unchecked item
is not proof that the feature is absent: verify current code and the owning
tracker before starting it. Current execution order lives in
`lighttable_product_roadmap.md`; current architecture work lives in
`LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md`.

## Production hardening audit — July 2026

These items came from the broad LightTable audit of the GPU pipeline, layers,
masks, transforms, selections, Auto Align, image I/O, persistence, undo and
host integrations. The first four are data-integrity blockers and should be
handled before a broad production rollout.

### P0 — data integrity and unsaved work

- [ ] Clear or replace the original host `effectiveSourceFileKey` after
  `File -> Open image`; never write an unrelated mediaboard or shot source into
  the new LightTable recipe.
- [ ] Base flat-versus-layered save on document contents, not only layer count.
  A single layer with pixel edits, a mask or a non-identity transform must
  remain reconstructable after reopen.
- [ ] Store target and reference source/geometry revision snapshots in every
  Auto Align result. Refuse preview and apply when either input changed after
  analysis.
- [ ] Add a saved document fingerprint/revision and one consistent
  discard-confirmation flow for close, Escape, backdrop close and replacing the
  document through Open.

### P1 — precision and color correctness

- [ ] Until precision-preserving export is implemented, explicitly warn in
  Save and Download when a 16-bit source will be written as 8-bit. Silent
  precision loss is not acceptable.
- [ ] Make the native fast import path ICC-aware. Either use browser color
  conversion or detect embedded non-sRGB profiles and route those files through
  the wasm-vips path.

### P1 — runtime stability

- [ ] Catch rejected histogram readbacks and every
  `queue.onSubmittedWorkDone()` cleanup path, including device-loss rejection;
  always release associated GPU resources.
- [ ] Make image replacement transactional: allocate and validate the new image
  runtime before destroying the currently working document.
- [ ] Validate imports against `device.limits.maxTextureDimension2D` and a
  realistic pixel/VRAM budget before allocating GPU resources.
- [ ] Add a device-loss recovery route: block further editing, retain or recover
  document state, recreate the engine/device and restore the document.

### P1 — GPU memory and frame scalability

- [ ] Profile and fix the reported macOS responsiveness gap for tool switching,
  painting and pointer-driven UI. Attribute time separately to React commits,
  layout/ResizeObserver work, input routing, GPU submission/compositing, scopes
  and Electron/browser hosting before optimizing. Enforce the measurable gate
  in `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md` on both web and Electron.
- [ ] Decouple immediate tool/cursor and paint-stroke feedback from expensive
  full-document recomposition; coalesce superseded preview renders and lower
  the update rate of scopes, thumbnails and heavy effects while interacting.
- [ ] Lazily allocate full-resolution effect targets on enable/first encode and
  release reusable targets when an effect is disabled.
- [ ] Store layer masks in a single-channel format (`r8unorm` or `r16float`
  according to the required precision), not full-resolution `rgba16float`.
- [ ] Replace per-visible-layer, per-dirty-frame uniform-buffer allocation with
  a persistent ring buffer or dynamic-offset allocator.

### P2 — architecture, performance and host integration

- [ ] Label the current document-wide grade clearly as **Global adjustments**
  until per-layer adjustment stacks exist.
- [ ] Move Auto Align feature extraction/matching/RANSAC off the UI thread into
  a Worker and add revision-keyed analysis caching.
- [ ] Expose a lazy host-facing LightTable entry point so Boards, GenAI and the
  filmstrip hosts do not statically pull the complete editor into their main
  chunks.
- [ ] Gradually split `LightTableEditorOverlay.tsx` into document/save,
  GPU/image-load lifecycle, history/transactions, tools and
  adjustment/sidebar controllers. Follow
  `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md`: move ownership into the
  application, document-session, command, tool and renderer systems instead of
  only splitting the React file.

## Image I/O and persistence

- [ ] Precision-preserving 16-bit save/export.
- [ ] PSD/PSB parity through the canonical LightTable document model; use
  `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md` for model, renderer, editing UI,
  creation, export and verification status. Layered PSD loading alone is not
  considered feature support.
- [ ] Float/HDR ingest and output after the u8/u16 production path is stable.
- [ ] Broader codec coverage such as AVIF, HEIF/JXL and relevant camera formats.

## Painting

- [ ] Port more brush behavior and brush presets from the Darkly research.
- [ ] Brush preset browser and persistent custom presets.
- [ ] Additional brush dynamics such as pressure mappings, scatter and texture.

## Workspace and integration

- [x] Generic dockable panel host for LightTable.
- [ ] Mount reusable Media Browser and GenAI panels beside the editor.
- [x] Persist workspace layout separately from image documents.
- [ ] Add a document-session controller for multiple simultaneously open
  documents without sharing GPU, undo or dirty state. The workspace has exactly
  one active document, while every open document retains its own viewport,
  selection, active tool, history, task scope and renderer context.
- [ ] Make GPU scope surfaces rebindable, then enable same-origin browser
  popouts and multi-monitor scope workflows.

## Editing

- [ ] Perspective and warp extensions for the Transform tool.
- [ ] Numerical transform controls and editable transform center.
- [ ] Linked multi-layer transforms.
- [ ] Groups, clipping and adjustment layers as described by the main roadmap.
