# LightTable application package

Status: current package boundary, updated 31 July 2026.

This directory contains the host-neutral LightTable application used by both
the web and Electron hosts. StoryBuilder is an adapter/consumer; it is not the
owner of editor state, assets, UI, GPU resources or persistence behavior.

LightTable supports multiple open document sessions with exactly one active
document. Canonical document data is serializable and document-scoped. React,
GPU resources, workspace layout and host storage handles are projections or
services, never the document source of truth.

## Current boundaries

- `application/` owns use cases, commands, input routing and tool controllers.
- `domain/` owns canonical document/session concepts without React or WebGPU.
- `editor/` owns presentation, workspace panels and feature views.
- `gpu/`, `effects/` and `processing/` own rendering contracts, registered
  processing nodes and GPU execution.
- `host/` exposes the web/Electron/StoryBuilder ports without importing host
  application state into the editor.
- `assets/` owns LightTable icons and other package-local resources.

The editor includes layered documents, masks, transforms, selections, Grade
and Lens Fx ownership, registered ordered processing nodes, PSD reconstruction,
professional raster ingest, scopes and an alpha Warp implementation. Feature
presence in a UI is not sufficient proof of production readiness; use tests and
the owning implementation tracker.

## Architecture and current work

Read these repository documents before changing cross-cutting behavior:

1. `architecture/README.md`
2. `architecture/SYSTEM_MAP.md`
3. `architecture/DOCUMENT_AND_SCENE_MODEL.md`
4. `architecture/RENDERING_AND_PROCESSING.md`
5. `architecture/PERFORMANCE_CONTRACT.md`
6. `architecture/CURRENT_STATE_AND_ROADMAP.md`

Feature specifications live under `architecture/features/`; detailed UX specs
live under `architecture/ux/`. Research and implementation records under
`architecture/reference/` are supporting context, not current contracts.
Retired handoffs under `architecture/obsolete/` must not drive new code.

The immediate direction is to finish the production decomposition while
keeping working rendering math intact, complete the ordered processing
executor model, and evolve Warp through the extracted document, command,
processing and renderer boundaries.

## Non-negotiable validation

- Keep web and Electron targets green.
- Preserve exact disabled-node bypass and current operation-order tests.
- Keep ordinary 8-bit images on the fast path; initialize precision codecs only
  for inputs that require them.
- Keep inactive documents free of active rendering work without discarding
  canonical state.
- Do not add native-format legacy branches during alpha development.

The top-level scripts and the active modularization plan define the current
typecheck, unit-test and build commands.
