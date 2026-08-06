# Unsupported-feature and recovery contract

LightTable never turns unsupported interchange semantics into silent success.
The canonical document retains original source metadata and bounded visual
previews; the compatibility projection explains what is editable and what a
destructive choice would discard.

## Finding vocabulary

`documentCapabilityFindings.ts` is the UI-neutral normalization boundary. Every
finding has a document/layer target, feature, severity, editability and safe
actions. The five product statuses are:

- **exact** — native visual and semantic handling; informational only;
- **approximated** — editable output with a known fidelity difference;
- **preview-backed** — retained pixels remain visual authority while source
  metadata is preserved; an authoritative edit invalidates that preview;
- **missing asset** — a required font/resource is unavailable;
- **export-blocking** — editable interchange cannot preserve the construct.

The final status is deliberately more severe than preview-backed when a source
is both visually retained and impossible to round-trip. Independent parity
axes remain stored on the import report.

## Allowed recovery

Recovery is explicit and bounded: keep a retained preview, replace a missing
font, rasterize an explicit copy, remove an unsupported effect, cancel export,
or export a flattened artifact. The report renders only actions backed by the
current controller. PDF export decisions stay in PDF preflight; layer-style
removal stays in Layer Styles. The report never invents a generic mutator.

Selecting an affected layer is separate from choosing a missing font. This
prevents a navigation action from accidentally entering text edit mode and
invalidating a retained preview. Layer badges are compact links to the report,
not dormant effect rows.

## Preservation and privacy

`DerivedLayerPreview.dependencyKey` binds retained pixels to the semantic
payload. Native LightTable persistence retains preview/source descriptors and
preserved PDF bytes; supported edits invalidate only their derived preview.
The report states this before a user follows a destructive workflow.

Compatibility diagnostics remove absolute local paths and control characters
and are bounded to 500 characters before display/copy. Layer names, feature
names and concise reasons remain useful; full document content and source
paths are not support telemetry.

PDF open currently produces a first-page raster preview plus immutable source
bytes. It is reported as export-blocking/preview-backed rather than editable
text or vector structure. Flattened/native-suffix decisions remain fail-closed
in PDF export preflight.

## Verification

Normalization tests cover each status/action, missing fonts, source-path
redaction and message bounds. PSD report, missing-font recovery, PDF open,
PDF preflight, retained-preview dependency, layered save/reopen and desktop
accessibility smokes are the release evidence. A fully supported document has
zero findings needing attention and no layer warning badge.
