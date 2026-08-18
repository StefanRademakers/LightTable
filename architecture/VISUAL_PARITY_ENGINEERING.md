# Visual parity engineering

## Purpose

This document records the reusable engineering lessons from the Photoshop and
Camera Raw comparison work. It applies to Grade, adjustment layers, Lens FX,
filters and future processing nodes.

Visual parity is not a screenshot-matching exercise. A control is trustworthy
only when its document semantics, processing scope, working color space,
interactive lifecycle and exported pixels agree with the intended model.

## Core rules

### Never use an implicit LUT as a parity repair

A LUT is valid only when the user explicitly selects a creative Look or Color
Lookup. It must have visible document state, a bypass and a strength control.

Do not create, select or embed a hidden LUT to compensate for an incorrect
curve, color range, tonal mask or processing order. Such a fix may fit one
image while breaking skin, gradients, HDR headroom and future combinations.

When a result differs from the oracle, first classify the difference as one
or more of:

- transfer curve or control range;
- tonal or color selection mask;
- overlap/blending between masks;
- working-space or transfer-domain difference;
- profile/gamut conversion;
- processing order;
- spatial kernel or scale decomposition;
- image-adaptive analysis.

Only change the corresponding model after multi-source evidence supports it.

### A control name does not define its algorithm

Similarly named controls may have different goals or internal models.
Examples already established in LightTable include Grade Exposure versus the
Photoshop Exposure adjustment, Color Mixer versus Hue/Saturation, Point Color
versus Selective Color, and creative Grain versus Camera Raw grain.

Reuse UI, state infrastructure and GPU plumbing where appropriate. Share the
actual processing module only when neutral behavior, range semantics,
processing domain and measured output establish that it is the same operation.

### Compare effects against each product's own neutral render

Decode, embedded-profile and output-conversion differences can make two
neutral images differ before a slider is touched. Every oracle measurement
therefore compares:

```text
Camera Raw adjusted - Camera Raw neutral
LightTable adjusted - LightTable neutral
```

The two effects can then be compared for direction, magnitude, continuity and
artifacts. A low neutral RMSE is useful evidence, but it is not a substitute
for this isolation.

### Profile identity is part of the fixture

Bit depth alone does not prove a wide-gamut or HDR path. Every corpus source
must record whether an ICC profile exists and, where controlled by us, its
declared profile and profile hash.

The canonical corpus includes sRGB diagnostics, a 16-bit precision source and
an explicit Display-P3 color target. A profile mismatch invalidates the
comparison; it must not be corrected by retuning a slider.

### Isolated parity does not prove composed parity

An isolated control can be close while two controls in sequence differ because
of clipping, masks, gamut handling or order. After accepting a section:

1. rerun its isolated moderate, 80% and endpoint cases;
2. run important pairs with sections before and after it;
3. rerun the representative full Grade stack;
4. inspect 16-bit gradients and saturated edges;
5. recheck every earlier accepted section after a shader-order change.

Layer order remains authoritative for independent processing layers. Fusion is
an optimization of a proven order, never permission to reorder visible nodes.

## Product-route testing

### Unit state is necessary but insufficient

Unit tests prove parsing, cloning, command behavior, uniform packing and shader
contracts. They do not prove that a live desktop interaction reaches the GPU or
survives document switching.

Every new processing family needs a packaged-desktop smoke that exercises the
real route where applicable:

- UI control or file chooser;
- document state and undo boundary;
- asset registration and persistence;
- renderer resource upload;
- continuous parameter update;
- export/flatten output;
- exact neutral or disabled bypass.

The Grade Look smoke demonstrated why this matters. The first implementation
cached Strength with the LUT resource, so the slider moved while the renderer
kept using the old value. A 0/50/100 pixel smoke caught the problem. The same
smoke now copies an embedded LUT between two documents and verifies the
asynchronous asset-ID remap at Strength 62.

### Asynchronous state must be observed at its completion boundary

Cross-document assets, lazy documents and GPU uploads do not necessarily settle
in the same event turn as a menu click. Tests must wait for a semantic result:

- the expected document revision or task completion;
- the authored control value;
- a registered asset;
- a completed renderer export;
- or an explicit ready state.

Arbitrary short sleeps create both false failures and false confidence. React
state should settle editor presentation; live drag rendering must use the
direct preview path and must not wait for React commits.

For layered documents, three different boundaries must not be conflated:

1. the canonical document and its layer tree are published;
2. persisted raster/mask/LUT assets have reached their GPU resources;
3. the renderer view owns the same canonical revision and has submitted a
   real document composite.

An export requested between those boundaries can be structurally valid but
still read a transparent allocation. Processing-suffix caches make this more
subtle: asset upload changes pixels without changing immutable layer-node
identity, so every post-initialize asset load must invalidate cached
composites explicitly. Oracle captures wait for the active renderer revision
and a document-composite execution, then reject a fully transparent export
when the reference contains visible pixels.

### Capture the build that was just tested

Launching Electron against an existing development `.vite` directory does not
prove current source. The directory can contain a successful but older bundle.
Renderer parity regression therefore packages the desktop application first
and passes that exact packaged executable to every child capture. Reports
record the launch mode; a stored report or a development-bundle capture is not
accepted as current-build product evidence.

## Reading corpus results

A fixed scalar correction is justified only when effect direction is already
strongly correlated and the magnitude ratio is stable across sources and
control values.

Reject scalar tuning when any of the following occurs:

- low or sign-changing correlation;
- magnitude ratios span materially different values per source;
- ramps improve while photographs regress;
- saturated patches rotate hue or clip differently;
- shadows, midtones and highlights disagree in different directions;
- moderate values do not interpolate between neutral and endpoints.

Current Color Grading evidence is an example: Global Saturation, the three
tonal wheels, Blending and especially Balance show source-dependent mask and
overlap differences. This calls for a grounded tonal-mask/model investigation,
not gains and not a correction LUT.

Spatial controls require the same discipline in another domain. Sharpening,
noise reduction, Clarity and Dehaze must be compared using frequency targets,
edges, skin and real noise. A mean strength ratio cannot repair a different
kernel, threshold or scale reconstruction.

## Impact on work already completed

The lessons above do not imply that all earlier work is invalid. They define
which evidence must be rechecked when related code changes.

| Existing area | Current implication | Required revalidation trigger |
| --- | --- | --- |
| Accepted Contrast, Blacks and negative Whites | Retain; supported by multi-source measurements | Any Light-order, tone-domain or output-shoulder change |
| Grade Curves | Retain shared native node; channel behavior remains characterized, not fully matched | Curve interpolation/domain or preceding color-stage change |
| Color Mixer | Retain current periodic OKLCH model; broad source ratios rule out a scalar repair | Range-mask, working-space or luminance-preservation change |
| Point Color | State/shader tests remain useful; Camera Raw oracle is still missing | Descriptor recovery or Visualize Range implementation |
| Color Grading | Do not retune from one image; investigate masks and overlap | Any mask, Blend/Balance or processing-order change |
| Detail / wavelet NR | Retain exact bypass and conditional passes; current model is characterized | Kernel, scale, threshold, reconstruction or order change |
| Creative Grain | Preserve LightTable's intended film-grain character | Only regressions in bypass, order, performance or artifacts |
| Native B&W Mix | Runtime and eight-range architecture remain valid | Camera Raw descriptor/corpus evidence or range-model change |
| Grade Look | Explicit creative feature, separate from Color Lookup and parity algorithms | Asset lifecycle, sampling domain or stack-order change |
| Photoshop adjustment layers | Existing parity evidence remains node-specific | Shared shader/domain changes or PSD round-trip changes |

## Revalidation cadence

Revalidation has two levels which must not be confused:

1. Report-only regression checks verify that stored measurements still satisfy
   their accepted gates and that the corpus remains readable. They do **not**
   prove the current renderer when no fresh capture was made.
2. Product-route recapture opens the packaged application, authors the control
   through its real UI or automation command, exports the current compositor
   output and compares that image with the accepted reference. This is the
   required evidence after a renderer-affecting change.

Both sides of a paired corpus must also embed the exact case-manifest SHA-256.
Matching filenames or case IDs are insufficient: a descriptor, prerequisite or
working-mode change can preserve the IDs while changing the authored operation.
Analysis must reject missing or unequal manifest hashes rather than compare new
product pixels with a stale oracle.

During Grade development, rerun the affected section after every focused
change. After the final Grade processing order is established, recapture all
previous Grade sections and the important combined cases once more; a finding
in a late section can expose an earlier order or working-domain assumption.

Photoshop-shaped adjustment layers remain an independent contract. A Grade-only
UI or algorithm change does not invalidate them. A change to shared compositor
order, document-profile conversion, common shader code, PSD descriptors or
asset sampling does: in that case recapture the complete accepted adjustment
suite rather than trusting its stored reports. Shared implementation must never
silently collapse semantic differences such as Grade's monotone Curves and
Photoshop Curves' measured natural spline.

Run `npm run preflight:photoshop-oracle` before an Adobe capture. The preflight
is read-only by default and must identify the active executable, version,
ProgID, registration target and open-document save states. It may launch the
version-pinned oracle only when explicitly requested and when no conflicting
Photoshop process owns automation. A conflicting instance or unsaved user
document is a capture-infrastructure failure, never permission to kill the
process, reuse the wrong Adobe version or relabel stored evidence.

## Acceptance checklist

Before accepting a visual processing change:

- the external descriptor or UI control is proven pixel-active;
- moderate, 80% and endpoint values are captured, including both signs;
- diagnostic targets and several photographs agree on the finding;
- embedded/assigned profiles are known and consistent;
- neutral/disabled state is an exact bypass;
- the intended layer and section order is explicit;
- important control combinations are recaptured;
- no hidden LUT or unexplained scalar is introduced;
- 16-bit gradients retain continuity and HDR values are not clipped by an LDR
  shortcut;
- the packaged product route reaches live GPU output;
- drag interaction remains direct and responsive;
- pass count, allocations and retained resources remain bounded;
- persistence, undo, cross-document assets, flatten and export are covered;
- durable findings and intentional differences are documented;
- the product owner can inspect representative contact sheets before a visual
  baseline is accepted.

## Related references

- `architecture/reference/implementation/GRADE_CAMERA_RAW_VISUAL_PARITY.md`
- `architecture/RENDERING_AND_PROCESSING.md`
- `architecture/PERFORMANCE_CONTRACT.md`
- `architecture/reference/implementation/grade-visual-suite.json`
- `scripts/grade-camera-raw-corpus.json`
