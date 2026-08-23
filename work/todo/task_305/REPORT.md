# Vello path decomposition and render-island architecture

## Outcome

The current cost is not inherent Vello cost. On a warm mutation of the
representative `svg_vector_render_test.svg` document, LightTable spends more
CPU time constructing the PaintScene JS projection than Vello spends preparing
and submitting its GPU work. JSON and the JS/WASM boundary are currently small
for a one-fragment delta. The present 1:1 mapping from 17 canonical vector
layers to 17 document-size surfaces is also not required by the fixture's
compositing semantics: the current PaintScene contract needs five render
islands, not seventeen.

This pass also fixes two inverted hot-path decisions:

- an unchanged layer is rejected by a cheap dependency key before PaintScene
  compilation, serialization or WASM transfer;
- hiding a canonical layer skips its composite but no longer destroys its GPU
  surface or retained Rust scene.

Canonical document layers remain unchanged and individually editable. These
are render-projection and resource-lifecycle changes only.

## Measurement setup

- Production-packaged desktop build, forced Vello backend.
- Representative document: `svg_vector_render_test.svg`, 1400 x 1100.
- Document structure: 28 canonical nodes, 17 vector leaves.
- Five warm mutation samples are reported below; the first sample is excluded
  because it includes cold shader/profiler initialization.
- CPU phase timers use `performance.now()` in JS and WASM/Rust.
- Nested figures (for example JS object construction inside PaintScene
  compilation) are not added twice in exclusive totals.
- Evidence:
  - `tmp/task-305-final-mutation-composite/report.json`
  - `tmp/task-305-final-visibility-lazy/report.json`
  - `tmp/task-305-first-close-profile/report.json`
  - `tmp/task-305-first-close-direct/report.json`
  - `tmp/task-305-layer-analysis/report.json`

## Warm changed-fragment CPU decomposition

Average document-composite CPU encode: **3.303 ms**.

| Exclusive phase | Average | CPU encode share |
|---|---:|---:|
| Dependency key | 0.422 ms | 12.78% |
| PaintScene compilation | 1.410 ms | 42.69% |
| Backend cache lookup/invalidation | 0.014 ms | 0.42% |
| JSON stringify | 0.006 ms | 0.18% |
| JS/WASM transfer estimate | 0.026 ms | 0.79% |
| Rust deserialization | 0.041 ms | 1.24% |
| Rust fragment encoding | 0.012 ms | 0.36% |
| Rust scene synchronization | 0.027 ms | 0.82% |
| Vello scene preparation | 0.070 ms | 2.12% |
| Vello render recording/submission CPU | 0.599 ms | 18.14% |
| Texture/surface creation or disposal | 0.000 ms | 0.00% |
| Final LightTable layer composite | 0.292 ms | 8.84% |
| Residual LT orchestration | 0.384 ms | 11.63% |

The PaintScene compilation itself decomposes as follows. These rows are nested
inside the 1.410 ms compilation figure:

| PaintScene subphase | Average | Whole encode share |
|---|---:|---:|
| Canonical to PaintScene projection | 0.047 ms | 1.42% |
| JS PaintScene object construction | 1.314 ms | 39.78% |
| Final validation | 0.001 ms | 0.03% |

Each mutation visited 17 vector layers, rejected 16 by dependency identity,
compiled one changed layer, uploaded one fragment, rendered one Vello scene,
and reused all existing surfaces. No surface lifecycle cost occurred.

### Answers to the requested percentages

1. **Actual Vello GPU rendering: unknown, not zero.** The diagnostic Vello
   build requests WebGPU timestamp-query features and integrates Vello's GPU
   profiler. Electron/Dawn did not return valid timestamp samples on this
   browser WebGPU path, even with the diagnostic unsafe-Dawn switch. A queue
   completion wall interval was also captured, but it includes all outstanding
   document/display GPU work and async scheduling; treating it as Vello GPU
   time would be false precision. Exclusive GPU percentage requires a supported
   native timestamp-query route, PIX/Chrome GPU capture, or a Dawn build that
   exposes these queries.
2. **LightTable orchestration:** 68.48% when final compositing is kept in its
   own requested category (77.32% when final compositing is included). The most important component
   is PaintScene JS construction (39.78% of total), followed by dependency work
   across the 17 current layer boundaries (12.78%) and final composition (8.84%).
3. **JS/WASM transport:** 0.79%; JSON stringify adds another 0.18%.
4. **Texture/surface lifecycle:** 0% on warm edits and visibility toggles after
   the retention fix. Initial open still allocates 17 surfaces and remains a
   separate optimization target.
5. **Final compositing:** 8.84% CPU encoding, 27 fullscreen layer-composite
   passes in the measured update. This is CPU command construction only; GPU
   execution is included in the unavailable GPU measurement.

## Why 264 encode visits produced only eight renders

The visibility audit performs eight hide and eight show frames. A hidden frame
visits 16 vector leaves and a shown frame visits 17: `8 * 16 + 8 * 17 = 264`.
Only presentation/compositing changed. Previously every visit built a full PaintScene before the
scene key proved it was unchanged. Visibility also caused resource release and
recreation.

After this pass, the same captured workload reports:

- 264 Vello layer encode visits;
- 264 unchanged-scene reuses;
- 0 PaintScene compilations;
- 0 Vello scene renders;
- 0 fragment uploads;
- 0 surface recreations;
- 0 Rust source releases;
- 8.64 ms total document-composite CPU encode over 16 frames (0.54 ms/frame).

Classification: all 264 visits are compositing-plan visits whose scene content
is unchanged. None require compilation or Vello rendering. The visits remain
because the current compositor walks canonical leaves; the render-island plan
below removes that per-layer renderer boundary as well.

The dependency path uses an O(1) identity/signature check first. Some canonical
commands clone an element array even when only presentation changes. In that
case a content revision is calculated lazily for only the suspicious layer; a
matching revision updates the identity and returns without compilation.

## Visibility and resource retention

`visible = false` now means **skip participation in the composite**. It does not
mean delete the Vello source or destroy the surface. Retention walks all
canonical vector/text nodes, including group vector clips, independently of
visibility. Resources are released when their canonical IDs disappear.

This implements the correctness-critical active/warm distinction. The complete
bounded policy is still open:

1. `active`: visible and participating;
2. `warm`: hidden, texture and Rust scene retained;
3. `cold`: texture evicted under pressure, Rust scene retained;
4. `evicted`: Rust scene also evicted under stronger pressure/age.

Texture eviction and scene eviction must be independent. Restoring a cold entry
should allocate a target and render the retained Rust scene, without projecting
or serializing the document again.

## First-close spike

The observed 1.3-1.4 second first close was not Vello teardown.

- A CDP CPU profile of the slow observation was approximately 1.155 s idle.
- `release_paint_scene_source`, browser GC and resource destruction accounted
  for only a few milliseconds.
- The Playwright `locator.click()` returned only after about 1.289 s; canonical
  document close committed about 1 ms later.
- Dispatching the same DOM click directly produced closes of 18.52, 13.70 and
  15.83 ms.

The delay was Playwright's first actionability/stability wait in the audit
harness. It was not a Rust destructor, device poll, queue wait, shader cache,
texture destruction or global Vello runtime teardown. The lifecycle audit now
uses direct click dispatch by default, while retaining an option to exercise
locator actionability explicitly.

## Minimal render islands

The 17-surface mapping is a convenience, not a semantic requirement. The
representative fixture has normal blend mode everywhere, no masks, effects,
clipping or raster interleaving, and only two groups that require opacity
isolation (0.55 and 0.62). Under the current PaintScene semantics the minimal
exact projection is **five islands**:

1. compatible vector run before isolated group A;
2. isolated opacity group A;
3. compatible vector run between the groups;
4. isolated opacity group B;
5. compatible vector run after group B.

The planner must split at true compositing dependencies:

- non-normal blend or isolated opacity;
- raster/vector ordering boundaries;
- masks and clips whose scope cannot live inside the same Vello scene;
- effects and adjustments;
- clipping chains and knockout/isolation semantics;
- color/format boundaries that require an intermediate target.

It must not merge canonical layers. An island is a retained render projection:

```text
canonical layers 1, 2, 3, 4 (still independently editable)
                    |
                    v
Vello island A: stable fragments [layer1, layer2, layer3, layer4]
```

Editing layer 3 mutates fragment 3 and invalidates only island A's output. The
document/history/selection model continues to address canonical layer 3.

With richer PaintScene isolation-group semantics, the five islands could
potentially become fewer. That reduction is valid only after pixel-parity tests
prove Vello's group opacity, clip, blend and color behavior matches LightTable.

## Transport and retained-scene decision

| Option | Decision |
|---|---|
| JSON | Keep for bounded bootstrap and diagnostics; not today's small-delta bottleneck. |
| Compact binary | Useful for large first build, but does not remove projection/rebuild ownership. |
| Typed-array command stream | Good intermediate ABI for bulk paths and stable numeric layout. |
| Shared WASM linear-memory structures | Harder lifetime/safety contract; browser threads and growth complicate views. |
| Persistent Rust scene + mutation commands | Target architecture for interactive edits. |

The target API is stable-ID mutation, not full-scene replacement:

```text
initial: canonical document -> island projection -> retained Rust fragments -> Vello
edit:    update fragment/geometry/paint/transform(id, delta) -> render dirty island
```

Binary transport can later accelerate the initial island build. Replacing the
current 0.006 ms stringify and 0.026 ms warm transfer before retained mutation
lands would optimize the wrong part of this fixture.

## Shared-device hybrid architecture

The recommended production graph is:

```text
canonical document + revisions
          |
          v
render-island planner (semantics and stable IDs)
          |
          +--> native LightTable WGSL: simple primitives, overlays, gizmos
          |
          +--> retained Vello scenes: complex paths/strokes/large fragment sets
          |
          v
LightTable compositor on one Vello-owned shared GPUDevice
```

Backend choice belongs to the island, not the document. The current integration
already proves that native LightTable passes and Vello can use the same
Vello-owned browser `GPUDevice`. This avoids copies between devices and enables
one compositor. Selection must be based on measured island complexity and exact
feature support, with parity fallback—not a magic layer-count threshold.

## Next implementation sequence

1. Add a pure `RenderIslandPlanner` with fixtures for blend, opacity isolation,
   clips, masks, raster interleaving, effects and adjustments.
2. Introduce stable island/source IDs and map canonical layer/element IDs to
   retained Rust fragments.
3. Add a retained mutation ABI (`upsert/remove/reorder/paint/transform`) and
   eliminate full changed-layer JS object reconstruction.
4. Allocate one target per true island and parity-test the 17-to-5 fixture.
5. Add warm/cold/evicted budgets, preserving Rust scenes separately from GPU
   textures.
6. Add cost-based native/Vello routing per island on the shared device.
7. Capture exclusive GPU timestamps on a supported native/Dawn diagnostic path
   before claiming GPU percentages or selecting thresholds.

This pass deliberately does not merge layers or wire island ownership into the
renderer as an opportunistic patch. Resource integration needs the typed
semantic plan and oracle coverage below because a wrong boundary silently
changes pixels.

## Phase 1 follow-up: semantic planner implemented

The pure `RenderIslandPlanner` is now implemented and connected only to
diagnostic telemetry. It does not yet own rendering resources and therefore
cannot change document pixels.

The production-packaged representative fixture reports:

- 16 canonical vector layers in the current import;
- 5 projected surfaces;
- 3 direct vector runs;
- 2 observable isolated-opacity groups;
- 5 Vello-eligible islands;
- 0.07 ms planning time for the measured mutation frame.

The earlier 17-layer count came from a different captured import state; the
architectural result is unchanged. The current canonical document can reduce
from 16 per-layer surfaces to five true boundaries.

The live diagnostic also exposed that SVG import marks many neutral `<g>`
nodes as `compositing: isolated`. The planner does not blindly convert that
flag into a surface. Opacity-1, normal source-over vector groups are associative
and therefore unobservable as isolation boundaries. Isolation is retained when
group opacity, descendant blend/processing, masks, effects or clipping make it
observable. Tests cover both the collapsible and observable cases.

Runtime identity is handled by a separate `RetainedRenderIslandRegistry`.
Canonical layer IDs are never rewritten. Exact plan matches retain their
resource ID; an isolated island then matches its canonical isolation owner;
remaining split/merge cases use deterministic maximum layer overlap with anchor
tie-breaking. Tests prove identity survives visibility, immutable canonical
object replacement, child insertion and island splits, and that deleted islands
produce explicit release IDs.

## Phase 2: active island resources and retained member projection

The diagnostic Vello path now allocates and renders by stable
`renderIslandResourceId`. Canonical layers remain independently editable and
the per-layer Vello route remains selectable as the pixel oracle/fallback.
Cross-layer island scenes use layer-qualified stable fragment IDs. A changed
member is projected again; unchanged member PaintScene results are retained in
JS and unchanged Rust/Vello fragments stay resident. Visibility changes mutate
composition only and may omit hidden retained fragments without deleting them.

Measured production-package evidence:

- per-layer oracle: 17 Vello surfaces / 17 Rust scene entries / 177.72 MiB;
- active island route: 5 artwork islands plus 1 still-external scoped vector
  mask / 6 Rust scene entries / 113.10 MiB;
- warm element mutation: 1 island compilation, **1 projected member**, 1 Rust
  fragment upload; the cache is element-granular, so the changed member also
  projects exactly **1 fragment** while every unchanged element is reused;
- eight hide/show cycles: exact restored screenshots, zero GPU-memory delta,
  zero surface recreation/release, and no fragment uploads;
- mutation restore reproduces the island preview exactly (RMSE 0).

The strict oracle gate is not yet green: island versus per-layer output is
RMSE 1.028 (MAE 0.040, maximum channel delta 64). Differences affect 3,426
preview pixels, predominantly antialiased content in the final vector run.
The island route therefore must not replace the oracle yet. The previous
five-surface claim also omitted the separate scoped vector-mask surface. To
reach five actual resources rather than five artwork islands, PaintScene needs
nested opacity/isolation composition so the clipped group containing an
opacity child can become one retained island instead of an island plus mask
surface.

Evidence:

- `tmp/task-305-m1-oracle/report.json`
- `tmp/task-305-m1-islands/report.json`
- `tmp/task-305-m2-retained/report.json`
- `tmp/task-305-m2-fragment/report.json`
- `tmp/task-305-m2-compositor-fixed/report.json`

## Phase 3: nested opacity closes the external-mask resource gap

PaintScene schema 5 now represents nested normal source-over opacity groups.
The Vello backend encodes these as isolated scene layers; the specialized
native PaintScene backend rejects hierarchical composition explicitly rather
than flattening it incorrectly. Canonical vector layers remain independent.
Only their retained render projection gains an opacity composition tree.

The planner conservatively folds a subtree only when it contains vector
members, normal source-over groups, group opacity, and a supported vector clip.
Blend modes, raster masks, effects, clipping chains, inverted clips and raster,
text, or adjustment interleaves remain semantic boundaries/fallbacks.

Production-package evidence on `svg_vector_render_test.svg`:

- 5 Vello surfaces and 5 retained Rust scene entries (the external scoped-mask
  surface is gone);
- approximately 107 MiB reported GPU texture memory;
- 24-step pan settled in 425 ms, with Vello queue-completion wall time averaging
  3.87 ms per submitted frame and no surface recreation;
- 24-step zoom produced no frame over 33.3 ms;
- versus the per-layer oracle: RMSE 1.0292, MAE 0.0417, max channel delta 64;
- versus the former six-resource island route, the nested-opacity change is
  restricted to 1,822 pixels in a 57 x 57 region, with maximum delta 6 and mean
  maximum-channel delta 1.84. The Chrome-reference RMSE is effectively
  unchanged (24.00569 to 24.00572).

This closes the measured 6-to-5 resource milestone but does **not** make the
island renderer a universal pixel oracle. The per-layer path remains selectable
until the broader compositing parity matrix and fallback gates are complete.

Evidence: `tmp/task-305-opacity-island/report.json`.

### Four-file packaged corpus gate

The same commit was packaged twice, once with retained islands enabled and once
with `LIGHTTABLE_VECTOR_ISLANDS=0`. All four files in the current external SVG
corpus opened and completed pan/zoom evidence without a Vello failure:

| File | Oracle -> island surfaces | Oracle -> island GPU MiB | Oracle/island preview |
| --- | ---: | ---: | --- |
| `complexahexagon.svg` | 1 -> 1 | 28 -> 28 | exact |
| `Lion_héraldique.svg` | 1 -> 1 | 9 -> 9 | exact |
| `svg_vector_render_test.svg` | 17 -> 5 | 178 -> 107 | RMSE 1.0292 |
| `VORTEXT.SVG` | 1 -> 1 | 54 -> 54 | one channel differs by 1 |

The island optimization is therefore neutral for already-single-surface files
and materially reduces only the layered fixture. It does not improve initial
open time by itself: `VORTEXT.SVG` still needed about 3.0--3.2 seconds to first
render. Those timings identify import/projection/initial scene construction as
a separate production issue rather than evidence for more aggressive island
merging.

Evidence:

- `tmp/task-305-opacity-corpus/report.json`
- `tmp/task-305-opacity-corpus-oracle/report.json`

## Phase 4: explicit active/warm/cold texture lifecycle

Vector islands now distinguish render activity from canonical retention:

- active: at least one member participates in the current composition;
- warm: fully hidden, with its last texture, JS projection and Rust scene kept;
- cold: the texture was evicted under the 256 MiB per-document Vello surface
  budget, while JS projection and Rust scene remain retained;
- evicted: the canonical resource was deleted and both texture and Rust source
  are released.

Fully hidden islands are no longer rerendered as transparent. Re-showing an
unchanged warm island reuses its existing texture. Budget pressure selects the
least-recently-used warm surface only; active surfaces are never opportunistically
destroyed, even when the active working set itself exceeds the cache budget.

An eight-cycle packaged hide/show audit on the representative layered SVG
reported exact restored screenshots, zero GPU-byte growth, zero Vello scene
renders, zero fragment or clip uploads, zero surface recreation, zero Rust
source releases, and 72 unchanged-scene reuses. A unit-level pressure gate
proves the hidden warm texture becomes cold before the active texture and that
the retained resource entry survives for rehydration.

Evidence: `tmp/task-305-lifecycle/report.json`.

## Current warm-edit priority correction

The latest six-edit packaged profile no longer supports prioritizing binary
transport or a more granular sub-fragment ABI. Excluding the first JIT sample,
ordinary edits project and upload one fragment; document composite costs
1.12--2.41 ms, PaintScene compilation 0.12--1.14 ms, JS/WASM roundtrip
0.48--0.60 ms, Rust fragment encoding about 0.01 ms, and Vello CPU submit
0.32--0.41 ms. Island planning (0.78--2.05 ms) is now often the largest named
CPU phase. A finer mutation ABI remains a future option for demonstrated large
single-fragment workloads, not the next production bottleneck.

Evidence: `tmp/task-305-opacity-mutation/report.json`.
