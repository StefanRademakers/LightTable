# Layered interchange release matrix

Status: current release evidence and explicit alpha boundary. The generated
machine authority is
[`contracts/LAYERED_INTERCHANGE_RELEASE_MATRIX.json`](contracts/LAYERED_INTERCHANGE_RELEASE_MATRIX.json).

## Purpose

One matrix now follows every canonical layered capability across creation,
import, editing, undo, native save/reopen, PSD export/reopen and visual parity.
The generator reads the current layer union, blend registry, layer-style union,
processing-module registry and vector/paint discriminants. Adding a canonical
capability without adding a matrix policy therefore fails the generator test.

The four statuses have narrow meanings:

- **supported**: the semantic payload is authoritative and the named gate proves
  the workflow;
- **partial**: native semantics exist, but an interchange or visual subset is
  narrower and named explicitly;
- **preserved**: source metadata and/or a current bounded preview survive, but
  are not falsely presented as editable semantics;
- **unavailable**: there is no implicit conversion; the reason identifies the
  required adapter or destructive user action.

## Current inventory

The generated matrix currently covers 5 layer kinds, 26 blend modes, 10 layer
style kinds, 20 processing modules, native/off-canvas geometry, masks,
clipping, fill opacity, vector elements, six live shapes, solid/gradient vector
paint, solid/noise gradient assets and retained unsupported previews. It has 79
capability rows; use the JSON rather than copying that list into another
document.

## Evidence model

Dependency-sensitive rows require both views:

- a **solo** settled render, useful for the layer/effect's own pixels;
- a **context** settled render with parents, masks, clipping, blend and relevant
  lower layers intact.

`scripts/verify-layered-interchange-evidence.mjs` rejects stale generated
matrix data, semantic signature changes, failed/runtime-error cases, missing or
flat captures and zero-sized comparisons. The release evidence is:

- all 26 blend modes plus six opacity/fill variants, and 48 strict
  color-profile/blend cases;
- 40 strict Photoshop layer-style cases with import and PSD self-roundtrip;
- the ten-template production inventory plus ten settled contextual captures;
- LightTable PSD export/reopen and Photoshop acceptance/rewrite/reopen.

The Photoshop import report remains the user-facing truth surface. Its native,
approximate, preserved, raster-preview and placeholder terms are intentionally
more useful to a designer than internal audit terminology. The matrix consumes
the same canonical support boundary; it does not add test jargon to tool panels.
A derived text/vector preview is never authority and is usable only while its
semantic dependency key is current.

## Release interpretation

Raster layers and the verified blend subset form the strongest bidirectional
PSD path. Groups, masks, clipping chains, fill/effect interaction, text,
vectors/gradients, styles and adjustment projections are deliberately marked
partial where Photoshop semantics or pixels are not universal. Smart objects
and other unsupported constructs retain descriptors and previews rather than
silently becoming editable raster layers.

All canonical blend modes are semantically mapped. `Darker Color` remains the
one declared visual-partial mode: its current settled corpus result is RMSE
3.05 against the Photoshop reference, just outside the release threshold 3.

This audit does not implement those missing adapters. The evidence prioritizes
Tasks 091–093: text/vector/gradient interchange breadth, dependency-sensitive
composition, and effects/adjustment parity. A feature may move from partial to
supported only by updating its executable evidence, regenerating the JSON and
passing the parity profile.

## Commands

```text
npm run generate:interchange-matrix
npm run verify:interchange-matrix
node scripts/verify-layered-interchange-evidence.mjs
npm run quality:agent -- --profile parity
```
