# Photoshop parity and missing features

Status: authoritative current parity register, 4 August 2026.

This document records what LightTable currently detects, preserves, displays,
renders and edits from Photoshop documents, and which canonical capabilities
are still missing. It is deliberately separate from the interchange contract:

- `PHOTOSHOP_INTERCHANGE.md` defines the rules that must remain true.
- This document records current implementation and verification status.
- `reference/photoshop/` contains research and historical implementation plans.
- Task 049 contains the generated corpus inventory and detailed evidence.

The register must be updated whenever a Photoshop-facing feature changes. A
feature is never called "supported" without naming the relevant parity axis.

## Parity axes

| Axis | Meaning |
| --- | --- |
| Detect | The importer identifies the feature and relevant source parameters. |
| Preserve | Source semantics or payload survive untouched native save/reopen where promised. |
| Display | The user sees a useful result, possibly from a retained Photoshop preview. |
| Render | LightTable recreates the result from semantic data in its own renderer. |
| Edit | Existing UI can change the semantic feature without implicit flattening. |
| Create | Existing UI can create a compatible native feature. |
| Export | A target Photoshop file receives editable semantics rather than only flattened pixels. |
| Verify | Focused fixtures and Photoshop/LightTable comparisons pass. |

`Preview-backed` is a display capability, not semantic rendering or editing.
`Preserved descriptor` is not the same as preserving all source assets needed
to reopen or export that feature.

## Evidence baseline

The current real-world baseline is the ten-template Save the Date corpus below
`D:\mediavibe\LightTableTestFiles\psd\templates\Save the Date Invitation PSD 6`.

- Photoshop 27.8 and `ag-psd` independently report exactly 284 layers.
- All ten PSDs are 8-bit RGB and approximately 3000 x 4200 pixels.
- All ten open to a rendered frame in packaged LightTable without a page error.
- Reconstruction/reference difference ranges from 0.40% to 98.39%.
- Detailed per-layer evidence:
  [`corpus-inventory.json`](../work/done/task_049_psd_template_corpus_feature_audit/corpus-inventory.json).
- Analysis and prioritization:
  [`feature-matrix.md`](../work/done/task_049_psd_template_corpus_feature_audit/feature-matrix.md).

The corpus is useful but not complete. It contains no clipping layers, text on
path, warped text, gradient/pattern fill-layer types or Smart Filters. Those
features require dedicated fixtures and cannot be signed off from this corpus.

## Current parity dashboard

Legend: **Yes**, **Partial**, **Preview**, **No**, or **N/A**.

| Feature | Detect | Preserve | Display | Render | Edit/Create | Export | Verify | Current truth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raster layers | Yes | Yes | Yes | Yes | Yes | No | Yes native | The current native schema retains tight layer-local bounds. Merge/flatten use a separate full-canvas runtime and retain tight sources for undo/redo; the ten-file corpus and packaged EHS-396 bake smoke pass. |
| Groups and nesting | Yes | Yes | Yes | Yes | Yes | No | Partial | 33 pass-through groups occur in nine corpus files; exact contextual parity is not fully signed off. |
| Off-canvas/oversized layers | Yes | Yes | Yes | Yes | Partial | No | Partial | 63 off-canvas and 13 oversized layers import; native save/reopen retains the tight-raster contract and is verified on painted EHS-396 content. |
| Opacity | Yes | Yes | Yes | Yes | Yes | No | Partial | Nineteen partial-opacity layers occur in seven documents. |
| Fill opacity | Yes | Yes | Yes | Yes | Yes | No | Weak | Canonical property exists, but this corpus contains only one non-default instance. |
| Blend modes | Yes | Yes | Yes | Yes for measured RGB set | Yes | PSD RC subset | 48-case strict matrix | All 26 exposed modes plus opacity/fill cases have isolated fixtures. The untagged/sRGB/Adobe RGB 8/16-bit matrix passes at RMSE 0.07–0.79, including Adobe RGB Hard Mix at 0.13/0.15. Untested profile classes, 32-bit documents and unsupported PSD semantics remain outside this claim. See `PHOTOSHOP_COLOR_AND_BLEND_PARITY.md`. |
| Clipping chains | Yes | Yes | Yes | Yes | Yes | No | Separate fixtures | Not exercised by the ten-template corpus. |
| Raster masks | Yes | Partial | Yes | Yes | Partial | No | Partial | One bitmap-mask slot exists; density/feather calibration remains. |
| Vector + user mask combination | Yes | **Partial** | Preview | Partial | No | No | Failed architecture | Photoshop can retain both independently; LightTable currently collapses toward one effective raster mask. |
| Adjustment layers | Yes | Yes | Partial | Partial | Yes | Gradient Map PSD RC | Partial | Solid Gradient Map is now native, GPU-rendered, editable and PSD-roundtrippable. Noise gradients remain preserved/no-op; Photo Filter, Color Balance, Hue/Saturation and Brightness/Contrast remain explicit approximations pending isolated calibration. |
| Layer styles | Yes | Yes | Partial | Partial | Yes | No | Partial | Corpus uses Color Overlay, Drop Shadow, Gradient Overlay and Pattern Overlay; edge cases and combined stacks remain. |
| Dormant style descriptors | Yes | Yes | Correctly hidden | N/A | Style editor | No | Yes UI | Dormant descriptors remain stored but no longer clutter the compact Layers tree. |
| Solid vector shapes | Yes | Partial | Partial | Partial | **Partial** | No | Failed authoring parity | Some simple shapes map natively, but observed imported shapes still fall back or expose incomplete editable properties. |
| Vector strokes | Yes | Yes | Preview/Partial | Partial | Partial | No | Failed | Six strokes expose incomplete alignment, paint, join/cap and opacity semantics. |
| PSD text descriptors | Yes | Yes descriptor | Preview or native | **Yes where supported** | Partial | No | Partial | Ordinary point/paragraph descriptors now become semantic text with a bounded derived preview; missing-font Replace/Manage UX and a fresh whole-corpus count remain. The native schema persists stable external system-font references without embedding their bytes. |
| Native LightTable text | N/A | Yes | Yes | Yes | Yes | PDF partial | Separate fixtures | The text engine works independently; PSD realization/font recovery is the gap. |
| Missing fonts | Yes | Partial | Preview | Partial | Partial | No | Partial | Twenty-eight source font families occur. Desktop system discovery is lazy and complete for Windows TTF/OTF/TTC/variable faces; native absent-font reopening and broader recovery coverage remain in Task 048. |
| Smart Objects | Yes | **Partial descriptor** | Preview | No | No | No | Failed semantic parity | Fifty-seven previews display; embedded/linked object payloads are skipped and cannot be reopened. |
| Smart Object affine placement | Yes | Descriptor | Preview | Via pixels | No | No | Partial visual | Placement appearance comes from the layer-local preview rather than a native smart container. |
| Smart Object non-affine/warp | Yes | Descriptor | Preview | No | No | No | Failed semantic parity | Eight instances in EHS-401 require a canonical quadrilateral/warp contract. |
| Smart Filters | Parser-dependent | No contract | Preview at best | No | No | No | Not covered | No fixture in this corpus. |
| Gradient/pattern fill layers | Parser-dependent | Partial | Preview at best | **No complete contract** | No | No | Not covered | Core authoring parity is missing; do not confuse fill layers with Layer Style overlays. |
| PSD/PSB write-back | Yes for verified subset | Yes | Photoshop-verified | Yes for flow text and supported vectors | File > Export Photoshop PSD | **PSD RC / PSB gated** | TextTest + shapes + projection fixtures | The 8-bit RGB PSD writer preserves the verified canonical subset and stops on known lossy projections. Smart Object payloads, native unsupported adjustments, pattern resources, arbitrary text-on-path authoring and PSB remain gated. |
| Unknown Photoshop blocks | Partial | Partial | N/A | N/A | No | No | No | Warnings are reported, but original PSD bytes and block-complete roundtrip are not retained. |

## Corpus findings by impact

| Document | Difference | Main reason to keep as a gate |
| --- | ---: | --- |
| EHS-395 | baseline 95.12% | Its two Gradient Maps are now native and make this the next whole-document regression oracle; remaining Smart Object, text/font and contextual-stack differences must be isolated before attributing a new aggregate score. |
| EHS-404 | 98.39% | Six approximate adjustment layers demonstrate accumulated color-stack error. |
| EHS-405 | 55.79% | Small tree with text, mask and vector reconstruction differences. |
| EHS-407 | 53.92% | Compact text/mask/vector regression document. |
| EHS-406 | 38.27% | Vector masks, active Drop Shadows and off-canvas content. |
| EHS-409 | 22.26% | Hard Light plus off-canvas/oversized content. |
| EHS-396 | 17.57% | Large smart-object/off-canvas workload and vector strokes; useful performance gate. |
| EHS-402 | 12.55% | Thirteen text previews, five vectors and five oversized layers. |
| EHS-401 | 8.74% | Twenty-four smart previews and eight non-affine/warped smart placements. |
| EHS-442 | 0.40% | Near-exact preview-backed baseline that must remain visually stable while text becomes editable. |

Corpus percentages are never averaged for sign-off. A low average can hide a
completely broken adjustment-heavy document.

## Authoring parity reality

Visual fallback currently makes the importer look more complete than the
editor actually is. For the three most basic Photoshop authoring families:

- **Text:** the original audit found all 81 corpus text layers preview-only.
  The follow-up importer now recognizes Photoshop's empty text-path placeholder
  and promotes supported point/paragraph descriptors to semantic text while
  retaining the exact bounded preview. EHS-396 physically verifies eight such
  layers across native save/reopen; the corpus must be re-audited after the
  missing-font interaction is complete.
- **Shapes:** the canonical vector engine can edit native paths and some simple
  PSD shapes map into it, but imported shape coverage is inconsistent and
  stroke/fill properties frequently remain preview-backed or incomplete.
- **Gradients:** Layer Style Gradient Overlay has partial support, but editable
  Photoshop gradient fill layers, gradient shape fills and a shared gradient
  asset/editor contract are not complete.
- **Effects:** several Layer Style kinds have a canonical object and GPU path,
  but exact Photoshop fidelity for formulas, expansion bounds, ordering,
  fill-opacity interaction and compositing context is not yet established.

These are major missing features, not polish items. The correct response is a
shared semantic text/path/fill/stroke/gradient model with PSD adapters, not
special editing controls attached to raster previews.

## Missing-feature register

### PSD-P0-001 - Native tight raster bounds (resolved)

**Evidence:** 63 off-canvas layers, 13 layers larger than the canvas and the
originally failed EHS-396 native save/reopen.

**Resolution:** The native schema serializes local `width`, `height`, offsets
and the document transform. Pre-release historic schemas are intentionally not
retained. A painted tight EHS-396 layer
has been saved and reopened with its pixels and placement intact.

**Verification:** Ordinary, translated, negative-origin and oversized surfaces
retain their local contract. The packaged EHS-396 bake smoke merges two tight,
translated sources into a new document-sized runtime, restores both originals
on undo and restores the baked destination on redo without a page error. The
ten-document corpus, web build, packaged desktop build and export tests pass.

**Owner:** Task 047. **Priority:** P0.

### PSD-P0-002 - Shared retained-preview contract (resolved for text/vector)

**Evidence:** 81 text layers, 31 vectors and 57 smart objects depend partly or
fully on layer-local previews.

**Original gap:** Preview-backed semantics were implemented through
feature-specific fallback paths without a shared contract for semantic source,
derived preview assets, invalidation or explicit bake.

**Resolution:** The native schema contains one bounded semantic derived-preview
contract for text and vectors. A semantic dependency key decides whether the
preview remains current; authoritative edits automatically fall through to the
native renderer. Runtime allocation is bounded, counted and explicitly pruned,
and save/reopen retains the preview without making it editing authority.

**Required follow-up:** Extend the same cache policy to future smart containers.
Cached pixels remain derived display data, never the claim of semantic support.

**Related work:** Task 048 starts with text. **Priority:** P0.

### PSD-P0-003 - Cached compositing scope / render island

**Evidence:** EHS-395 and EHS-404 differ by 95.12% and 98.39% when unsupported
or approximate adjustment stacks affect the layers below them.

**Gap:** An Adjustment Layer has no layer-local pixels. A per-layer fallback
cannot preserve a Gradient Map, pass-through group adjustment or other
scope-level operation.

**Required decision:** Define a cached group/subtree/document result with a
source fingerprint, dependency set, quality/encoding metadata and explicit
invalidation. While semantics are unsupported, that scope preview is visual
authority. On an invalidating edit, LightTable must rebuild, request an
explicit bake or report loss; it must not silently switch to a no-op.

**Priority:** P0. This is infrastructure, not a Gradient Map special case.

### PSD-P1-001 - Missing-font text recovery

**Evidence:** All 81 corpus text layers remain raster layers; 28 distinct font
families are referenced.

**Required behavior:** Preserve text semantics and bounded preview, show
missing-font state, and offer Cancel/Replace/Manage on first edit. Replacement
realizes the layer through the existing text engine and records one undoable
command. Native save/reopen must preserve this recovery state.

**Owners:** Tasks 048 and 046. **Priority:** P1 after the shared preview model.

### PSD-P1-002 - Adjustment parity

**Corpus instances:** 5 Photo Filter, 2 Gradient Map, 2 Color Balance,
1 Brightness/Contrast and 1 Hue/Saturation.

**Current status:** Solid Gradient Map is implemented as a canonical
`lt.gradient-map` module with up to eight color and opacity stops, midpoint
interpolation, reverse and dither. The same data drives the shared gradient
editor, WebGPU execution, native persistence and editable PSD import/export.
Photoshop noise gradients and non-classic interpolation remain preserved or
explicitly approximate; their descriptors are never discarded.

**Next calibrated order:** Photo Filter (five corpus instances), Color Balance
(two), Hue/Saturation (one) and Brightness/Contrast (one), using isolated
Photoshop fixtures and combined-stack gates. Do not relabel their current
grading/mixer approximations as native merely because controls exist.

**Priority:** P1.

### PSD-P1-003 - Independent mask stack

**Evidence:** 22 user/real raster masks and 21 vector masks.

**Gap:** One exposed bitmap-mask slot cannot preserve Photoshop user mask plus
vector mask as independently editable operands.

**Required decision:** Adopt an ordered/typed mask stack or an equivalent
explicit combination contract. Retain the rasterized combined result as a
cache, not as the only authoritative mask.

**Priority:** P1.

### PSD-P1-004 - Imported shape editability

**Evidence:** Thirty-one vector shape layers across eight corpus documents,
six vector strokes, plus direct editor observation that several imported shape
layers remain non-editable or expose incomplete fill/stroke state.

**Gap:** Detection and a raster preview can succeed even when the PSD path,
compound-path, fill, stroke and transform cannot be represented together as a
native editable vector element.

**Required decision:** Make the shared vector scene the only semantic shape
authority. Import compound paths, winding/fill rules, no-fill/no-stroke,
gradient/pattern paint, stroke alignment, joins/caps and transforms into that
model. Unsupported paint remains descriptor + preview, with an explicit
recovery/bake boundary.

**Implementation baseline:** supported PSD path geometry now remains a native
vector layer even when its gradient/pattern or stroke paint is not yet native.
Manifest v5 retains the bounded Photoshop preview under the semantic dependency
key; the first authoritative style edit invalidates that preview. `D:\shapes.psd`
also physically verifies solid fill, no-fill, stroke color/width/alignment and
native save/reopen across four editable vector layers.

**Priority:** P1 core authoring parity.

### PSD-P1-005 - Gradient and fill-layer model

**Evidence:** The corpus contains Gradient Overlay but does not cover native
gradient/pattern fill-layer types. Manual use confirms those layers and shape
gradients are not yet a complete editable workflow.

**Gap:** A gradient is currently represented in several feature-local forms.
There is no single document asset plus paint instance contract shared by shape
fills, text fills, fill layers, Layer Styles and future PDF/AI shading.

**Required decision:** Define reusable gradient/pattern assets, color and
opacity stops, midpoint/interpolation semantics, spread, transform, coordinate
space and color domain. A Gradient Fill Layer owns a paint instance over an
explicit document/layer extent; it is not an Adjustment Layer and not a Layer
Style.

**Implementation baseline:** `@lighttable/paint-core` now owns the reusable
gradient asset and the coordinate-space/transform-bearing paint instance. The
existing Layer Style gradient editor edits that shared asset through a typed
bridge. Vector, text and fill-layer rendering remain the next consumers; they
must not introduce parallel gradient schemas.

**Priority:** P1 core authoring parity.

### PSD-P2-001 - Smart Object source package

**Evidence:** 57 smart objects across four documents.

**Gap:** Placement descriptors and previews survive, but embedded/linked
payload bytes are skipped. Open Contents, Replace, Relink, Embed and semantic
re-rendering are impossible.

**Required decision:** Define an asset-backed smart container with embedded or
linked source identity, nested-document cache, placed affine/quadrilateral
transform, optional warp, filter stack and fallback preview. Address linked
file security and web portability before exposing editing.

**Priority:** P2.

### PSD-P2-002 - Vector stroke and paint fidelity

**Evidence:** Six vector strokes in three documents plus active Gradient and
Pattern Overlay styles.

**Gap:** Alignment, joins, caps, miter behavior, gradient/pattern paint and
some opacity semantics are incomplete. Large strokes already exposed mesh
seams in dedicated fixtures.

**Required decision:** Use a shared canonical path/stroke model applicable to
PSD, PDF, AI and EPS. Verify tessellation at high zoom and during editing; do
not encode Photoshop-only exceptions into the WebGPU renderer.

**Priority:** P2 after storage and fallback contracts.

### PSD-P1-006 - Layer Style and effects fidelity

**Evidence:** 16 active styled layers: 10 Color Overlay, 4 Drop Shadow,
1 Gradient Overlay and 1 Pattern Overlay.

**Gap:** Canonical styles and GPU evaluation exist, but matching the effect
name and parameters is insufficient. Exact shadow/glow falloff, choke/spread,
contours, bevel lighting, stroke geometry, expansion bounds, effect ordering,
fill-opacity interaction, mask/clipping/group context, high-zoom stability,
pattern assets, gradient variants, merge/flatten and browser shader validation
remain incomplete.

**Required decision:** Treat effects as compositing programs with declared
input alpha/content, bounds expansion, coordinate space and ordering. Verify
each effect alone, then stacked, then under masks/groups/clipping. Cached style
outputs are derived acceleration data and must invalidate from the complete
semantic dependency set.

**Priority:** P1 visual and authoring parity.

### PSD-UI-001 - Layers tree geometry

**Gap:** Row height, thumbnail cell sizing and some group/effect indentation
still feel inconsistent between source layer types. The thumbnail cell is now
square and uses contained aspect ratio, and dormant effects are hidden, but
the complete row geometry needs a single tokenized layout contract.

**Rule:** Fix independently from PSD semantics so visual corpus inspection is
not distorted by changing row sizes. **Priority:** baseline UI.

### PSD-EXPORT-001 - Photoshop write-back

**Status:** PSD release candidate implemented 2026-08-05 for the verified
8-bit RGB subset. The File menu, desktop host save route, web download route
and command/artifact stack all use the same lazy worker writer.

**Verified:** merged composite, ordered groups/raster bounds, opacity/fill,
blend/clipping/locks, raster masks, editable flow text including affine
transforms and imported path-text descriptors, editable vector paths,
no-fill/fill/stroke/gradient state and the mapped Layer Style descriptors.
`TextTest.psd` and `shapes.psd` survive LightTable -> Photoshop -> LightTable;
Photoshop recognizes all fixture text as Text and all fixture vectors as
Solid Fill shape layers. Composite deltas are recorded in
`PSD_EXPORT_RELEASE_CANDIDATE.md`.

**Still gated:** Smart Object source embedding, PSD pattern resources, native
adjustments without an imported Photoshop descriptor, newly authored arbitrary
text-on-path resources, 16-bit write and representative PSB validation. Known
lossy projections stop export instead of silently producing a misleading
editable file.

## Canonical native-format rules

These rules apply equally to PSD, PDF, AI/EPS and native LightTable documents:

1. Document canvas bounds, layer-local bounds, layer transform and visible
   canvas intersection are separate values.
2. Layers may extend beyond or be larger than the canvas. Storage never crops
   them merely because current display/export clips to the document.
3. Semantic source data is authoritative. Cached pixels are versioned,
   fingerprinted, bounded and evictable derived assets.
4. Unsupported layer-local content uses a retained layer preview.
5. Unsupported scope-level behavior uses a retained scope/render-island
   preview; an Adjustment Layer must not masquerade as a bitmap layer.
6. Invalidating a preview requires rebuild, explicit bake or a visible loss
   report. Silent semantic loss is forbidden.
7. Imported Photoshop metadata must be separated from the canonical model and
   retained only where it supports preservation, recovery or export.
8. Native persistence must be web-compatible. Desktop-only font/link discovery
   supplies assets or references; it does not create a second renderer.
9. PSD/AI/PDF adapters map to shared text, path, fill, stroke, mask, transform,
   blend and processing contracts rather than parallel format-specific nodes.

## Verification policy

Every newly implemented feature receives its own task, focused tests and
separate commit. Verification includes:

1. a minimal Photoshop-authored fixture isolating the semantic;
2. source property inventory and compatibility classification;
3. Photoshop composite plus LightTable reconstruction comparison;
4. solo render and dependency-context render where compositing matters;
5. edit, undo/redo and cache invalidation;
6. native save/reopen with identical canonical properties and output;
7. merge/flatten/export behavior where applicable;
8. packaged Electron and web checks;
9. explicit UI exposure using existing LightTable components and styling.

The ten-template corpus is the integration gate, not the place to discover the
formula for one effect. No template-specific rendering branches are accepted.

## Automated Photoshop parity lab

Photoshop can be used as a deterministic reference renderer without an MCP
server. COM/ExtendScript automation can create a document, add one semantic
feature, vary one parameter, export a reference and close the generated
document without saving over user work.

For each adjustment or style:

1. Generate controlled inputs: grayscale and RGB ramps, color patches,
   saturated primaries, alpha edges, noise/detail and HDR-like values where the
   Photoshop document mode permits them.
2. Create exactly one Adjustment Layer or Layer Style in Photoshop.
3. Sweep one parameter across minimum, neutral, representative intermediate
   values and maximum while all other parameters remain fixed.
4. Export the Photoshop result and record the exact descriptor/Action Manager
   values, document mode, bit depth, profile and blend state.
5. Feed the identical source pixels and semantic parameters to LightTable's
   GPU implementation.
6. Compare in a declared common color encoding and record thresholded differing
   pixels, mean RGB error, maximum channel error and a heat map.
7. Fit or correct the transfer function only from isolated fixtures, then test
   two-feature stacks to establish operation order and interaction.
8. Repeat relevant fixtures at 8 and 16 bits and with masks, opacity, fill,
   clipping and non-Normal blend only after the isolated formula passes.

This lab can reveal parameter scaling, curve shape, operation order and most
blend behavior. It cannot justify blindly curve-fitting every unknown internal
Photoshop algorithm: where exact semantics cannot be established, LightTable
must remain explicitly approximate and retain a visual scope preview.

The color/blend branch of this lab is governed by
`PHOTOSHOP_COLOR_AND_BLEND_PARITY.md`. Its first baseline covers 32 blend,
opacity and fill fixtures. The next matrix varies profiles, bit depth and
Photoshop RGB blend preferences independently; those variables may never be
inferred from a single untagged 8-bit reference run.

The lab should initially cover Gradient Map, Photo Filter, Color Balance,
Hue/Saturation and Brightness/Contrast because those eleven adjustment layers
already occur in the corpus. The same harness then covers every Layer Style,
including isolated and stacked effects, followed by gradient interpolation and
mask density/feather.

## Current decision order

1. Complete retained-preview and scope/render-island fallback contracts.
2. Complete missing-font recovery for imported and native documents.
3. Finish imported shape, vector-stroke and gradient/fill-layer authoring.
4. Calibrate remaining adjustments and Layer Style stacks in the existing
   automated Photoshop parity lab.
5. Introduce independent raster/vector mask semantics.
6. Add the Smart Object source package and non-affine transform contract.
7. Extend the PSD release candidate only through explicit capability mapping:
   16-bit write, pattern resources and representative PSB validation.
8. Keep the 48-case color/blend matrix and effects corpus as release gates
   while expanding profile, 32-bit and cross-feature coverage.

This order should be changed only with new corpus or product evidence, and the
reason must be recorded here.
