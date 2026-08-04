# PSD/PSB export scope

Status: approved implementation contract, 2026-08-04.

LightTable does not currently write PSD or PSB. `Save LightTable` remains the
only editable native save operation. A future Photoshop deliverable is exposed
as `Export PSD`, never as `Save PSD`, until verified round-trip editing can
preserve every source construct without loss.

## First export milestone

The first writer targets PSD version 1 only and must always write a valid
merged composite. It may emit only features for which LightTable has a tested,
canonical representation and a Photoshop reopen oracle:

- RGB documents at 8 or 16 bits per channel within PSD v1 dimension limits;
- ordered groups and raster layers, including layer-local bounds outside the
  canvas, visibility, opacity, fill opacity and supported blend modes;
- raster and vector masks whose coordinate mapping is lossless;
- supported native vector paths with solid fill/stroke semantics;
- supported flow text only when runs, transforms, paragraph data and font
  references survive Photoshop reopen without a semantic downgrade;
- supported layer effects only after descriptor and rendered parity gates pass.

The writer is fail-closed. Unsupported adjustment layers, smart objects,
patterns, gradients, effects, text constructs, color modes or interleaving
must be listed before export. The user may explicitly choose a flattened PSD
deliverable, but LightTable must not silently rasterize individual unsupported
layers while presenting the result as editable parity.

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
- `Export PSD`: absent until the first milestone passes; when enabled it opens
  a compatibility preflight and never replaces the native save command.

The runtime format-capability registry, File menu and Format Support dialog
must derive the same availability and limitation text. Documentation alone
must never make PSD/PSB export appear enabled.
