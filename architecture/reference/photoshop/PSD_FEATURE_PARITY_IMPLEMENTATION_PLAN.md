# LightTable PSD/PSB feature-parity implementation plan

The executable, test-first import order is maintained by the import gates and
checklists in this plan. Those gates take precedence over preview-only import
work: the embedded
Photoshop composite is a reference oracle, never a substitute for the
LightTable document reconstruction.

Status: planning baseline, 28 July 2026.

Technical library and format details live in
`AG_PSD_FEATURE_PARITY_REFERENCE.md`. This document is the product,
architecture and UI checklist. It must stay honest about what LightTable can
open, render, edit, create and write back.

Use `LIGHTTABLE_LAYER_SCOPE_AND_PSD_MAPPING.md` for the exact mapping between
the current Grade/Lens Fx tools and layer-local adjustments, Adjustment Layers,
Smart Objects, Smart Filters, Layer Styles and document output.

## Progress dashboard

This is the canonical PSD/parity progress tracker. Detailed design documents
explain decisions, but checkmarks and the active phase are maintained here.

**Current phase:** semantic PSD import and renderer verification. `ag-psd`
runs lazily in a worker; LightTable now opens PSD files into its canonical
Raster/Group/Adjustment tree and retains Photoshop's embedded composite only
as the in-session Original/reference image. Native LightTable saves contain
the converted canonical layer assets, compatibility report and resolved
patterns, but deliberately do not duplicate the complete source PSD. PSD/PSB
export is not implemented.

**Last implementation update:** 3 August 2026.

Current text/vector exposure: supported PSD text descriptors now prefer native
editable flow text over the supplied layer preview; recovered Photoshop path
text binds that flow to a native cubic vector companion. The Photoshop
composite remains the reference for font-dependent visual comparison.
Supported solid vector shapes follow that same semantic-first rule. Their
element, subpath and anchor identities are scoped per source layer so selection,
editing and GPU caches cannot collide across imported shapes. Selecting an imported
vector layer projects its elements into the existing vector selection model,
and the established Fill, Line and Weight controls now edit that selected style
throughout the vector/shape tool family. Mixed multi-element vector styles still
need a truthful mixed-value presentation before full contextual-properties
parity can be checked off.

LightTable is still pre-0.1. Its own document contract may change freely during
this work: do not add schema migrations, legacy readers or backward-
compatibility branches yet. Preservation of unknown **Photoshop** payloads is a
separate PSD roundtrip requirement and remains in scope.

### Active Layer Style render regression

Browser verification currently blocks Layer Style sign-off: enabling Drop
Shadow previously invalidated the `LightTable Layer Style effect` render pipeline and
black out the document. The later `GetBindGroupLayout(0)` and invalid command
buffer messages are consequences of that same invalid pipeline, not separate
regressions.

Keep the investigation changes auditable and remove experiments that the final
root cause does not require:

| Change | Hypothesis/result | Disposition after root cause |
|---|---|---|
| Disable styled-layer cache and render from the current ping-pong target (`a0afe40`) | Did not remove the invalid-pipeline failure. The true failure was invalid WGSL. | Cache reuse restored after browser Drop Shadow recovery. First-use renders still return the ping-pong work texture and only read the copied cache on a later render. Cache keys cover pixels, enabled masks, geometry, fill, style revision, transform and quality; GPU pixel mutation, history replay, duplicate and document-asset restore also invalidate explicitly. |
| Frame validation error scope (`a0afe40`) | Successfully exposes the first useful WebGPU validation error instead of only the invalid command buffer consequence. | Keep. |
| Fixed 16-direction style blur (`355871d`) | Did not remove the invalid-pipeline failure. It also changes preview cost and quality, so it must not remain merely as a speculative workaround. | Re-evaluate against the exact pipeline rejection and visual fixtures. |
| Shader compilation diagnostics (`355871d`) | The browser diagnostic exposed the actual semantic WGSL error: the Bevel/Emboss branch declared `normal` with `let` and subsequently assigned to it. The non-browser parser did not catch this. | Keep the browser diagnostics and the focused regression assertion. |
| Lazy `createRenderPipelineAsync()` when a document first contains an active style (`591bc98`) | Converted a deferred invalid pipeline object into the actionable shader diagnostic instead of poisoning ordinary startup. An initial attempt awaited this during general engine startup and made ordinary image opening hang on at least one backend; that startup coupling was removed immediately. | Keep the lazy feature boundary. |
| Split immutable Bevel/Emboss normal construction into `rawNormal` and `normal` (`44d248c`) | Removes the semantic WGSL error that invalidated the complete shared Layer Style pipeline, including Drop Shadow. | Drop Shadow and ordinary image opening recovered in browser; the remaining effects and merge/flatten matrix still require verification. |

Do not mark the Layer Style renderer or its effects verified until Drop Shadow,
all other implemented effects, merge/flatten and native-document reload pass
the browser matrix without a validation error.

### Status legend

Every feature is tracked across four independent delivery states:

| State | Meaning |
|---|---|
| **Specified** | Product behavior, engine semantics and required UI are documented. |
| **Implemented** | Runtime/model/persistence code exists and is connected to the editor. |
| **UI** | The complete user-facing workflow exists. |
| **Verified** | Automated tests and required browser/Photoshop fixtures pass. |

A specification or typed inventory is foundation work, not a working editor
feature. Do not describe per-layer grades, Adjustment Layers, Smart Objects or
Smart Filters as implemented until their **Implemented** state is checked.

### Foundation status

| Foundation item | Specified | Implemented | UI | Verified |
|---|---:|---:|---:|---:|
| Technical `ag-psd` feature/parity reference | [x] | n/a | n/a | [ ] Source/fixture recheck before implementation |
| Product, engine, UI and verification parity matrix | [x] | [x] Semantic import path connected | Partial: normal Layers/Grade UI | [ ] Photoshop fixtures |
| Grade/Lens Fx scope mapping | [x] | [ ] | [ ] | [ ] |
| Current `BasicAdjustments` module/domain/scope inventory | [x] | [x] Metadata contract only | n/a | [x] Unit tested |
| Reusable processing-module evaluator | [x] | [x] Legacy materializer/runtime bridge | n/a | [x] Unit tested |
| Serializable adjustment stacks | [x] | [x] Current global stack + layered persistence | [ ] | [x] Unit/roundtrip tested |
| Common raster-layer metadata contract | [x] | [x] Fill, clipping and structured locks in model/persistence; Fill participates in raster compositing | Partial: Opacity, Fill and four raster lock controls | [x] Unit/roundtrip tested |
| Typed nested layer-node contract | [x] | [x] Canonical document, renderer projection and persistence use Raster, Group and Adjustment nodes | [x] Recursive rows, disclosure, New Group and drag into/out | [x] Unit/roundtrip tested; nested drag manually verified |
| Per-layer grades | [x] | [ ] Recursive evaluator remains | [ ] | [ ] |
| Adjustment Layers | [x] | Partial: multiple stack-ordered Grade nodes with independent GPU state, opacity, blend mode, clipping and bitmap-mask evaluation | [x] Create/select/edit/visibility/delete/reorder/group/mask | [x] Unit/WGSL/native multi-node roundtrip tests and browser smoke test |
| Smart Objects and Smart Filters | [x] | [ ] | [ ] | [ ] |

Active work:

- [x] Extract the current document-wide grade through the module registry
      without changing its visual output.
- [x] Introduce serializable adjustment stacks with stable module IDs.
- [x] Extend the flat raster document into the typed canonical layer tree.
- [x] Make root raster-layer reordering a document command with Layers-panel
      drag/drop, explicit insertion feedback and one undo entry per drop.
- [x] Add nested pass-through Groups with recursive visibility, persistence,
      disclosure and drag into/out of groups.
- [x] Add normalized multi-selection commands for block move, group, ungroup,
      visibility, locks and delete. Each completed action creates one undo
      entry.
- [x] Add explicit raster-only Flatten Group and Flatten Image commands. Both
      use the GPU compositor, preserve undo pixels and refuse trees containing
      semantic Adjustment nodes instead of silently discarding them.
- [x] Connect the first editable top-level `Document Grade` Adjustment Layer.
      Its creative Grade modules render, persist and participate in undo/redo;
      document Lens Fx/output processing remains document-scoped.
- [x] Evaluate Grade Adjustment Layers at their ordered stack positions and
      apply each node's opacity and editable bitmap mask to the lower
      composite. Every node owns independent uniforms and a curve LUT,
      preventing cross-layer queue-write leakage while large sequential work
      textures remain shared. Masks and stacks persist in native layered
      documents and participate in undo/redo.
- [x] Expose an approximate LightTable-owned GPU texture footprint in the
      document status bar. WebGPU does not expose actual driver VRAM, so this
      is explicitly labelled `GPU ~` and includes document/layer textures,
      active effect targets and per-Adjustment runtime state.
- [ ] Add revision-based evaluator caches and a shared transient-texture pool.
      Keep one valid cached output per expensive node where useful; reuse
      ping-pong intermediates across Grain, Halation and future spatial
      effects instead of keeping every pass target resident.
- [ ] Add explicit Stamp/Rasterize commands as user-visible destructive
      operations. Never silently stamp an editable Grade, Smart Filter or
      Effect merely to meet a memory budget.
- [x] Add recursive isolated-group compositing with group opacity, blend and
      bitmap mask; pass-through groups without an envelope continue directly
      in the parent stack so their adjustments can affect lower content.
- [x] Complete clipping stacks for raster, group and Adjustment nodes,
      including transparent handling for malformed chains.
- [x] Apply Layer Styles to isolated group composites through the shared style
      pipeline. Photoshop fixture verification remains open.

UI/UX impact so far: the Layers panel now exposes New Group, recursive rows,
disclosure controls and nested drag/drop. Groups are deliberately restricted
to pass-through/100% behavior until isolated compositing, group opacity and
group masks are rendered exactly; unsupported controls are not exposed.

## 1. What “supported” means

Do not mark a Photoshop feature as supported merely because `ag-psd` parses
it. Track these capabilities separately:

| Capability | Meaning |
|---|---|
| Detect | Import identifies the feature and its relevant parameters. |
| Preserve | Original semantics/payload survive an untouched save where the codec allows it. |
| Display | LightTable produces a useful visual result, possibly from Photoshop's raster fallback. |
| Render | The LightTable renderer recreates the feature from semantic data. |
| Edit | The UI can inspect and change the feature without flattening it. |
| Create | The UI can create a new instance of the feature. |
| Export | LightTable writes editable Photoshop semantics, not only a flattened preview. |
| Verified | Golden fixtures and Photoshop reopen tests pass. |

Every imported layer also gets an explicit support state:

- **Native** — semantic model, LightTable renderer and editing UI are present.
- **Preserved** — the original payload is retained, but editing is restricted.
- **Preview-backed** — Photoshop's raster preview is shown while semantic
  rendering is unavailable.
- **Flatten-required** — export requires an explicit user choice to rasterize.
- **Lossy/unsupported** — safe roundtrip cannot be promised and is reported.

No unsupported feature may disappear silently.

## 2. Current LightTable baseline

| Area | Current state | PSD consequence |
|---|---|---|
| Working pipeline | Linear sRGB, premultiplied alpha, `rgba16float` | Good internal precision and compositor foundation. |
| Document structure | Typed nested Raster/Group/Adjustment tree; recursive compositor evaluates pass-through and isolated groups with group opacity/blend/mask, Layer Styles and clipping stacks | Photoshop fixture verification remains. |
| Layer geometry | Bounds, affine transform and revisions | Good basis for PSD layer bounds and offsets. |
| Masks | One simple bitmap mask per raster or Grade Adjustment Layer | Must support group masks, richer bitmap/real/vector masks and mask properties. |
| Blending | Twenty-six blend modes, opacity, fill opacity, clipping and pass-through/isolated groups | Needs Dissolve, specialist Photoshop modes, Blend If and golden fixtures. |
| Grade | Reusable modules plus multiple editable stack-ordered Grade Adjustment Layers | Priority PSD descriptors map into ordered, masked, clipped and blended native nodes; exact Photoshop calibration and per-raster stacks remain. |
| Persistence | Custom v1 container with per-layer 8-bit PNG assets | Must become typed and precision-aware; PSD remains a separate codec. |
| Professional import | Lazy wasm-vips u8/u16 path | PSD gets its own lazy worker and converges on the same pixel-resource contract. |
| Layer UI | Raster list, drag reorder, structured locks and basic mask controls | Must become a nested semantic layer panel and contextual properties UI. |

## 3. Canonical model work required before PSD

PSD must adapt to LightTable, not become LightTable's internal model.
PSD parity is a compatibility target, not a product ceiling. Native LightTable
features that are richer than Photoshop remain editable and visible to users.
Export maps them to native PSD semantics where verified, otherwise to an
explicit fallback; it never removes them from LightTable merely to fit PSD.

### Document

- [x] Typed nested layer tree rather than `RasterLayer[]`. Canonical node types,
      immutable tree operations, document runtime, persistence and recursive
      Layers UI all use the same tree.
- [ ] Complete asset registry for pixels, masks, embedded files, linked files,
      fonts, patterns, previews and other binary payloads. Pattern resources
      and preserved whole-source Photoshop documents are registered now;
      remaining asset types and full-precision pixel resources are open.
- [ ] Working color space, source color mode, source bit depth and internal
      precision as explicit document metadata.
- [ ] Complete Photoshop namespace for PSD/PSB IDs, resources and preservation
      data. Original source bytes and imported layer descriptors are preserved;
      per-block identity and dirty/replaced state remain open.
- [x] Unsupported-feature/import compatibility report stored with the document.
- [ ] Composite preview and thumbnail caches with revisions.
- [ ] Technical output settings separated from creative adjustments.

### Common layer contract

- [ ] Stable LightTable ID plus optional original Photoshop layer ID.
- [ ] Bounds and transform. Raster bounds and affine transforms exist;
      semantic bounds/transforms for every future layer kind remain.
- [x] Opacity and separate fill opacity. With no Layer Styles attached, raster
      content correctly composites at `Opacity × Fill`; both controls are
      exposed separately. Effect-versus-content separation remains part of
      Layer Styles.
- [ ] Blend mode. The model/UI and current raster compositor support the
      existing mode set; Adjustment Layers, isolated groups and Photoshop
      parity fixtures remain.
- [x] Clipping state in model, persistence and recursive compositor. Dedicated
      Layers-panel indentation/connector UI and golden fixtures remain.
- [ ] Structured locks instead of one boolean. Model/persistence, four lock
      controls and pixel/position/all enforcement exist; transparency-lock
      painting semantics remain.
- [ ] Multiple masks with their own bounds and transforms.
- [ ] Layer effects.
- [ ] Blend If / blending ranges.
- [ ] Linked-layer identity.
- [ ] Color label and other visible layer metadata.
- [ ] Source payload and raster fallback preview.
- [ ] Fine-grained source, geometry, mask, effect and adjustment revisions.

### Required layer kinds

- [x] Pixel/image layer in the native LightTable model, renderer and
      persistence. PSD pixel-resource adaptation remains Phase B.
- [ ] Paint layer. Current paint layers reuse the raster-layer kind; a distinct
      semantic kind is still required only if paint-specific source behavior
      needs to survive PSD/native roundtrip.
- [x] Group node, nesting, pass-through child order/visibility, persistence and
      Layers UI. Exact isolated compositing, group opacity, masks and locks
      remain separate renderer work.
- [ ] Adjustment layer. Typed model, persistence and multiple stack-ordered
      Grade evaluators/UI exist, including independent GPU state, opacity and
      editable persisted bitmap masks. Isolated-group scope, clipping and blend
      semantics remain.
- [ ] Text layer.
- [ ] Vector/shape layer.
- [ ] Smart Object.
- [ ] Native LightTable 3D layer.
- [ ] Video/special layer.
- [ ] Unsupported-preserved layer.

Complex layers retain three representations where available:

1. editable LightTable semantic state;
2. original Photoshop payload;
3. raster fallback/cached preview.

## 4. Feature and UI parity matrix

The target columns below describe the intended product level, not current
`ag-psd` parser support.

### 4.1 File, document and import UX

| Feature | First useful target | Editing/creation UI still required |
|---|---|---|
| PSD and PSB open | Safe worker parse, immediate embedded composite, then progressive layers | File filter, import progress, cancel and clear error states. |
| Import preflight | Detect color mode, bit depth, dimensions, layer count and risky features | Preflight dialog only when action or warning is required. |
| Feature-loss report | Persistent per-document list with layer links | Report panel/dialog with Native, Preserved, Preview and Lossy filters. |
| 8-bit RGB | Native pixels and semantic layer tree | No special UI beyond document info. |
| 16-bit RGB | Preserve precision through typed resources and `rgba16float` | Bit-depth badge and explicit export warnings. |
| 32-bit/HDR | Preview/preserve first; native later | HDR status and output controls when supported. |
| CMYK/Lab/etc. | Never misinterpret as RGB; preview or reject with explanation | Color-mode warning and explicit conversion/import choice. |
| Composite preview | Show immediately and use as parity ground truth | Original/LightTable-render comparison control. |
| Guides/resolution/metadata | Preserve first, expose useful subsets later | Document Properties; optional rulers/guides UI. |
| Save as PSD/PSB | Capability audit before writing | Save dialog with keep editable, rasterize copy or cancel. |

### 4.2 Layers and compositing

| Feature | Required render/model behavior | Required layer-panel/properties UI |
|---|---|---|
| Raster layer | Exact pixels, bounds, alpha and transform | Existing row and root drag reorder; source/bounds information remains. |
| Nested groups | Recursive tree and stable reorder semantics | Disclosure arrows, drag into/out of groups, New Group. |
| Isolated group | Offscreen group composite | Group properties. |
| Pass-through group | Children participate in parent composite correctly | Pass Through blend choice and clear badge/state. |
| Visibility | Match group and child visibility | Existing eye control. |
| Opacity | Layer/group result opacity | Existing opacity control. |
| Fill opacity | Affect content/effects according to Photoshop semantics | Separate Fill control near Opacity. |
| Locks | Transparency, pixels, position and full lock where available | Individual lock controls and row badges. |
| Clipping stack | Correct alpha and isolated-target semantics | Clip toggle, indentation/connector and shortcut/menu command. |
| Linked layers | Preserve relationship and support coordinated operations later | Link/unlink command and link badge. |
| Blend modes | Photoshop-compatible formulas plus correct alpha/group behavior | Categorized searchable blend-mode picker. |
| Blend If | Per-channel source/underlying ranges with split handles | Blending Options dialog/panel and live preview. |
| Artboards | Preserve first, native document regions later | Artboard rows/tool only after model and renderer exist. |
| Layer comps | Preserve and apply visibility/position/style snapshots | Layer Comps panel later. |

### 4.3 Masks and channels

| Feature | Required behavior | Required UI |
|---|---|---|
| Bitmap layer mask | Own bounds/offset, enable state and exact alpha | Mask thumbnail, active-channel border, enable/delete/invert. |
| Real/user mask | Preserve distinct Photoshop semantics where relevant | Correct mask type indicator; merge only by explicit command. |
| Density | Non-destructive mask strength | Density slider in mask properties. |
| Feather | Non-destructive mask edge processing | Feather slider in mask properties. |
| Vector mask | Bézier paths, fill rules and boolean operations | Path/vector-mask thumbnail, path editing tools and properties. |
| Multiple masks | Deterministic combination order | Multiple thumbnails or an expandable mask stack. |
| Channels/alpha channels | Preserve and render channel data | Channels panel after the channel model exists. |

### 4.4 Adjustment layers and color

All PSD adjustment types use the same adjustment-module registry and evaluator
as native LightTable adjustments. Do not implement a PSD-only shader path.

| Adjustment | Target | UI work |
|---|---|---|
| Brightness/Contrast | Native | Reusable module panel. |
| Levels | Native | Histogram, input/output levels and channel selector. |
| Curves | Native | Reuse/extend curve editor with RGB/channel semantics. |
| Exposure | Native | Exposure, offset and gamma fields as defined by PSD. |
| Vibrance | Native | Reusable module panel. |
| Hue/Saturation | Native | Global and color-range controls; map carefully to PSD semantics. |
| Color Balance | Native | Tone-range controls; may reuse color-grading primitives, not silently reinterpret parameters. |
| Black & White | Native | Color contribution sliders and tint. |
| Photo Filter | Native | Filter color, density and preserve-luminosity. |
| Channel Mixer | Native | Output-channel matrix controls. |
| Color Lookup/LUT | Native when referenced LUT is available | LUT asset picker, missing-asset state and reload. |
| Invert | Native | Menu/quick-add; normally no properties. |
| Posterize | Native | Levels control. |
| Threshold | Native | Threshold control and histogram. |
| Gradient Map | Native | Gradient editor and interpolation controls. |
| Selective Color | Native | Color range, component controls and method. |
| Unknown adjustment | Preserve and preview | Read-only properties plus unsupported badge. |

Adjustment-layer UI also requires:

- [x] Add Adjustment Layer menu for Grade nodes; additional nodes start neutral
      instead of duplicating the selected Grade.
- [x] Adjustment icon and thumbnail in the Layers panel.
- [ ] Mask, visibility, opacity, blend and clipping controls. Mask,
      visibility and opacity are connected; Adjustment-layer blend and
      clipping semantics remain.
- [ ] Clear indication whether Grade edits the active layer, an Adjustment
      Layer or technical document output. Selecting the Grade node edits that
      node; per-raster-layer Grade and a separate output-properties surface
      remain.
- [ ] Module enable, reorder and reset with undo/redo.

### 4.5 Text

| Capability | Initial support | Full native UI |
|---|---|---|
| Display imported text | Photoshop raster preview until native output matches | Missing-font and preview-backed indicators. |
| Point and box text | Preserve semantic text, transform and bounds | Type tool, editable text box and transform handles. |
| Fonts | Resolve installed/project fonts without silent substitution | Font picker, missing-font dialog and replacement workflow. |
| Character styles | Preserve runs first | Font, size, weight, tracking, leading, baseline, color and decorations. |
| Paragraph styles | Preserve first | Alignment, indents, spacing, direction and composer-relevant controls. |
| Warp/path text | Preview/preserve first | Warp controls and path editing later. |
| New text layers | After native text renderer is stable | Type tool and New Text Layer command. |

Editing text invalidates its Photoshop raster preview. LightTable must generate
an updated layer preview before export or explicitly require rasterization.

### 4.6 Vector shapes

| Capability | Initial support | Full native UI |
|---|---|---|
| Vector mask/path | Preserve plus raster fallback | Path selection, node/handle editing and path operations. |
| Solid fill | Native early | Fill picker and opacity. |
| Gradient fill | Native after gradient model | Gradient editor, type, angle, scale and transform. |
| Pattern fill | Preserve/preview until pattern registry exists | Pattern browser and missing-pattern state. |
| Stroke | Native after vector stroke renderer | Width, alignment, joins, caps, dash and color/gradient. |
| Boolean operations | Render and preserve before editing | Combine, subtract, intersect and exclude controls. |
| New shape layer | Later | Shape tools and properties panel. |

### 4.7 Layer effects

| Effect | Target | UI work |
|---|---|---|
| Drop/inner shadow | Native | Multiple instances, blend, color, opacity, angle, distance, spread and size. |
| Outer/inner glow | Native | Gradient/color, technique, range, jitter and contour where supported. |
| Bevel & Emboss | Native later | Style, depth, direction, size, soften, lighting and contour. |
| Color overlay | Native | Blend, color and opacity. |
| Gradient overlay | Native | Gradient, style, angle, scale and alignment. |
| Pattern overlay | Preserve/preview first | Pattern registry and picker. |
| Satin | Native later | Blend, color, angle, distance, size and contour. |
| Stroke | Native | Position, size, fill type and blending. |

Layer-panel requirements:

- [ ] `fx` badge and expandable effect children.
- [ ] Visibility per effect.
- [ ] Add, duplicate, reorder and delete effect.
- [ ] Blending Options / Layer Style dialog or dockable properties panel.
- [ ] Multiple instances of effects that Photoshop permits.

These are different from LightTable's document-level Lens Fx. Do not map them
to halation, grain or lens distortion merely because both are called effects.

### 4.8 Smart Objects and Smart Filters

| Capability | First target | Later native UI |
|---|---|---|
| Embedded Smart Object | Preserve bytes, transform and Photoshop preview | Open Contents as nested LightTable document. |
| Linked Smart Object | Preserve reference and preview | Relink, locate, update and embed commands. |
| Transform/warp | Reproduce placed transform; preserve unsupported warp | Transform and warp UI. |
| Replace contents | Preserve outer transforms/effects | Replace Contents command. |
| Smart Filters | Preserve and preview first | Typed editable filters backed by the adjustment/effect node registry. |
| Filter masks | Preserve and render | Filter-mask thumbnail and editing channel. |

Smart Objects require an asset dependency graph, cycle detection, lazy loading
and cache invalidation. They are not the same layer kind as native LightTable
3D layers.

### 4.9 Photoshop document features

| Feature | Policy |
|---|---|
| Layer comps | Preserve first; native panel and apply support later. |
| Artboards | Preserve first; native regions/workspace later. |
| Timeline/frame animation | Preserve and preview where possible; editor later. |
| Video layers | Preserve payload/reference; integrate with native video layers only after semantics are defined. |
| Patterns | Central asset registry before editable pattern fills/effects. |
| Guides/grids | Preserve early; visible editing after document coordinate UI exists. |
| Paths | Preserve early; Paths panel when vector tooling exists. |
| Slices/annotations/print metadata | Preserve/report; UI only when product value justifies it. |

## 5. Required PSD-specific UI surfaces

### Open/import

- PSD and PSB in the file picker.
- Fast composite preview while semantic import continues.
- Import status by phase, not a frozen editor.
- Cancel that terminates the worker and releases transferred buffers.
- Unsupported color-mode and safety-limit errors with actionable explanations.

### Document status

- Source format, color mode, bit depth and profile.
- Native/preserved/preview/lossy feature counts.
- Visible indicator when the current canvas contains preview-backed layers.
- One command to open the full compatibility report.

### Layers panel

- Nested groups and artboards.
- Different icons for pixel, paint, group, adjustment, text, vector,
  Smart Object and preserved layers.
- Pixel, mask and vector-mask thumbnails.
- Clipping, link, lock, effect, missing-asset and fallback badges.
- Opacity and Fill.
- Contextual add-layer menu for types LightTable can actually create.
- Unsupported layers remain selectable and movable even if their semantics are
  read-only.

### Contextual properties

The properties panel follows the selected semantic object:

- layer/group compositing;
- adjustment parameters;
- text;
- vector fill/stroke/path;
- mask density/feather;
- effects;
- Smart Object/link information;
- unsupported Photoshop payload summary.

Do not expose controls that merely mutate a temporary preview while pretending
to edit the original semantics.

### Save/export

Before PSD/PSB export, show a capability audit grouped into:

- safely editable and exportable;
- preserved unchanged;
- will be rasterized;
- will be lost or cannot be represented;
- precision/color-mode conversion.

Offer only explicit choices:

1. save an editable PSD within the supported subset;
2. save a rasterized PSD copy;
3. keep the richer LightTable document;
4. cancel and resolve issues.

## 6. Implementation milestones

### Complete parity workstreams

This is the implementation ledger. The shorter phases below order these
workstreams; they do not replace this list. Every semantic feature must pass
through the canonical model, renderer, UI, native persistence, PSD adapter,
write-back policy and fixtures.

#### A. Raster, layers and compositing

- [x] Nested typed Raster, Group and Adjustment nodes.
- [x] Layer ordering, nested drag/drop, multi-select and document undo/redo.
- [x] Visibility, layer opacity and fill opacity for raster compositing.
- [x] Initial structured locks in model/UI.
- [ ] Exact layer bounds/offsets independent from document dimensions.
- [ ] Isolated and pass-through groups with exact Photoshop behavior.
- [x] Nested group opacity, masks, blend modes and pass-through/isolated
      compositing. Group fill-specific Photoshop fixtures remain.
- [x] Clipping stacks, including clipped Adjustment Layers and clipped groups.
- [x] Standard Photoshop blend modes through Divide, including the contrast
      and component families, share one compositor implementation across
      raster/group/Adjustment/Style paths.
- [ ] Dissolve, specialist height modes and advanced blending flags.
- [ ] `Blend If` ranges, split handles and channel selection.
- [ ] Transparency-lock painting semantics and complete lock enforcement.
- [ ] Linked-layer identity and synchronized-content behavior.
- [ ] Visual golden fixtures for every blend/group/clipping combination.

#### B. Masks, selections, channels and paths

- [x] Editable bitmap masks on raster and native Grade Adjustment Layers.
- [x] Basic selection creation, combine, feather, invert and transform.
- [x] Bitmap/real-mask bounds, default color, density and feather imported into
      the canonical mask contract. Photoshop golden-fixture calibration remains.
- [ ] Linked/unlinked mask transforms and independent mask selection.
- [ ] Group masks and Smart Filter masks.
- [ ] Vector-mask path model, boolean path operations and feather/density.
- [ ] Alpha/channel asset model with Channels panel.
- [ ] Spot channels and channel visibility/composite preview policy.
- [ ] Work paths, saved paths and clipping paths.
- [ ] PSD mask/channel/path import, preservation, editing and write-back
      fixtures.

#### C. Native Grade and Photoshop Adjustment Layers

- [x] Serializable module registry with domain and allowed-scope metadata.
- [x] Multiple ordered native Grade Adjustment Layers.
- [x] Independent uniforms, curve LUT, opacity and bitmap mask evaluation per
      Grade Layer.
- [x] Native layered persistence and browser smoke test for multiple grades.
- [ ] Typed quick-add layers instead of only `Full LightTable Grade`:
      Exposure, Curves, Temperature/Tint, Color Mixer, Color Grading,
      Hue/Saturation and other focused modules.
- [ ] Per-raster and isolated-group adjustment stacks.
- [x] Adjustment Layer blend modes, clipping and recursive group scope.
      Photoshop golden fixtures remain before parity sign-off.
- [ ] Photoshop-native parameter/evaluator variants where LightTable formulas
      are not mathematically equivalent.
- [ ] Priority PSD mappings: Brightness/Contrast, Levels, Curves, Exposure,
      Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter,
      Channel Mixer, Selective Color, Gradient Map and Color Lookup/LUT.
- [ ] Preserve/edit/write threshold, posterize and unsupported adjustment
      descriptors without silent approximation.
- [ ] Contextual Adjustment properties UI plus support/parity indication.
- [ ] Golden render fixtures and Photoshop reopen fixtures per adjustment.

#### D. Photoshop Layer Styles (`fx`)

Layer Styles operate during compositing from layer content/alpha. They are not
LightTable Lens Fx and not ordinary Adjustment Layers.

The checked effect rows below mean that the editable model, UI and executable
render path exist. They do **not** claim Photoshop visual parity. Current shared
sampling/blur is a functional baseline; visual sign-off requires effect-specific
golden fixtures and algorithms instead of tuning one generic blur for every
style.

The executable twenty-slice implementation and verification ledger lives in
[`LAYER_STYLES_IMPLEMENTATION_TRACKER.md`](../implementation/LAYER_STYLES_IMPLEMENTATION_TRACKER.md).
The supplied Photoshop dialog captures in `styles/` are the
functional inventory; LightTable uses one modern editor and previews on the
actual document canvas rather than a detached preview tile.

- [x] Typed ordered `LayerStyleStack` with visibility, scale and stable IDs.
- [x] Shared style fields: blend mode, opacity, color/gradient/pattern,
      contour, noise, range, jitter and anti-aliasing where applicable.
- [x] Document/global-light model with local-light override.
- [x] Drop Shadow, including multiple instances.
- [x] Inner Shadow, including multiple instances.
- [x] Outer Glow and Inner Glow.
- [x] Bevel & Emboss, contour and the supported texture subset.
- [x] Satin.
- [x] Color Overlay.
- [x] Gradient Overlay.
- [x] Pattern Overlay and pattern asset resolution.
- [x] Stroke with inside/center/outside placement and color/gradient/pattern
      fills.
- [ ] Correct ordering between interior effects, layer fill, masks, clipping,
      group compositing and knockout/advanced blending.
- [x] `fx` badge and disclosure below the layer row.
- [x] Layer Style dialog/panel with live preview, copy/paste/clear and
      global-scale controls.
- [x] Import multiple same-kind effects without collapsing them.
- [ ] Preserve unsupported style descriptors and provide raster fallback.
- [ ] Layer Style create/edit/export and Photoshop visual-golden fixtures.
- [ ] Drop/Inner Shadow quality pass: subpixel offset, spread/morphology,
      separable softening, contour/noise and premultiplied-linear blend parity.
- [ ] Inner/Outer Glow quality pass with distinct edge-distance and source
      techniques rather than the shared shadow approximation.
- [ ] Stroke quality pass using stable signed-distance/dilation coverage at
      inside, center and outside positions.
- [ ] Bevel/Emboss quality pass using a stable height/normal field, contour,
      texture and highlight/shadow lighting fixtures.
- [ ] Satin and Overlay quality pass with Photoshop comparison fixtures,
      especially transparency, fill opacity and blend interactions.

#### E. LightTable Lens Fx and native effect nodes

These remain first-class LightTable features. PSD import/export maps them to a
verified Smart Filter when equivalent, otherwise preserves native settings and
uses an explicit preview/raster fallback.

- [x] Native Grain, Halation, Chromatic Aberration, Lens Distortion and Lens
      Blur implementations.
- [x] Lens Fx panel separated from Grade.
- [x] Scope/domain inventory prevents Grain and source-geometry effects from
      silently becoming generic Adjustment Layers.
- [x] Lazy allocations for inactive Grain, Halation, Chromatic Aberration and
      Lens Distortion; Lens Blur large render targets are released while
      inactive.
- [x] Approximate LightTable-owned GPU texture usage in the status bar.
- [ ] Typed effect-node stack with stable IDs, visibility, opacity/blend,
      masks, revision and declared coordinate space.
- [ ] Layer-local, isolated-group, Smart Object/Smart Filter and document
      effect scopes where valid.
- [ ] Grain: one revision-cached output plus shared transient noise/blur
      targets instead of three permanently resident full-resolution targets.
- [ ] Halation: revision cache and shared reduced-resolution transient targets.
- [ ] Chromatic Aberration and Lens Distortion: cache/invalidations tied to
      source geometry and transform revisions.
- [ ] Lens Blur: depth asset in the asset registry, filter mask, cached depth
      refinement, focus metadata and deterministic reopen.
- [ ] Shared transient texture pool with graph-consumer lifetime accounting.
- [ ] VRAM budget/eviction policy that drops recomputable caches before source
      pixels, masks or undo data.
- [ ] Explicit Stamp/Rasterize Effect commands with one undo entry; never
      silently destroy semantics as an optimization.
- [ ] Copy/paste/duplicate effect stacks and useful presets.
- [ ] PSD export capability policy per effect:
      verified Smart Filter, preserved LightTable-native payload plus preview,
      explicit rasterize, or unsupported.

#### F. Smart Objects and Smart Filters

- [ ] Typed embedded/linked Smart Object layer with source asset, placed
      transform, warp/perspective data and fallback preview.
- [ ] Asset dependency graph, cycle detection and revision invalidation.
- [ ] Open/Edit Contents as a separate document tab/session.
- [ ] Replace Contents, Relink, Embed, Update and missing-link UX.
- [ ] Convert Layer/Group to Smart Object and explicit Rasterize.
- [ ] Ordered Smart Filter stack with visibility, mask and per-filter
      blend/opacity.
- [ ] Generic preserved-filter descriptor so unknown filters survive when the
      codec permits.
- [ ] First native filters: Gaussian/Motion blur, sharpen/unsharp, noise,
      common distort/pixelate and verified equivalents of LightTable Lens Fx.
- [ ] Preserve deformation/warp and unsupported filters with Photoshop
      preview-backed output.
- [ ] Smart Object and Smart Filter layer-row disclosure/properties UI.
- [ ] Embedded, linked, missing-link and nested-document fixture coverage.

#### G. Text, vector, fills and patterns

- [ ] Semantic point-text and paragraph/box-text layer model.
- [ ] Text transforms, bounds, orientation and anti-aliasing mode.
- [ ] Font resolution, missing-font state and explicit substitution workflow.
- [ ] Character and paragraph style runs.
- [ ] Warp/path-text preservation, then native editing.
- [ ] Type tool and contextual text properties UI.
- [ ] Vector path/shape model with fill, stroke and boolean operations.
- [ ] Solid, gradient and pattern fill layers.
- [ ] Pattern registry with IDs, transforms and preserved Photoshop pattern
      resources.
- [ ] Shape/path tools and contextual properties UI.
- [ ] Preview-backed fallback whenever native text/vector rendering is not
      visually equivalent.
- [ ] Text/vector structural and visual roundtrip fixtures.

#### H. Color, precision and image resources

- [x] Fast browser path for ordinary 8-bit web images.
- [x] Lazy wasm-vips path for supported precision-preserving imports.
- [x] Linear `rgba16float` working textures.
- [ ] Precision-aware pixel assets and native layered save; current layered
      raster assets remain 8-bit PNG.
- [ ] 16-bit RGB PSD pixels from worker through asset registry and compositor
      without silent 8-bit conversion.
- [ ] 32-bit/HDR preview/preserve path and explicit editing/export limits.
- [ ] Embedded ICC/profile preservation and controlled conversion.
- [ ] CMYK, Lab, Indexed, Bitmap, Duotone and Multichannel preflight policy:
      native, convert, preview/preserve or reject—never reinterpret as RGB.
- [ ] Resolution, pixel aspect ratio and physical dimensions.
- [ ] Thumbnails, composite preview and cache revisions.
- [ ] Guides, grid, slices, annotations, count data and print metadata
      preservation policies.

#### I. Artboards, layer comps, animation and document features

- [ ] Artboard document/layer model, bounds, background and export metadata.
- [ ] Layer Comps for visibility, position and appearance states.
- [ ] Frame-animation and timeline preservation; editing only after a clear
      LightTable timeline mapping exists.
- [ ] Audio/video metadata preservation policy.
- [ ] Document Properties and feature-support report UI.
- [ ] Preserve unknown additional-info and image-resource blocks where
      possible, with explicit loss reporting where `ag-psd` cannot roundtrip.

#### J. PSD/PSB codec, export and verification

- [x] Lazy worker-only `ag-psd` comparison import with dimension, pixel,
      decoded-memory, layer-count and nesting limits plus cancellation by
      worker termination. Progressive progress reporting is still pending.
- [x] Immutable worker DTO and one-way adapter into the canonical document.
- [x] Fast embedded Photoshop composite import for exact A/B source comparison
      alongside semantic raster, mask, pattern, group and Adjustment assets.
- [x] Per-feature `Native`, `Approximate`, `Preserved`, `Preview-backed` or
      `Placeholder/Missing` classification, persisted with the document and
      exposed through a filterable report dialog.
- [ ] Original Photoshop payload/source retention and dirty-state tracking.
      Exact whole-file source retention is implemented; fine-grained block
      identity and dirty/replaced state remain.
- [ ] PSD and PSB writer adapter built from canonical state, never editor
      mutation of an `ag-psd` object.
- [ ] Capability audit before save with keep-editable/rasterize/cancel choices.
- [ ] Rebuild changed layer previews, document composite and thumbnail.
- [ ] Immediate re-read and structural/pixel validation after writing.
- [ ] Photoshop open -> resave -> LightTable reimport fixture suite.
- [ ] Performance gates for large documents and proof that PSD support does
      not slow ordinary image startup.

### Phase 0 — converge the canonical document model

- [x] Reconcile this plan with
      `archive/LIGHTTABLE_PER_LAYER_ADJUSTMENTS_AND_FUTURE_NODE_GRAPH.md`.
- [x] Inventory current Grade/Lens Fx parameters with explicit domains and
      allowed processing scopes.
- [x] Introduce typed Raster, Group and Adjustment nodes with nested groups.
- [ ] Complete the shared asset registry for pixels, masks, embedded/linked
      files, fonts, patterns, previews and preserved Photoshop payloads.
      Embedded patterns are implemented. Whole-source PSD blobs are
      intentionally not stored in native LightTable documents; unknown
      Photoshop payload preservation belongs to a future PSD write-back path.
- [ ] Complete common layer semantics. Fill opacity and structured locks are
      connected; clipping and preservation metadata remain incomplete.
- [x] Keep an explicit version field in the current alpha LightTable document
      container. No migration/backward-compatibility layer is required before
      0.1.
- [ ] Lock current raster rendering with visual golden fixtures. Unit,
      persistence and browser smoke coverage exist, but parity fixtures do
      not yet.

Exit: the model can losslessly represent every P0 PSD concept before a parser
is connected.

### Phase 0.5 — `ag-psd` import-readiness gate

This is the ordered todo between the current editor and the point where adding
the library produces a useful PSD importer instead of leaking `ag-psd`'s
mutable object graph into LightTable.

#### Canonical model and renderer

- [x] Typed nested Raster, Group and Adjustment layer tree.
- [x] Stable IDs, ordering, multi-selection, drag/drop and undoable document
      commands.
- [x] Multiple ordered native Grade Adjustment Layers with independent state,
      opacity and bitmap masks.
- [x] Isolated versus pass-through group compositor architecture, including
      nested group opacity and bitmap masks. Photoshop fixtures still gate
      visual-parity sign-off.
- [x] Clipping stacks for raster, group and Adjustment Layers.
- [ ] Complete the P0 blend-mode audit with Photoshop-generated golden
      fixtures.
- [ ] Finish mask semantics required by PSD. Density/feather, enabled state,
      group masks and rasterized real/vector-mask results are imported and
      rendered; linked transforms and editable vector paths remain.

#### Assets, precision and preservation

- [ ] Complete the shared asset/pixel-resource registry for raster content,
      masks, composite previews, thumbnails, embedded files and preserved
      Photoshop payloads. Patterns and exact whole-source PSD blobs are present.
- [ ] Make pixel resources explicitly describe dimensions, bounds, bit depth,
      alpha mode, color interpretation and revision.
- [ ] Keep 8-bit paths fast while preserving 16-bit RGB through worker decode,
      GPU upload and native layer storage.
- [ ] Complete `PhotoshopPreservationData`: exact original source bytes are
      preserved now; original layer/resource IDs, unknown blocks and
      dirty/replaced state still need a formal roundtrip contract.
- [x] Add per-feature support state to the document model and native
      persistence.

#### Adapter and worker boundary

- [x] Define immutable PSD worker DTOs for document preflight, embedded
      composite, layer tree, pixel assets, masks, text/vector descriptors,
      adjustment descriptors and unsupported payloads.
- [x] Define the one-way adapter:
      `ag-psd result -> PSD DTO -> canonical LightTable document`.
      Editor code must never retain or mutate an `ag-psd` object.
- [ ] Define configurable safety limits for dimensions, pixel count, layer
      count, nesting depth, decoded bytes and archive/resource sizes.
- [ ] Add cancel/progress/error messages and guaranteed worker/resource
      disposal.
- [x] Ensure the PSD worker and dependency are lazy chunks so ordinary
      PNG/JPEG/WebP startup and bundle execution are unaffected.

#### Fixtures and import UX

- [ ] Build a small Photoshop-generated gate corpus: flat 8-bit RGB, 16-bit
      RGB, offsets, alpha, mask, nested group, clipping stack, representative
      blend modes, one Adjustment Layer, text, Smart Object and unknown
      descriptor/resource data.
- [ ] Add structure snapshots and embedded-composite pixel baselines for that
      corpus.
- [x] Add PSD to the regular file picker after connecting the lazy worker.
      PSB remains pending because the current worker slice has not been
      validated against large-document fixtures.
- [ ] Complete import progress, cancellation and actionable preflight UX.
      Worker termination, structured errors and the filterable persisted
      feature-loss report are implemented.

#### Library connection point

- [x] Recheck the pinned `ag-psd` version/API against
      `AG_PSD_FEATURE_PARITY_REFERENCE.md`.
- [x] Keep `ag-psd` inside the lazy worker boundary so ordinary image startup
      does not execute the PSD parser.
- [x] First comparison vertical slice: safety preflight -> embedded composite
      -> feature inventory -> canonical preview-backed raster document.
      The embedded composite is transient comparison truth; the original PSD
      bytes are deliberately not copied into the native LightTable document.
- [x] Second vertical slice: editable raster layers, bounds metadata, groups
      and bitmap masks.

**Ready-to-import definition:** the DTO/adapter boundary, asset registry,
preservation/support model, safety limits and gate fixtures exist. Exact native
support for text, vector, every Adjustment type, Layer Styles and Smart
Objects is not required before installing the library; those features may
enter as preserved or preview-backed and are completed in later phases.

### Phase A — safe visual PSD import

- [x] Add `ag-psd` only to the lazy PSD worker path.
- [x] PSD detection and bounded decode limits. PSB fixture validation remains.
- [x] Parse structure without blocking the UI.
- [x] Display the embedded composite as the Photoshop reference.
- [x] Build structured feature classification and compatibility reporting.
- [x] Preserve exact original source bytes in native layered documents and
      restore the Photoshop reference from them on reopen.

Exit: representative PSDs open safely and look correct even when their layers
are not yet natively rendered.

### Phase B — editable raster document parity

- [x] Raster layers and bounds metadata; current worker assets are normalized
      to full-canvas 8-bit PNG, so full-precision layer assets remain open.
- [x] Nested groups with pass-through and isolated compositing.
- [x] Bitmap masks including density and feather evaluation.
- [x] Visibility, opacity, fill opacity and locks.
- [x] Clipping.
- [ ] Full Photoshop golden-fixture blend/group-compositing audit.
- [x] Layers-panel UI for current P0 state.

Exit: P0 raster/group fixtures match Photoshop and remain editable.

### Phase C — adjustment parity

- [x] Finish the reusable adjustment module registry and evaluator bridge.
- [x] Add multiple ordered adjustment layers.
- [x] Map priority PSD adjustment descriptors to typed modules while
      preserving unknown descriptors.
- [x] Add adjustment editing UI plus blend, clipping and bitmap-mask behavior.

Exit: priority adjustment fixtures render, edit and reopen correctly.

### Phase D — text and vector

- [ ] Text/vector semantic model plus raster fallbacks.
- [ ] Font and general pattern-fill asset resolution. Embedded Photoshop
      patterns already resolve for Pattern Overlay and pattern Stroke.
- [ ] Native renderers.
- [ ] Type, path and shape tools plus properties.

Partial implementation note: canonical flow/positioned text and vector
path/live-shape models, WebGPU renderers, type/shape/path tools and shared
style controls exist. Path-text creation/handles, unsupported Photoshop text
semantics, vector boolean/gradient/pattern semantics, mixed-style presentation
and PSD write-back keep this phase open.

Exit: supported edits regenerate valid previews and unsupported variants remain
visually stable.

### Phase E — layer effects

- [x] Typed effect model and reusable effect-node registry for the currently
      implemented Layer Styles.
- [x] Shared WebGPU effect compositor used by native and PSD-imported styles.
- [x] Layer Style UI with live document preview.
- [ ] Photoshop visual-golden calibration, effect-order verification and
      merge/flatten/native-reload browser matrix.

### Phase F — Smart Objects and filters

- [ ] Asset dependency graph.
- [ ] Embedded/linked content lifecycle.
- [ ] Nested document editing.
- [ ] Typed Smart Filter mappings.

### Phase G — export and roundtrip hardening

- [ ] Capability audit and explicit rasterization policy.
- [ ] Regenerate changed layer previews, composite and thumbnail.
- [ ] Write PSD/PSB.
- [ ] Re-read immediately and compare structure and pixels.
- [ ] Photoshop open/resave/reimport fixture tests.

## 7. Test corpus and release gates

Maintain Photoshop-generated golden fixtures with one focused feature per
file, plus hostile combinations:

- partially transparent pixels with every blend mode;
- nested isolated and pass-through groups;
- clipping stacks;
- opacity versus fill opacity;
- bitmap and vector masks with offsets, density and feather;
- each adjustment type;
- text with missing fonts and mixed style runs;
- vector boolean operations;
- multiple layer effects;
- embedded and linked Smart Objects;
- 8/16-bit documents;
- large PSB and malformed/adversarial files.

For each fixture record:

- parsed structure;
- support classification;
- LightTable render versus embedded Photoshop composite;
- save/reopen structure;
- Photoshop reopen result;
- warnings shown to the user.

A feature is not complete until model, renderer, UI, undo/redo, persistence and
roundtrip behavior are covered together.

## 8. Non-negotiable guardrails

- PSD parsing never slows ordinary PNG/JPEG/WebP startup.
- Parse/decode does not run synchronously on the UI thread.
- Do not use the mutable `ag-psd` object as editor state.
- Do not flatten on import merely because a semantic renderer is missing.
- Do not silently substitute fonts, profiles, color modes or linked assets.
- Do not silently export 16/32-bit input as 8-bit.
- Do not claim lossless roundtrip for unknown Photoshop blocks.
- Do not duplicate grade/effect shaders for PSD-only code.
- LightTable-native 3D, AI and future node features remain first-class even
  when PSD cannot represent them.
