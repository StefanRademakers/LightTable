# Lighttable — Smart Object Selection Tool
## UX / UI / Interaction / Architecture Specification

**Status:** implementation proposal
**Goal:** create a fast, Photoshop-familiar smart object selection workflow for Lighttable while keeping the inference backend replaceable and allowing the coding agent to adapt the design to the existing Lighttable selection, command, undo, GPU and tool architecture.

---

## 1. Goal

Implement a smart **Object Selection** workflow that feels immediately familiar to experienced Photoshop users:

- hover an object to preview what will be selected;
- click to select the highlighted object;
- optionally draw a rectangle or lasso around an intended object;
- add/subtract/intersect with the current selection;
- provide a one-click **Select Subject** action;
- allow refinement without forcing the user into a complex workflow;
- reuse Lighttable's existing selection representation, masks, GPU rendering, undo and command infrastructure wherever possible.

The tool should feel like a native selection tool, **not like a separate AI feature**.

The model/inference implementation must remain replaceable. SAM 3 Tracker, SAM 2.1, MobileSAM or another future segmentation model should be able to implement the same internal interface.

---

# 2. Photoshop behaviour worth matching

Adobe's current desktop Object Selection workflow is primarily **hover-first**.

With Object Finder enabled:

1. activate Object Selection;
2. move the pointer over the image;
3. Photoshop automatically highlights a detected object/region;
4. click the highlighted object to create the selection.

The user can disable Object Finder and manually define the intended region using:

- Rectangle
- Lasso

Photoshop also exposes the standard selection combination modes:

- New Selection
- Add to Selection
- Subtract from Selection
- Intersect with Selection

Other relevant options include:

- Sample All Layers
- Hard Edge
- Select Subject
- Select and Mask
- Select People

This is a good UX reference because the intelligence remains mostly invisible. The canvas is still the primary interaction surface.

---

# 3. Proposed Lighttable tool family

Keep the existing Lighttable selection-tool grouping if possible.

Suggested tools/actions:

```text
Selection tools
├── Marquee
├── Lasso
├── Magic Wand
├── Quick Selection
├── Object Selection      ← new
└── Selection Brush       ← existing/future if useful

Selection actions
├── Select Subject        ← AI action
├── Select All
├── Deselect
├── Invert
└── Refine Selection
```

Do not create separate toolbar tools for every AI function.

`Select Subject`, `Select People`, etc. are better treated as contextual actions of the selection system.

---

# 4. Primary Object Selection UX

## 4.1 Tool activation

Object Selection should participate in Lighttable's normal tool activation / command system.

Photoshop groups Object Selection, Quick Selection and Magic Wand under the `W` shortcut family.

Recommended Lighttable behaviour:

```text
W
```

activates/cycles the smart-selection tool group, **if that is compatible with Lighttable's existing Photoshop-compatible key map**.

Do not force this if `W` is already intentionally mapped differently. Prefer consistency with the current Lighttable shortcut architecture over duplicating Photoshop blindly.

---

## 4.2 Default mode: Object Finder

Recommended default:

```text
Object Finder: ON
```

When the pointer enters the canvas:

```text
pointer move
    ↓
find candidate object under pointer
    ↓
show translucent highlight
    ↓
click
    ↓
commit selection
```

### Hover state

The highlighted region should:

- be clearly visible;
- not hide important image detail;
- appear/disappear quickly;
- have no marching ants until committed;
- ideally use a lightweight GPU overlay;
- not create undo history.

Suggested rendering:

```text
selected candidate:
    translucent colored fill
    optional subtle boundary
```

Use Lighttable's existing selection overlay style if possible rather than inventing another visual language.

A preference for overlay color is optional.

---

# 5. Object Finder behaviour

The user should not need to know that embeddings, candidate masks or ML inference exist.

Desired interaction:

```text
hover dog → dog highlights
hover person → person highlights
hover chair → chair highlights
click chair → chair becomes selection
```

The highlighted candidate should remain stable enough that tiny pointer movements do not constantly switch objects.

Recommended:

- short hover debounce/hysteresis;
- retain the current candidate while pointer remains comfortably inside it;
- switch candidates only after pointer crosses a meaningful boundary;
- avoid visual flicker.

This stability is more important than reacting to every pointer event.

---

# 6. Candidate generation strategy

The exact implementation is intentionally left open for the coding agent.

Potential approaches include:

### A. Precomputed object candidates

On tool activation or document/layer change:

```text
image
 ↓
object proposal / segmentation pass
 ↓
candidate masks
 ↓
hover = hit-test masks
```

Advantages:

- extremely fast hover;
- excellent UX;
- no inference on every pointer move.

Disadvantages:

- potentially expensive initial scan;
- may require a model capable of automatic candidate generation.

### B. Point-prompt segmentation

```text
pointer settles
 ↓
point prompt
 ↓
model returns candidate masks
 ↓
best candidate highlighted
```

Advantages:

- simpler;
- works naturally with SAM-style models.

Disadvantages:

- pointer latency may be noticeable.

### C. Hybrid

Recommended direction if practical:

```text
image encoder once
      ↓
cached image embedding
      ↓
point / box / lasso prompts
      ↓
fast decoder
```

The coding agent should benchmark the available browser/Electron inference backend rather than locking the architecture prematurely.

---

# 7. Options bar

Keep the options bar compact.

Recommended first version:

```text
[New][Add][Subtract][Intersect]

Mode: [Object Finder ▼]

[ ] Sample All Layers
[ ] Hard Edge

[ Select Subject ]

[ Select & Mask / Refine ]
```

Possible `Mode` dropdown:

```text
Object Finder
Rectangle
Lasso
```

When Object Finder is selected, click/hover interaction is active.

When Rectangle or Lasso is selected, the user explicitly gives the model a region prompt.

Avoid exposing model-specific controls here.

Do NOT expose things like:

```text
IoU threshold
decoder confidence
encoder resolution
mask score
NMS threshold
```

Those belong inside the engine.

---

# 8. Selection combination modes

The AI tool should output a normal Lighttable selection mask.

Everything after inference should use the same boolean selection operations as the other selection tools.

Conceptually:

```text
New:
selection = detectedMask

Add:
selection = union(selection, detectedMask)

Subtract:
selection = selection - detectedMask

Intersect:
selection = intersection(selection, detectedMask)
```

Prefer doing these through the existing Lighttable selection engine / GPU mask operators.

Do not duplicate selection-combine logic inside the AI subsystem.

---

# 9. Modifier keys

Where compatible with existing Lighttable behaviour, preserve Photoshop-style temporary selection modifiers:

```text
Shift
    temporary Add to Selection

Alt / Option
    temporary Subtract from Selection
```

If Lighttable already supports this for Marquee/Lasso/Magic Wand, Object Selection should inherit exactly the same modifier mechanism.

Potential combined modifier:

```text
Shift + Alt / Option
    Intersect
```

Only implement if this is consistent with the current global selection interaction model.

Cursor feedback should reflect the temporary mode:

```text
+  add
−  subtract
×  intersect
```

---

# 10. Rectangle mode

Rectangle mode is not a normal rectangular selection.

The rectangle means:

> find the object intended by the user inside this region.

Interaction:

```text
mouse down
drag rectangle
mouse up
      ↓
model receives rectangle/box prompt
      ↓
best matching object mask
      ↓
combine with current selection
```

The rectangle itself disappears after inference.

While dragging:

- show normal selection rectangle;
- do not run expensive inference continuously unless benchmarks show it is cheap enough;
- inference on pointer-up is acceptable.

---

# 11. Lasso mode

Same principle:

```text
rough lasso around object
       ↓
derive model prompt / bounding region
       ↓
segment intended object
       ↓
selection
```

The lasso is a **hint**, not the final boundary.

Possible backend approaches:

- use lasso bounding box as the model box prompt;
- rasterize lasso as a spatial prior;
- sample positive points inside the polygon;
- use a mask prompt if supported.

The coding agent should choose whichever produces the best result with the chosen model.

Do not overengineer this before benchmarking.

---

# 12. Select Subject

Provide an obvious:

```text
Select Subject
```

button in the Object Selection options bar and/or:

```text
Select > Subject
```

menu command.

Expected behaviour:

```text
click Select Subject
      ↓
identify dominant subject(s)
      ↓
create normal Lighttable selection
```

Photoshop distinguishes this from Object Selection:

- **Select Subject** = automatically find the main subject(s);
- **Object Selection** = user indicates a specific intended object.

Maintain that distinction.

Select Subject should also be callable through Lighttable's command layer, so MCP/automation can eventually invoke the same command.

Example conceptual command:

```ts
selection.selectSubject()
```

Actual naming should follow the existing Lighttable command architecture.

---

# 13. Select People — Phase 2

Current Photoshop versions expose a `Select People` workflow from Object Selection.

Detected people can be shown as thumbnails, after which the user can choose:

```text
Entire person
Hair
Facial skin
Beard
Eyebrows
...
```

Lighttable should **not require this for v1**.

However, design the API so semantic subparts can be introduced later.

For example:

```ts
interface SemanticObjectCandidate {
    id: string
    label?: string
    mask: SelectionMask
    parts?: SemanticObjectPart[]
}
```

Do not commit to this exact interface if the existing architecture suggests a cleaner solution.

Potential future backend:

- SAM-class model for generic objects;
- dedicated human parsing model for body/hair/face regions;
- future segmentation model supporting semantic parts.

---

# 14. Hover highlighting

This is a crucial part of the perceived quality.

The user should see the model's interpretation **before committing**.

Recommended states:

```text
Idle
    no overlay

Hover candidate
    translucent object overlay

Inference pending
    retain previous candidate if valid
    optionally subtle busy indication

Click
    commit candidate into real selection

Committed
    standard Lighttable marching ants / selection visualization
```

Never clear a useful hover preview just because a new inference request is running.

Avoid spinner-heavy UX.

---

# 15. Async inference

Inference should never block UI input.

Recommended conceptual pipeline:

```text
UI thread
    |
    +-- pointer / tools / overlays
    |
worker / inference runtime
    |
    +-- image encoder
    +-- prompt decoder
    +-- mask generation
```

If Transformers.js / ONNX Runtime WebGPU requires a different architecture, adapt accordingly.

Important requirements:

- stale inference results must be discarded;
- switching document cancels/invalidates pending work;
- switching layer invalidates relevant caches;
- revision IDs should protect against applying results to outdated pixels.

Example:

```text
request #41 pointer=(450,200)
request #42 pointer=(470,205)

#42 becomes current

result #41 arrives → discard
result #42 arrives → display
```

---

# 16. Image embedding cache

SAM-like models benefit strongly from separating:

```text
image encoding
```

from:

```text
prompt decoding
```

If supported by the chosen backend, cache the encoded image representation.

Cache key should account for whatever visually changes the source being sampled.

Potential key:

```text
documentId
layer/composite revision
sampleAllLayers
modelId
modelVersion
encoderResolution
```

Exact structure should follow Lighttable's existing revision/resource cache architecture.

Invalidate only when required.

Tool activation should ideally feel instant after the initial encode.

---

# 17. Sample All Layers

Photoshop exposes `Sample All Layers`.

Equivalent Lighttable behaviour:

### OFF

Inference source:

```text
active layer's rendered pixels
```

### ON

Inference source:

```text
visible composited document
```

However, the resulting mask remains a **document-space selection**, not something tied internally to the sampled pixels.

The coding agent should inspect how Lighttable currently represents selections across transformed layers and document coordinates.

Avoid unnecessary CPU readback from the WebGPU compositor.

Prefer an existing GPU render target → inference-compatible image path.

---

# 18. Hard Edge

Photoshop exposes `Hard Edge`.

Interpret this as output post-processing, not necessarily a model setting.

Possible Lighttable implementation:

```text
soft probability/alpha mask
      ↓
Hard Edge OFF
      keep useful antialiased / soft boundary

Hard Edge ON
      threshold / tighten edge
```

Exact algorithm should be chosen experimentally.

Avoid destroying hair/fur quality when Hard Edge is disabled.

---

# 19. Selection result format

The model backend should not own the final persistent selection representation.

Recommended boundary:

```text
ML backend
    ↓
normalized mask/probability map
    ↓
SelectionEngine
    ↓
Lighttable selection mask
```

The final result should be indistinguishable from a mask created by:

- marquee;
- lasso;
- magic wand;
- quick selection;
- selection brush.

This means all normal commands continue to work:

```text
invert
feather
expand
contract
clear
save/load selection
create layer mask
delete/fill
copy/cut
adjustment through selection
```

---

# 20. Refine Selection / Select & Mask

Photoshop's Select and Mask workspace contains many controls.

Lighttable does not need to reproduce the entire interface immediately.

A useful first version should focus on the controls users need most often.

Suggested panel/dialog:

```text
REFINE SELECTION

View
[ Overlay ▼ ]
Opacity [-------]

Edge
Radius       [---]
Smooth       [---]
Feather      [---]
Contrast     [---]
Shift Edge   [---]

[ Refine Edge Brush ]

Output
[ Selection ▼ ]

[Cancel] [OK]
```

Potential output options later:

```text
Selection
Layer Mask
New Layer with Mask
```

Integrate with whatever selection/mask workflow Lighttable already has.

---

# 21. Refine view modes

Photoshop currently exposes view modes including:

- Onion Skin
- Marching Ants
- Overlay
- On Black
- On White
- Black and White
- On Layers

Useful Lighttable subset for v1:

```text
Overlay
On Black
On White
Black & White
On Layers / Transparency
```

These are extremely useful for finding edge defects.

Recommended shortcuts while the refine UI is active:

```text
F
    cycle view mode

X
    temporarily disable / show original view
```

Adobe currently uses these shortcuts inside Select and Mask.

Adopt them if they do not conflict with Lighttable's contextual shortcut rules.

---

# 22. Refine edge workflow

Photoshop distinguishes general selection refinement from hair/complex-edge refinement.

Lighttable can initially provide a generic:

```text
Refine Edge Brush
```

The brush marks a zone where the edge should be reevaluated.

Do not make the brush itself directly paint the final binary mask unless the existing architecture already works that way.

Conceptually:

```text
edge uncertainty region
     +
image content
     +
current mask
     ↓
edge refinement
```

A later `Refine Hair` action can specialize this.

---

# 23. Selection Brush as manual fallback

Photoshop's newer Selection Brush uses a visible overlay and has:

- Add brush;
- Subtract brush;
- Size;
- Hardness;
- overlay color;
- overlay opacity.

Lighttable already has a brush engine, so manual selection correction should preferably reuse it.

Useful flow:

```text
AI Object Select
      ↓
95% correct
      ↓
Selection Brush / Refine Brush
      ↓
manual correction
```

This is much better than trying to make ML solve every pixel perfectly.

---

# 24. Model backend abstraction

Create a backend-independent segmentation contract.

Conceptual only:

```ts
interface SmartSelectionBackend {
    prepare(source: SelectionSource): Promise<PreparedSelectionSource>

    selectPoint(
        source: PreparedSelectionSource,
        point: Vec2
    ): Promise<SelectionCandidate[]>

    selectBox(
        source: PreparedSelectionSource,
        bounds: Rect
    ): Promise<SelectionCandidate[]>

    selectSubject?(
        source: PreparedSelectionSource
    ): Promise<SelectionCandidate[]>

    disposePreparedSource(
        source: PreparedSelectionSource
    ): void
}
```

Possible extension:

```ts
selectPoints(...)
selectMaskPrompt(...)
findObjects(...)
selectSemanticPart(...)
```

The coding agent should adapt names and lifetime management to the existing Lighttable codebase.

The important design requirement is:

> UI and selection logic must not depend directly on SAM, Transformers.js or ONNX tensor structures.

---

# 25. Backend candidates

Current candidates worth benchmarking:

## SAM 3 / SAM 3 Tracker

Advantages:

- modern promptable segmentation;
- points, boxes and masks;
- strong candidate for high-quality object selection;
- concept/open-vocabulary capabilities exist in the wider SAM 3 architecture.

Caution:

- SAM 3 uses Meta's **SAM License**, not Apache 2.0;
- commercial bundling needs to comply with that license;
- keep license handling isolated and documented.

## SAM 2.1

Advantages:

- high-quality promptable segmentation;
- Apache 2.0 licensed official checkpoints/code;
- commercially clean option;
- excellent candidate if quality/performance is sufficient.

## Mobile / smaller variants

May be useful for:

- startup/download size;
- lower-end GPUs;
- fast hover;
- optional quality/performance modes.

Do not hard-code the product around one model before real Lighttable benchmarks.

---

# 26. Transformers.js / ONNX runtime

Preferred direction for Lighttable:

```text
Transformers.js
        ↓
ONNX Runtime
        ↓
WebGPU where supported
```

But the coding agent should confirm:

- actual supported operators for the chosen ONNX model;
- memory usage;
- encoder latency;
- decoder latency;
- GPU memory pressure alongside Lighttable's compositor;
- Electron behaviour;
- model load/startup time;
- FP16/FP32 compatibility;
- whether the model can remain entirely GPU-side enough to avoid costly transfers.

Do not assume that a theoretically WebGPU-compatible model is fast enough.

Benchmark it in the real application.

---

# 27. Model loading

The smart-selection feature should be designed for optional/lazy loading.

Recommended:

```text
Lighttable startup
    no segmentation model loaded

first Object Selection use
    ↓
load runtime/model
    ↓
retain while useful
```

Whether the model ships inside the installer or is downloaded as an optional component is a product/distribution decision.

The architecture should support both.

Potential states:

```text
not installed
loading
ready
error
unsupported
```

Do not expose technical backend terminology to normal users.

---

# 28. Performance targets

Treat these as goals, not hard guarantees.

## Hover

After image embedding exists:

```text
target: visual response should feel near-interactive
```

Ideally < ~100 ms; lower is better.

A stable 100–150 ms experience can still feel good with sensible debounce and retained previews.

## Initial image preparation

A short delay on first tool activation is acceptable, but:

- never freeze UI;
- make preparation cancellable;
- cache results;
- avoid repeating it unnecessarily.

## Memory

Image embeddings can be large.

Investigate:

```text
one active document embedding
vs.
per-document caches
```

Start conservative.

Probably retain only:

```text
active document
+ optionally one recently-used document
```

unless measurements show caching more is cheap.

---

# 29. Progressive quality

An interesting optimization, if necessary:

```text
hover
    fast/smaller model or lower-resolution path

click
    high-quality refinement

Select & Mask
    full-resolution edge treatment
```

Do **not** implement this complexity unless benchmarks show it is needed.

A single fast high-quality model is preferable.

---

# 30. Coordinate handling

This needs careful integration with Lighttable.

Prompts may begin in:

```text
screen coordinates
```

but inference may operate in:

```text
document pixels
model input coordinates
```

Selections may then need to map through:

```text
zoom
pan
document transform
layer transform
model resize/padding
```

Create one well-tested coordinate conversion path.

Do not scatter model-coordinate conversion throughout UI code.

Example conceptual pipeline:

```text
screen
  ↓
canvas/document
  ↓
source texture
  ↓
model input
```

And mask results reverse that transform.

---

# 31. Undo

Hover:

```text
NO undo entry
```

Changing Object Selection mode:

```text
NO document undo entry
```

Committed selection:

```text
one normal selection-history action
```

Add/subtract operations:

```text
one action per committed interaction
```

Select Subject:

```text
one action
```

Refine Selection OK:

```text
one action
```

Reuse Lighttable's existing command/undo transaction system.

---

# 32. Loading / failure UX

Avoid modal dialogs for normal inference.

Possible subtle states:

```text
Preparing Object Selection…
```

in the options bar/status area.

If inference is unavailable:

```text
Object Selection unavailable
```

with a concise explanation/action.

Examples:

- model component not installed;
- WebGPU/backend unsupported;
- model failed to load.

Rectangle/Lasso should not silently become normal geometric selections if AI failed; that would be surprising.

---

# 33. Preferences

Keep preferences minimal.

Possible:

```text
Smart Object Selection

Model:
    Automatic
    [advanced/debug alternatives if appropriate]

Preload model:
    Off / On

Object Finder:
    On by default

Hover overlay color:
    use global selection overlay by default
```

Most users should never need to visit these settings.

Avoid exposing model filenames or ONNX internals in the normal preferences UI.

---

# 34. Commands / MCP readiness

Every major action should enter through Lighttable's normal command layer.

Possible conceptual commands:

```text
selection.objectSelect
selection.selectSubject
selection.setMode
selection.addMask
selection.subtractMask
selection.intersectMask
selection.refine
```

Do not necessarily use these literal names.

Benefits:

- keyboard shortcuts;
- menus;
- toolbar;
- undo;
- scripting;
- future MCP;
- automated testing

all call the same logic.

---

# 35. Automated tests

Add deterministic tests around everything that does not depend on model nondeterminism.

## Selection boolean operations

```text
A union B
A subtract B
A intersect B
```

## Coordinate transforms

Test:

```text
screen → model
model → document
```

under:

- zoom;
- pan;
- varying aspect ratios;
- resized model inputs.

## Async result invalidation

Verify stale requests cannot overwrite newer hover results.

## Revision invalidation

Changing sampled pixels must invalidate stale prepared data.

## UX state tests

```text
activate tool
hover
click
shift-click
alt-click
rectangle mode
lasso mode
select subject
cancel refine
commit refine
```

For actual ML quality, use a small visual regression corpus rather than strict pixel hashes unless the inference path is deterministic.

---

# 36. Suggested implementation phases

## Phase 1 — Backend prototype

No polished UI yet.

Prove:

```text
image → encode
point → mask
box → mask
```

Measure:

- model load time;
- encode time;
- point decode time;
- GPU memory;
- mask transfer cost.

Benchmark at least SAM 2.1 and SAM 3 Tracker if feasible.

---

## Phase 2 — Basic Object Selection

Implement:

- tool;
- options bar;
- Rectangle;
- click/point selection;
- New/Add/Subtract/Intersect;
- Sample All Layers;
- normal Lighttable selection output;
- undo.

This already creates a usable product feature.

---

## Phase 3 — Object Finder

Add:

- hover candidate;
- stable highlight;
- cache/preparation;
- async request cancellation;
- candidate hit-testing.

This is the phase that makes the tool feel particularly Photoshop-like.

---

## Phase 4 — Select Subject

Add:

- options-bar button;
- Select menu command;
- command-layer action;
- normal selection output.

---

## Phase 5 — Refine Selection

Add compact refine UI:

- views;
- opacity;
- feather;
- smooth;
- contrast;
- shift edge;
- manual/refine brush;
- output to selection/mask.

---

## Phase 6 — Advanced semantics

Only if valuable:

- Select People;
- hair;
- skin;
- clothes/body parts;
- Mask All Objects;
- cached multi-object proposals;
- semantic text selection if a suitable model supports it.

---

# 37. What NOT to copy blindly from Photoshop

Photoshop is the reference for user expectations, not a constraint on architecture.

Do not automatically reproduce:

- every dropdown;
- every legacy option;
- every Select & Mask control;
- modal workflow complexity;
- Adobe-specific cloud/local processing choices;
- Adobe-specific model behaviour.

For Lighttable, prefer:

```text
fast
local
predictable
GPU-friendly
minimal UI
```

while retaining familiar interaction patterns.

---

# 38. Recommended v1 UI

A strong first version could be only:

```text
OBJECT SELECT

[New] [Add] [Subtract] [Intersect]

Mode: [Object Finder ▼]

☐ Sample All Layers
☐ Hard Edge

[Select Subject]

[Refine…]
```

Mode dropdown:

```text
Object Finder
Rectangle
Lasso
```

Interaction:

```text
Hover → highlight
Click → select
Shift → add
Alt/Option → subtract
```

That gives the user most of the value without turning the tool into a complex AI panel.

---

# 39. Product principle

The best outcome is when the user thinks:

> “I hovered the object and clicked it.”

not:

> “I ran an AI segmentation model.”

The AI/backend should disappear behind normal editor interaction.

---

# 40. Open decisions for the coding agent

Before committing to implementation details, inspect the current Lighttable codebase and decide:

1. where smart-selection inference best fits in the existing tool architecture;
2. whether selection masks currently live GPU-side, CPU-side, or both;
3. how document/layer revision IDs should invalidate embeddings;
4. how best to expose compositor output to ONNX/Transformers.js;
5. whether inference should live in a worker;
6. whether Object Finder should use automatic object proposals or point prompts;
7. how much candidate data should be cached;
8. which model provides the best real-world quality/performance trade-off;
9. how model installation/distribution fits the existing desktop packaging architecture;
10. whether the current selection brush can double as the manual correction/refinement tool.

Prefer reusing existing Lighttable systems rather than creating parallel infrastructure.

---

# 41. Acceptance criteria

The feature is successful when:

- Object Selection feels like a normal Lighttable selection tool.
- Hovering a recognizable object produces a stable preview.
- Clicking produces a usable mask with minimal delay.
- Rectangle/Lasso reliably disambiguate crowded scenes.
- Shift/Add and Alt/Subtract feel identical to other selection tools.
- The resulting mask works with every existing selection-dependent command.
- No inference operation freezes canvas interaction.
- Model/backend can be replaced without rewriting the tool UI.
- Model caches invalidate correctly after visual content changes.
- `Select Subject` works through UI, menu/command layer and undo.
- Refine workflow can improve difficult boundaries without destroying the original selection.

---

# References / research basis

Adobe Photoshop documentation consulted for the UX reference:

- Adobe — **Use the Object Selection tool**
  https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/select-objects-with-object-selection-tool.html

- Adobe — **Detect subject using Select Subject**
  https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/detect-subject-using-select-subject.html

- Adobe — **Make precise selections using Select People**
  https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-precise-selections-using-select-people.html

- Adobe — **Refine your selection and mask**
  https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html

- Adobe — **Create quick selections with Selection Brush Tool**
  https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/create-quick-selections-with-selection-brush-tool.html

- Adobe — **Improve hair selections with Refine Hair**
  https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-improved-hair-selections.html

- Adobe — **Create layer masks for all detected objects**
  https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/create-layer-masks-for-all-detected-objects-in-a-layer.html

Model/backend references:

- Meta — **SAM 3**
  https://github.com/facebookresearch/sam3

- Meta — **SAM 3 License**
  https://github.com/facebookresearch/sam3/blob/main/LICENSE

- Meta — **SAM 2**
  https://github.com/facebookresearch/sam2

- Meta — **SAM 2 License (Apache 2.0)**
  https://github.com/facebookresearch/sam2/blob/main/LICENSE

---

## Final implementation note

This document is intentionally a **behavioural and architectural specification**, not a fixed code design.

The implementation agent should preserve the user-facing principles and expected Photoshop-compatible interactions, but is explicitly encouraged to choose a cleaner or faster internal solution when the existing Lighttable architecture makes that preferable.
