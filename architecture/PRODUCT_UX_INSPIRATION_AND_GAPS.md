# Product UX inspiration and capability gaps

Status: product-direction inventory, 4 August 2026.

This document inventories product and interaction opportunities for LightTable.
It does not claim implementation and it is not a request to copy another
application's visual language. The goal is to borrow proven interaction
principles while keeping LightTable's existing compact UI, GPU-first renderer,
shared web/desktop architecture and non-destructive document model.

Photoshop interchange fidelity is tracked separately in
`PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md`. Detailed implementation work must
remain in small tasks with an explicit canonical model, UI exposure, tests and
its own commit.

## Product position to protect

LightTable already has a useful identity. New features must reinforce it:

- one GPU-native canvas rather than DOM, SVG or CSS rendering substitutes;
- fast, direct photo work through the established Grade and Lens Fx panels;
- semantic, non-destructive layers with explicit cached previews where needed;
- the same document and rendering contracts on desktop and web;
- contextual tool options built from the existing controls and design tokens;
- compact multi-document and docked-panel workflows;
- inspectable performance, recovery and unsupported-feature reporting;
- a future command surface that can serve UI, automation and MCP without
  duplicating editor behavior.

## Interaction principles worth adopting

### Photoshop

Use the mature separation between the tool rail, contextual options, document
canvas and persistent panels. The Layers panel demonstrates compact direct
manipulation of visibility, selection, nesting, masks and effects. Its newer
Contextual Task Bar is useful as a principle: expose the small set of likely
next actions near the active content, but never hide the durable property
location or invent a second control system.

LightTable application:

- keep the property bar authoritative for the selected tool;
- make layer rows dense, predictable and type-aware;
- expose masks/effects only when present, with clear active-target borders;
- offer contextual recovery actions for missing fonts or unsupported content;
- preserve keyboard parity for frequent file, selection and tool operations.

### Pixelmator Pro

Use its concise tool grouping and direct canvas editing as the benchmark for
approachability. Its tool inventory treats row/column selections, gradient
fills, shapes, text-on-path and layer styling as first-class authoring tools,
not import-only features. The useful pattern is a small inspector combined
with on-canvas handles and immediate feedback.

LightTable application:

- use shared on-canvas handles for gradients, transforms, paths and masks;
- keep uncommon parameters in the relevant established panel, not custom
  dialogs;
- make fill/stroke/no-fill intent immediately visible and editable;
- provide simple initial states while preserving full semantic depth.

### GIMP

Use its flexible dock model, searchable resource views and separation of
Layers, Channels and Paths as reference for configurable expert workflows.
Avoid its tendency toward fragmented modal interaction.

LightTable application:

- allow stable saved dock/workspace arrangements;
- provide list/grid and search modes for large font, brush, gradient, pattern
  and asset collections;
- make Channels and Paths real inspectable document views;
- keep tool options synchronized to the active document and target.

### Krita

Use its painting ergonomics as the benchmark: configurable workspaces,
canvas-only focus, brush presets/HUDs, drawing assistants and resource-centric
workflows. These ideas are particularly relevant when LightTable grows from
photo editing into painting and illustration.

LightTable application:

- add workflow presets without creating separate editor implementations;
- support a canvas-focus mode and optional compact on-canvas controls;
- treat brush engines, presets and input-device response as measurable product
  systems;
- consider guides, symmetry and perspective assistants after basic path and
  brush fidelity is production-ready.

## Capability inventory

Legend: **Current**, **Partial**, **Missing**, or **Later**. `Partial` means the
feature has a real implementation but cannot yet support the complete workflow.

| Area | Status | Highest-value next capability |
| --- | --- | --- |
| Workspace and documents | Partial | Saved workspaces, recovery/session restore, canvas-focus mode and consistent recent-file previews. |
| Layers and groups | Partial | One tokenized row/thumbnail/indent contract; masks, clipping and only active effects displayed compactly. |
| Raster painting | Partial | Stress-tested brushes, selections and masks; predictable tight/off-canvas surfaces; preset/resource UX. |
| Grade and Lens Fx | Current/Partial | Preserve the existing panel quality while completing ownership, masks, local stacks and generic executors. |
| Selections | Partial | Smooth GPU overlays, row/column tools, feather/expand/contract, save/load selection and channel conversion. |
| Masks and channels | Partial | Independent raster/vector mask stack, direct thumbnail targeting, density/feather fidelity and Channels view. |
| Text | Partial | Missing-font Manage, desktop font discovery, full paragraph/path/transform editing, mixed-run UX and fast caret/selection overlays. |
| Shapes and paths | Partial | Complete imported compound paths, no-fill/no-stroke, paint, joins/caps/alignment, Boolean operations and path editing. |
| Gradients and fills | Partial | Shared asset/instance consumed by vectors, text and native fill layers with direct on-canvas editing. |
| Layer effects | Partial | Exact bounds, formulas, ordering, fill-opacity interaction, stacking and preview/final quality gates. |
| Adjustment layers | Partial | Isolated formula calibration and scope-level fallback, while retaining the existing Grade interaction model. |
| Smart Objects | Missing | Asset-backed embedded/linked container, preview cache, replace/relink/open contents and transforms/warp. |
| Transform and warp | Partial | One pivot/coordinate convention across native, PSD, PDF and future AI/EPS; high-quality settled output. |
| Color and precision | Partial | End-to-end profiles, soft proofing, 16-bit-preserving operations/export and explicit color-domain UI. |
| Assets and resources | Missing/Partial | Lazy searchable fonts, brushes, gradients, patterns, swatches and document-linked assets. |
| Import/export | Partial | Capability reports, explicit flatten decisions, PSD/PSB write-back and stronger PDF/AI/EPS semantics. |
| History and recovery | Partial | Named commands, document recovery, long-operation progress/cancel and deterministic crash isolation. |
| Automation | Partial | Typed command/query API, bounded gestures, artifact handles and later MCP adapter. |
| Performance | Partial | Continuous corpus, stress, memory, latency and high-zoom quality gates on desktop and web. |
| Accessibility | Missing/Partial | Complete keyboard reachability, focus order, scalable UI, labels, contrast and reduced-motion behavior. |

## Priority map

### P0 — trust and correctness

1. Make document/layer bounds, transforms, pivots and thumbnails consistent.
2. Preserve unsupported semantics and visual results without silent loss.
3. Keep paint, edit, undo/redo and native save/reopen reliable on imported and
   off-canvas content.
4. Eliminate document-runtime crashes, hook-order failures and unbounded UI or
   renderer work.
5. Add repeatable stress, memory and corpus smoke gates.

### P1 — core authoring parity

1. Finish editable text, including missing-font recovery and path/paragraph
   behavior.
2. Finish editable imported shapes and the shared path/fill/stroke model.
3. Complete the shared gradient model and a Pixelmator-class direct editor.
4. Calibrate active layer effects and adjustment formulas with isolated
   reference fixtures.
5. Complete selections, mask targeting and Channels/Paths inspection.

### P2 — professional document workflows

1. Add Smart Objects and linked/embedded assets.
2. Add PSD/PSB semantic export capability reporting and write-back.
3. Extend PDF/AI/EPS semantic interchange from the same canonical contracts.
4. Add saved workspaces, resource libraries and deeper color-management UX.
5. Stabilize a public command API, then attach an MCP adapter.

### Later — breadth after foundations

- advanced paint engines, assistants, symmetry and perspective workflows;
- animation/timeline or motion features;
- collaborative/cloud document services;
- generative features that would introduce remote-service dependencies.

## UI exposure rules

Every accepted capability must answer these before implementation:

1. Which existing toolbar group selects it?
2. Which existing property-bar controls expose the common case?
3. Which established panel owns durable or advanced properties?
4. Which GPU overlay communicates active handles, selection or recovery state?
5. What appears in the Layers tree, menus and context menus?
6. What is its keyboard and accessibility path?
7. How are unsupported, preview-backed, missing-resource and destructive states
   communicated?
8. Which typed command represents the action for history, tests and future
   automation?

New controls must reuse the current select, spinner, checkbox, color widget,
menu, modal and panel components. A feature does not justify a parallel visual
system.

## Decision filters

Before promoting an idea into a task:

- prefer a generic semantic contract used by at least two consumers;
- never trade away source editability merely to make one import look correct;
- use retained bitmaps as bounded caches, not hidden authority;
- require an explicit user decision before flattening or discarding semantics;
- keep desktop integrations behind host capabilities so web remains buildable;
- measure interactive latency and settled quality independently;
- require a minimal fixture before using a large PSD as a formula oracle;
- ship one independently testable capability per commit.

## Research basis

Primary product documentation consulted for interaction patterns:

- Adobe Photoshop: workspace, Layers panel, Contextual Task Bar and masks.
  <https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html>
- Apple Pixelmator Pro: tool families, including row/column selections,
  gradient fill, vector drawing and type-on-path.
  <https://support.apple.com/guide/pixelmator-pro/pixelmator-pro-tools-pixe9d86732d/mac>
- GIMP 3: dockable dialogs, tab organization and searchable resource views.
  <https://docs.gimp.org/3.0/en_GB/gimp-concepts-docks.html>
- Krita: saved workspaces, canvas-only mode, on-canvas brush editing and
  drawing assistants.
  <https://docs.krita.org/en/reference_manual/resource_management/resource_workspace.html>

These sources describe public behavior, not internal architecture. LightTable's
implementation remains governed by its own architecture contracts.
