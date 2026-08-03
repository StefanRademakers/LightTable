# PSD template corpus feature matrix

Audit date: 2026-08-04

This is a read-only feature audit. No PSD rendering or import behavior was
changed while collecting these results. Detailed per-layer source metadata is
in `corpus-inventory.json`; the inventory can be regenerated with
`node scripts/audit-psd-template-corpus.mjs`.

## Corpus validity

- Ten PSDs and ten matching reference images were found.
- `ag-psd` and Photoshop 27.8 independently reported exactly 284 layers.
- Every PSD is RGB, 8-bit and approximately 3000 x 4200 pixels.
- All ten packaged LightTable runs reached a rendered frame without a page
  error. Their current reconstructed/reference difference ranges from 0.40%
  to 98.39%.
- Photoshop composite captures and its independent DOM inventory were written
  to `tmp/task-049/photoshop-pass3/`; existing source files were never saved.
- Existing LightTable captures and diagnostics are in
  `tmp/psd-raw-EHS-*.{png,json}`.

## Document results

| PSD | Layers | Max depth | Difference | Ready | GPU estimate | Dominant audit findings |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| EHS-395 | 47 | 2 | 95.12% | 1868 ms | 2.98 GB | 2 unsupported Gradient Maps, 14 vector shapes/masks, 9 styled layers, 8 raster-preview text layers |
| EHS-396 | 42 | 1 | 17.57% | 1732 ms | 1.09 GB | 28 smart-object previews, 24 off-canvas layers, 2 unsupported vector-stroke mappings, 8 raster-preview text layers |
| EHS-401 | 38 | 1 | 8.74% | 1359 ms | 1.53 GB | 24 smart-object previews, Color Balance/Hue-Saturation approximation, 10 off-canvas layers |
| EHS-402 | 45 | 1 | 12.55% | 1787 ms | 2.06 GB | 13 raster-preview text layers, 5 oversized layers, 5 vector mappings, 3 color overlays |
| EHS-404 | 40 | 1 | 98.39% | 1651 ms | 2.03 GB | 6 adjustment layers, including 5 approximate Photo Filters, 4 smart-object previews, 10 text previews |
| EHS-405 | 15 | 1 | 55.79% | 1351 ms | 1.03 GB | 7 text previews, mask/vector reconstruction and one oversized layer |
| EHS-406 | 18 | 2 | 38.27% | 1450 ms | 1.94 GB | 7 text previews, vector masks, 2 active drop shadows and off-canvas content |
| EHS-407 | 15 | 1 | 53.92% | 1334 ms | 1.01 GB | 7 text previews plus mask/vector reconstruction |
| EHS-409 | 17 | 2 | 22.26% | 1162 ms | 1.00 GB | 8 text previews, Hard Light and off-canvas/oversized content |
| EHS-442 | 7 | 0 | 0.40% | 1155 ms | 0.69 GB | Raster-backed baseline; five text descriptors remain non-editable but visual fidelity is near exact |

`Difference` is the percentage of sampled reconstructed pixels differing from
the embedded Photoshop composite by more than 2/255. It is deliberately shown
per document; averaging would hide the severe EHS-395/EHS-404 failures.

## Source feature frequency

| Feature | Documents | Layers / instances | Current state and gap |
| --- | ---: | ---: | --- |
| Groups / pass-through groups | 9 | 33 | Canonical groups exist; their interaction with unsupported adjustments/styles needs scope-level fallback evidence. |
| Clipping layers | 0 | 0 | Not covered by this corpus. Keep the existing dedicated fixtures; do not infer clipping parity here. |
| User or real raster masks | 8 | 22 | Raster mask rendering exists. PSD real/vector result is often collapsed to one raster mask; independent dual-mask editing is absent. |
| Vector masks | 5 | 21 | Paths are preserved, but several layers render through rasterized real-mask pixels. |
| Off-canvas layers | 9 | 63 | Runtime import supports translated tight surfaces. Native save/reopen does not persist raster width/height and is currently unsafe. |
| Layers larger than canvas | 8 | 13 | Must remain layer-local and unclipped in storage; only final document composition clips. |
| Non-normal blends | 5 | 13 | 8 Screen, 2 Multiply, 2 Soft Light and 1 Hard Light. IDs map natively; contextual parity still needs focused blend/mask fixtures. |
| Partial opacity | 7 | 19 | Canonical property exists. |
| Partial fill opacity | 1 | 1 | Canonical property exists and is correctly separate from opacity; this corpus has weak coverage. |
| Active layer-style layers | 4 | 16 | 10 Color Overlays, 4 Drop Shadows, 1 Gradient Overlay and 1 Pattern Overlay. Canonical mappings exist, with unresolved paint/pattern/gradient edge cases. |
| Dormant style descriptors | 4 | 17 layers | Retained internally. Commit `986dd5ec` now hides them from the compact Layers tree, matching Photoshop. |
| Vector shape layers | 8 | 31 | Solid/color fills dominate. Six vector strokes in three documents expose incomplete Photoshop stroke semantics. |
| Adjustment layers | 3 | 11 | 5 Photo Filters, 2 Gradient Maps, 2 Color Balance, 1 Brightness/Contrast and 1 Hue/Saturation. Gradient Map is a no-op; the others are native or approximate mappings. |
| Text layers | 10 | 81 | All 81 currently arrived as layer-local raster previews in the measured runs. Text descriptors and 28 distinct font families are present, but no corpus text layer became editable. |
| Smart objects | 4 | 57 | All render from layer-local previews. Placement descriptors are retained, but embedded/linked object content is skipped and cannot be reopened semantically. |
| Non-affine/warped smart objects | 1 | 8 | Needs a canonical quadrilateral/warp contract before semantic editing; previews currently preserve appearance. |
| Text on path / warped text | 0 | 0 | Not covered by this corpus; keep `TextTest.psd` as the dedicated reference. |
| Gradient/pattern fill layers | 0 | 0 | Not covered as fill-layer types. One Gradient Overlay and one Pattern Overlay only test layer styles. |
| Smart filters | 0 | 0 | Not covered by this corpus. |

## Native LightTable format findings

### Critical: tight raster dimensions are not persisted

The runtime model correctly separates document bounds, layer-local dimensions
and document transform. The version-3 native manifest does not serialize a
raster layer's `width`, `height`, `offsetX` or `offsetY`; parse currently assigns
the document dimensions. A tight imported asset therefore cannot reliably
round-trip. The EHS-396 save/reopen automation timed out after saving a painted
tight layer, confirming this is an active failure rather than a theoretical
schema concern.

This belongs in Task 047 and must be fixed before the native format is used as
the authoritative corpus conversion target.

### Preview-backed semantics are fragmented

Text, vector and smart-object fallbacks retain useful PSD descriptors inside
`photoshop` metadata and keep layer-local preview pixels. However, each becomes
a raster layer with no shared recover/re-realize command. Text recovery is
already planned in Task 048; the underlying cached-preview/fingerprint contract
should be reusable for vector and smart-object sources.

Smart-object linked/embedded payload data is currently skipped during PSD
decode. Saving as LightTable therefore retains placement metadata and pixels,
but not enough source data to reopen the object itself.

### Unsupported adjustments require a scope preview

An adjustment layer has no layer-local pixels. A no-op Gradient Map or an
approximate Photo Filter changes every affected layer beneath it. Layer-local
fallback cannot preserve that result. The extreme EHS-395 and EHS-404
differences demonstrate the need for a cached preview attached to a compositing
scope (group/subtree/document), with a source fingerprint and explicit
invalidation rules. Until the native adjustment is supported, the cached scope
is visual authority; semantic descriptors remain authoritative for future
editing/recovery.

This should be one generic render-island/cache contract, not one special case
per PSD adjustment type.

### Mask preservation is incomplete

The importer prefers Photoshop's rasterized `realMask` when present and keeps
the vector path descriptor, but LightTable exposes a single mask slot. PSD can
have a user mask and vector mask simultaneously. Native storage needs either a
mask stack or an explicit combined-mask source contract before both can remain
independently editable.

## Proposed decision order

1. **P0 - Native raster bounds contract.** Version the native manifest and
   persist local raster dimensions/offsets. Verify ordinary, off-canvas,
   oversized and transformed tight layers through save/reopen/export.
2. **P0 - Generic retained-preview contract.** Define semantic source,
   derived preview, source/render fingerprints, invalidation and explicit bake
   behavior once for text/vector/smart-object recovery.
3. **P0 - Scope/render-island fallback.** Preserve the visual result of
   unsupported adjustment/group stacks without pretending the adjustment is a
   layer-local bitmap.
4. **P1 - Missing-font recovery and desktop fonts.** Execute Tasks 048 and 046
   using the generic preview contract. The corpus gives 81 real text layers and
   28 font families as acceptance data.
5. **P1 - Adjustment parity.** Implement Gradient Map first, then calibrate
   Photo Filter, Color Balance, Hue/Saturation and Brightness/Contrast against
   Photoshop fixtures. This targets the two worst documents directly.
6. **P1 - Mask stack.** Preserve user and vector masks independently, with a
   cached combined result where needed.
7. **P2 - Smart-object source package.** Retain embedded object bytes or a
   resolvable linked reference plus preview; add semantic opening only after the
   storage/security contract is defined.
8. **P2 - Vector stroke/style fidelity.** Complete stroke alignment, joins,
   caps, gradient/pattern paint and active style calibration using focused
   fixtures rather than template-specific exceptions.
9. **Baseline UI - Layers tree geometry.** Fix inconsistent row/thumbnail
   sizing separately from PSD semantics before layer-by-layer visual review.

No feature implementation should start from this list until the priority and
canonical contracts above have been reviewed.

## Audit limitations and remaining evidence

- Produce solo and dependency-context captures for representative high-risk
  adjustment, mask, style, vector-stroke, smart-object and off-canvas layers.
- Re-run the LightTable compatibility-dialog capture after the packaged desktop
  automation startup regression is resolved; the existing diagnostic logs
  already contain the per-layer support summaries used here.
- Add separate corpora for clipping masks, text on path, warped text,
  gradient/pattern fill layers and smart filters; these ten templates do not
  exercise them.
