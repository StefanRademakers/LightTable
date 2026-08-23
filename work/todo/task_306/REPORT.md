# VORTEXT warm first-useful-pixel pass

## Outcome

`VORTEXT.SVG` now presents useful document pixels in under 500 ms in a warm,
production-packaged LightTable Vello build. The editable canonical document is
still normalized through usvg and rendered through the retained Vello island;
the speedup does not replace or weaken that final document path.

The initial baseline was 1,343 ms. The verified five-run result is:

- minimum: 428 ms
- median: 445 ms
- maximum: 446 ms
- target: every sample strictly below 500 ms

## Product change

For an SVG that passes a conservative external-resource preflight, LightTable
first rasterizes the selected SVG through Chromium onto the already-warm GPU
canvas. This presentation is renderer-only state and never enters the
canonical document, history, save data, or React UI state. After the browser
has had a confirmed paint opportunity, the normal pipeline continues:

1. usvg normalization
2. SVG parse
3. editable canonical object construction
4. atomic document publication
5. retained render-island projection
6. Vello rendering and LightTable compositing

Inputs containing external/resource-bearing constructs, inline CSS, scripts,
foreign content, DTDs, entities, or uncertain URL syntax do not use the raw
preview. They remain on the normalized-only route.

## Measurement contract

One monotonic, document-scoped timeline records:

- file selection and bytes availability
- SVG parse and usvg normalization boundaries
- canonical object construction and document publication
- warm GPU adapter/device and Vello runtime readiness
- first source GPU queue/compositor submission
- first retained Vello island submission
- requestAnimationFrame, canvas presentation, and first visible pixel

`FIRST PIXEL VISIBLE` is recorded only after queue completion and a browser
paint opportunity between two animation frames. The packaged harness then
waits for the final canonical Vello island, captures the canvas, and rejects a
blank/non-useful image.

## Stability evidence

- Five close/reopen cycles, all below target.
- Every final canonical document used exactly one Vello island surface.
- GPU estimate was stable at 57,016,384 bytes for all five samples.
- Steady-state JS heap delta from the first completed cycle to the fifth was
  1,546,388 bytes after forced garbage collection.
- No page errors, renderer crashes, Vello failures, or console errors.
- Evidence: `tmp/quality-audit/warm-vortext-first-pixel/report.json` and the
  five adjacent canvas screenshots.

## Remaining performance fact

The editable Vello document becomes ready later than the first useful pixels:
roughly 1.0-1.25 seconds in these runs. The largest remaining costs are
canonical JS object construction and initial retained Vello scene projection.
That is future edit-readiness work; it no longer blocks visual feedback.
