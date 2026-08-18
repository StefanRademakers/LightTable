# PSD/PSB export scope

Status: PSD release candidate implemented, 2026-08-05; PSB remains gated.

LightTable now writes two explicit 8-bit RGB PSD intents through the Export
submenu. `Save LightTable` remains the native editable save operation; neither
PSD export replaces it or marks the native document clean.

## First export milestone

The release-candidate writer targets PSD version 1 and always writes a valid
merged composite. It may emit only features for which LightTable has a tested,
canonical representation and a Photoshop reopen oracle:

- 8-bit RGB documents within PSD v1 dimension limits;
- ordered groups and raster layers, including layer-local bounds outside the
  canvas, visibility, opacity, fill opacity and supported blend modes;
- raster and vector masks whose coordinate mapping is lossless;
- supported native vector paths with solid fill/stroke semantics;
- supported flow text only when runs, transforms, paragraph data and font
  references survive Photoshop reopen without a semantic downgrade;
- supported layer effects only after descriptor and rendered parity gates pass.

The Editable writer is fail-closed. Unsupported native adjustment layers, smart objects,
patterns, gradients, effects, text constructs, color modes or interleaving
are collected during projection and stop the current editable export.

A Curves-only native Grade Layer is the first verified compound-layer
decomposition. It becomes a collapsed pass-through folder at the exact tree
position with one editable Photoshop Curves child. Pass-through is required so
the child affects the same lower sibling composite as the LightTable processing
layer. This adapter accepts only default opacity, fill, blend, clipping and a
pristine white mask; it omits that no-op mask to avoid forcing Photoshop group
isolation. Any other authored Grade module or boundary remains fail-closed.

Maximum Appearance is the explicit alternative. It writes the authoritative
rendered composite as one full-canvas raster layer named `LightTable Appearance`
and retains no active Grade, Lens FX, adjustment, mask or layer descriptor that
could apply processing twice. It deliberately sacrifices layer editability and
uses an `-appearance.psd` filename suffix. Layer assets and LUT assets are not
read back for this intent, because the one canonical composite is its complete
contract.

## Preservation and round-trip policy

Imported PSD descriptors and source bytes are evidence and fallback carriers;
they are not renderer authority and must not be copied into a newly authored
PSD unless their owner layer is unchanged and the descriptor has a bounded,
tested passthrough rule. Once an authoritative edit invalidates such a carrier,
export either regenerates the construct from the canonical model or reports it
as unsupported.

Every export test must verify four independent axes after reopening in
Photoshop and LightTable:

1. visual composite parity;
2. structural layer/group parity;
3. semantic editability of supported objects;
4. a second save/reopen round trip without drift.

Layer-local bounds, affine pivots, masks, clipping chains, fill opacity and
effect bounds are mandatory fixtures. Off-canvas pixels may only be clipped by
the final document composite, never discarded from layer data.

## PSB boundary

PSB version 2 is a separate milestone. It is not enabled merely by changing
the file header: large-document lengths, keys and safety budgets differ. PSB
export remains unavailable until representative large-dimension, large-layer
and reopen fixtures pass. LightTable may continue imposing stricter resource
limits than Photoshop when those limits are disclosed before opening/export.

## UI wording

- `Save LightTable`: editable native document.
- `Quick Export PNG`: flattened PNG deliverable.
- `Export PDF`: current preflighted PDF modes.
- `Photoshop PSD (Editable)...`: enabled for ready documents and runs the same
  fail-closed semantic projection used by command automation.
- `Photoshop PSD (Maximum Appearance)...`: writes one exact rendered layer and
  never presents that flattened result as editable parity.

The runtime format-capability registry, File menu and Format Support dialog
must derive the same availability and limitation text. Documentation alone
must never make PSD/PSB export appear enabled.
