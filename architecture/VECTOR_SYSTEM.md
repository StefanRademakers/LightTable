# Vector system

Status: current hybrid renderer contract, verified 23 August 2026.

LightTable owns canonical editable vector semantics and projects them into one
hybrid retained GPU renderer. SVG, Vello and PaintScene are not parallel
document models. Native LightTable WebGPU and Vello are cooperating realization
backends beneath the same compositor and shared `GPUDevice`.

The detailed SVG capability and security boundary is in
[Vector engine and SVG import capability](features/VECTOR_ENGINE_AND_SVG_IMPORT.md).
Rendering lifetime and invalidation rules are in
[Rendering and processing](RENDERING_AND_PROCESSING.md).

## Package boundaries

| Package | Current responsibility |
| --- | --- |
| `@lighttable/vector-core` | Serializable cubic paths/live shapes, affine math, bounds, hit testing, adaptive flattening and exact edits. No DOM, React or GPU ownership. |
| `@lighttable/vector-rendering` | Backend-neutral geometry realization, revision keys, stale-work rejection and bounded derived caches. |
| `@lighttable/vector-svg-normalizer` | Pinned feature-minimal `usvg` WASM normalization of untrusted static SVG under local-only resource and size/depth limits. Never document authority. |
| `@lighttable/vector-svg` | Editable SVG import planning and symmetric export over canonical vector/group/paint semantics. XML is transient. |
| `@lighttable/paint-scene` | Validated immutable renderer-neutral path, paint, fragment, clip and opacity-composition contract. Derived and disposable. |
| `@lighttable/paint-scene-adapters` | Canonical vector/PDF projection into PaintScene with explicit capability issues; lossy output cannot be called ready. |
| `@lighttable/vector-vello` | Retained Rust/Vello fragment and clip synchronization, bounded native-scene cache, zero-copy rendering into JavaScript-owned shared-device textures and idempotent recovery/disposal. |
| `@lighttable/vector-webgpu` | Native LightTable stencil/cover fill, stroke, mask and editing-overlay WebGPU paths. It remains the compatibility/specialized fallback. |
| `@lighttable/lighttable-app` | Render-island planning, document/compositor lifecycle, per-island admission, final compositing, history, tools and UI. |

Dependencies flow from canonical/source models toward derived scene contracts
and backend resources. A backend package must not import the application or
make its cache a source of document truth.

## Current render graph

```text
canonical vector/group layers (independently editable)
                    |
                    v
RenderIslandPlanner: exact semantic boundaries
                    |
                    v
RetainedRenderIslandRegistry: stable runtime resource IDs
                    |
        +-----------+------------+
        |                        |
eligible island             unsupported/specialized island
retained Vello scene        native LightTable WebGPU
        |                        |
        +-----------+------------+
                    |
          LightTable layer compositor
                    |
          viewport + native editor overlays
```

An island is a render projection, never a layer merge. Stable layer and element
IDs remain addressable by selection, history, save/export, Actions and MCP.
Normal source-over vector runs may share a surface; opacity groups may use
nested PaintScene isolation. Raster/text/adjustment interleaves, unsupported
masks/effects, clipping dependencies and non-normal blend semantics split or
exclude islands conservatively.

Backend choice is per island and capability-first. Eligible islands use Vello;
the native path handles unsupported islands and editor-specialized primitives.
A partial Vello failure is discarded before deterministic frame fallback. The
retired `dev:desktop:vello`, `package:desktop:vello` and document-wide backend
switches must not return as product modes.

## Retention and invalidation

- Canonical curves/shapes remain exact; flattened geometry and PaintScene are
  revision-keyed caches.
- Pan/zoom updates presentation only. It must not recompile PaintScene,
  retessellate a document-sized surface or recompose document pixels.
- A normal element edit reprojects the changed fragment, marks its island dirty
  and reuses unchanged JS/Rust fragments. Whole-island topology changes are
  reserved for real split/merge boundaries.
- Visibility changes composition participation, not island identity or source
  lifetime.
- `active`: participates now. `warm`: hidden with texture and scene retained.
  `cold`: texture evicted under the per-document surface budget while the JS
  projection and Rust scene remain. `evicted`: canonical resource removed and
  texture/native scene released.
- The Rust retained-source cache is independently bounded. If it evicts a
  source still represented in JS, the backend detects absence and rehydrates
  it from the canonical-derived PaintScene.
- Device loss releases backend state idempotently, reacquires the shared device
  and reconstructs pixels from canonical state. GPU state is never persisted.

## Current evidence boundary

- The representative layered SVG projects 17 canonical vector surfaces to five
  retained artwork islands, reducing measured texture use from about 178 MiB to
  107 MiB while keeping layers separately editable.
- The recorded island/per-layer preview difference is small but non-zero
  (RMSE about 1.03), so exact compositing cases remain guarded by capability
  admission and native fallback rather than a claim of byte-identical AA.
- The 26,492-path `VORTEXT.SVG` uses one retained island. Warm packaged first
  useful pixels are 428--446 ms in five runs; the final editable document is
  verified separately and remains slower.
- Pan and zoom on the measured SVG corpus perform presentation frames without
  document recomposition. Warm edits upload only changed retained fragments.
- Packaged lifecycle/device-loss tests report bounded resources and canonical
  pixel recovery on the measured Windows discrete-GPU system. This is not yet
  cross-vendor release qualification.

## Core rules

- Document coordinates are canonical; viewport pixels are presentation.
- Adaptive tessellation follows authored/document scale and quality, not an
  arbitrary fixed segment count or camera zoom.
- Fills/strokes composite in the declared linear-premultiplied contract.
- Capability loss is explicit. Never render an unsupported clip, mask, blend,
  paint or group as if it were absent.
- No normal vector route may use GPU-to-CPU-to-GPU raster fallback.
- Selection outlines, Bezier editing lines, transform gizmos and brush cursors
  remain native retained overlays unless measurements justify migration.
- Reuse abstractions only where ownership and latency stay explicit; fewer
  surfaces or passes are not automatically faster or correct.

## Current gaps

- Exact boolean union for multi-operand vector clips.
- Inverted clips, exact vector+raster mask multiplication and clip ordering with
  layer styles/effects.
- Broader blend/isolation/knockout parity and GPU-vendor/high-DPI evidence.
- SVG patterns, filters, embedded images, native SVG text layout and richer
  mask/CSS semantics.
- Path boolean authoring, richer align/distribute and continued shape/path UX.
- Cold GPU startup, large-scene canonical construction and final edit-readiness.
  Warm JSON serialization/JS-WASM transfer is measured small and is not the
  first general optimization target; large initial deserialization may justify
  a future binary bootstrap only with new evidence.
