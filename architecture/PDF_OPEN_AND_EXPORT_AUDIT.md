# PDF open and export audit

Status: current behavior and product decisions, 2026-08-04.

## Open

The production route lazily opens PDF.js, renders page 1 at a bounded target of
300 ppi and creates one raster-backed LightTable canvas. The original PDF bytes
are preserved as an immutable source asset. The source description states
`Page 1 of N`; the layer is not presented as editable PDF structure.

Current limits are explicit:

- encrypted files are detected by PDF.js but there is no password-entry flow;
- page selection is not implemented, and opening a multipage PDF chooses page
  1 rather than creating hidden or implicit LightTable pages;
- AcroForms, annotations, optional content, text and vectors contribute to the
  rendered page preview but are not canonical editable objects;
- the normalized semantic display-list contracts remain research/adapter
  infrastructure until a production parser can preserve resource and graphics
  state without format-specific authority leaking into the renderer.

A 2026-08-04 deterministic sample of 40 files from the local 974-file upstream
PDF.js corpus passed first-page loading with zero unexpected failures. Earlier
full-corpus evidence records 198 spread samples, zero unexpected failures and
two password-protected files correctly classified separately. The product work
still required before selectable semantic PDF import is password UI, page
thumbnail/range selection and a document/page ownership model.

## Export

PDF export is deliberately a preflight, not a generic Save PDF command. It
always creates exactly one page from the current LightTable canvas; the dialog
states that unopened pages from a source PDF are not included.

The flattened writer is the fidelity fallback. Native searchable text and
native vector output are permitted only as an ordered topmost suffix above one
GPU-rendered raster underlay. The planners fail closed when they encounter:

- unsupported or stale text/font plans, unavailable embedding bytes or
  embedding restrictions;
- unsupported vector paint/stroke/alignment, clipping, masks, ancestor effects
  or isolated group semantics;
- raster/processing content interleaved above the native suffix;
- document-wide Grade or Lens Fx processing that the native suffix would evade;
- unsupported transparency/compositing or a stale document revision.

The preflight reports why native output is unavailable and retains flattened
export. Font validation is bounded and lazy. PDF-lib and PDF.js independently
reopen native writer fixtures; packaged evidence covers raster-underlay plus
native text, vector and mixed suffixes. General multi-page export, arbitrary
interleaving and full semantic PDF round trip remain future capabilities and
must not be inferred from this one-page deliverable.
