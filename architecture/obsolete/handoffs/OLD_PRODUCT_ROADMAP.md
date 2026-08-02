# LightTable product roadmap

Updated: 2026-07-31

This is the current product-level order of work. Detailed checkmarks belong to
their owning plans; this file intentionally stays short.

## 1. Finish the production decomposition

Continue `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md` until the application
root, renderer facade and feature views are composition surfaces rather than
state owners. Preserve the working WebGPU math while extracting coherent,
document-scoped services with tested lifecycles.

Current foundations already include multi-document sessions, one active
document, host-neutral web/Electron opening, document-scoped history/tasks,
registered panels, explicit GPU resource owners and renderer error containment.

## 2. Complete Warp on those boundaries

The current `lt.warp` proof provides a persistent, non-destructive Push node,
document-scoped gestures, one undo entry per stroke, lazy GPU allocation and
layered-document roundtrip. Continue from
`../LIGHTTABLE_GPU_WARP_TOOL_SPEC.md` with:

- the remaining brush modes;
- selection, freeze and linked-mask influence;
- production undo/checkpoint and device-loss behavior;
- settle/export quality and visual golden tests;
- later structured grid/cage editing.

Do not grow Warp through editor-root callbacks or a private render path.

## 3. Complete the ordered processing runtime

Lens Fx and Warp already execute as registered serialized nodes. The remaining
combined grade shader is an intentional compatibility bridge. Replace it only
after registered grade executors preserve neutral bypass, operation order,
color domains, alpha behavior, curve LUT behavior and PSD mappings in tests.

The user-facing model remains simple: local Grade/Lens Fx, Adjustment Layers
and attached stacks. The engine may be node-based without exposing a node graph.

## 4. Harden document editing and workspace behavior

- finish typed command and gesture transaction migration;
- define inactive-document GPU eviction without losing document state;
- keep workspace state separate from image-document state;
- keep panels movable while document tools and rendering remain document-local;
- preserve responsive UI during expensive preview and final rendering.

## 5. Advance PSD/PSB parity through the canonical model

PSD compatibility validates the same layer tree, masks, clipping, groups,
adjustments, styles, smart content and processing stacks used by native
LightTable documents. Follow `PSD_PARITY_TESTABLE_IMPORT_PATH.md` and maintain
progress only in `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md`. Never substitute
the embedded Photoshop composite for editable reconstruction.

## 6. Finish professional image I/O and precision

Keep ordinary PNG/JPEG/WebP on the native fast path. Route precision and
professional formats through capability-selected codecs without initializing
WASM for files that do not need it. Complete precision-preserving layered save,
color-management verification, performance budgets and broader desktop formats.

## 7. Add AI-first and advanced creative systems

Media Browser, GenAI, 3D placement, perspective tools and future AI operations
must consume the same host ports, document commands, processing nodes and
resource policies. They are extensions of the editor architecture, not new
global systems.

## Release discipline

LightTable remains alpha. Prefer one clean current model over legacy native
document compatibility. Web and Electron must stay green at every milestone;
StoryBuilder integrates only through the host/package boundary.
