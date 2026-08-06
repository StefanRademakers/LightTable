# Missing-font recovery

Status: **current** for editable flow text. Positioned source-glyph text remains
selectable and diagnosable but requires conversion before character editing.

## Contract

Font discovery is read-only. Every flow style run resolves to `exact`,
`substituted` or `missing` from its authored family, PostScript face, preferred
fingerprint, weight, stretch and italic state. A stable source identity is made
from those original values and does not depend on layer order or run index.
Mixed runs therefore remain independently recoverable.

Accepting a replacement updates the current editable face and metrics while
persisting:

- the original family/PostScript/preferred-face request;
- the original weight, stretch and style;
- the accepted replacement face and fingerprint.

Normal authoring through the Text controls intentionally clears that recovery
provenance: it is a new font choice, not recovery of imported metadata.

## Interaction and history

The layer warning badge and compatibility report lead to the standard recovery
dialog. The shared searchable font picker exposes individual bundled, document
and desktop-system faces. Selecting a candidate previews the exact semantic
text without adding history. Cancel restores the retained import preview and
source snapshot. Replace records one document history entry; Undo and Redo
restore the complete source/provenance atomically. Manage groups by stable
source identity, so two styles with the same family label cannot be conflated.

A stale retained bitmap is allowed only as a visual fallback while exact text
is unavailable or rebuilding. The compositor prefers exact semantic text as
soon as its source is published. Replacement never deletes the retained source
bitmap. This also gives a reopened document a safe visual fallback on a machine
that cannot supply the selected desktop font.

## Bounds and lazy desktop fonts

Native documents accept at most 4,096 font metadata references and at most 256
portable/embedded faces. System catalog records are metadata-only and do not
consume the embedded-face quota. The desktop byte provider is lazy; the text
coordinator requests bytes only for faces referenced by visible text. Debug
telemetry reports that referenced-face count and the actual resident font-byte
total rather than the complete system catalog size.

## Interchange

The native format persists replacement provenance without a compatibility
branch. PSD export writes the accepted current PostScript face into editable
Photoshop type data; LightTable-only original provenance remains available for
future recovery. Restricted system fonts are never silently embedded.

## Verification

`npm run smoke:desktop:missing-font-recovery` creates a deterministic PSD with
an unavailable PostScript face and verifies Preview, Cancel, Replace, Undo and
Redo in the packaged desktop app. It also records first recovery latency,
resident font bytes, shaping latency, GPU memory and renderer errors under
`tmp/missing-font-recovery-smoke/`.

The 2026-08-06 verification measured one referenced face, about 0.3 MiB resident
font data and a 0.66 ms latest shaping round trip. The general paragraph smoke
measured cached-source input-to-submit p95 52.0 ms and GPU p95 75.4 ms; this is
not a missing-font regression but remains covered by the text performance work.
Unit coverage includes missing family/face, mixed styles, deterministic face
matching, variable metadata, more than 256 lazy system references, native
reopen without replacement bytes, retained fallback, and editable ag-psd
roundtrip output.
