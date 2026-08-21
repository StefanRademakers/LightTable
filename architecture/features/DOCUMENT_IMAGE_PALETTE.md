# Document image palette

Status: implemented, 2026-08-21.

## Product contract

LightTable can derive a representative palette from the current final document
composite for both human color selection and read-only agent analysis. The
Color Picker requests 16 colors when it opens. MCP requests 1-256 colors through
`lighttable_palette`. Neither document loading nor normal render invalidation
starts palette work.

Both consumers use the same `DocumentPaletteExtractor`; MCP does not own a
second quantizer and the Color Picker does not decode a preview image.

## Pixel and color contract

The renderer samples a deterministic grid of at most 65,536 texels from its
final display-encoded composite, before editor overlays. Its sampling shader
uses `textureLoad`, so it performs no bilinear/bicubic interpolation. Documents
with at most 65,536 pixels contribute every pixel. Alpha values below 13/255
are ignored.

The CPU implementation then:

1. builds an exact 8-bit RGB frequency histogram;
2. converts unique colors to OKLab;
3. performs deterministic frequency-weighted K-Means++-style initialization
   and at most 16 weighted Lloyd iterations;
4. ranks clusters by sampled coverage;
5. returns the most frequent actual RGB member of each cluster, never the
   synthetic centroid;
6. tries a cluster's next real candidate when representatives are perceptually
   near-duplicates.

Every returned RGB value therefore exists in the sampled final composite.
Fully transparent documents return no colors; solid documents return one.

## Cache and revision ownership

Each mounted document owns one lazy extractor. The exact histogram/OKLab data
is cached by canonical document revision, while each requested color count has
its own clustering result. A revision change invalidates both caches without
performing work. UI and MCP requests reject a result if the document changes
during GPU readback or clustering.

## External boundary

`lighttable_palette` is read-only and requires:

- stable `documentId`;
- exact `expectedDocumentRevision`;
- `colorCount` from 1 through 256 (default 16).

It returns RGB, hex, cluster coverage, representative sample frequency and
OKLab values. No image bytes, LUTs or layer implementation details cross the
MCP boundary.

## Evidence

- deterministic algorithm/unit coverage includes solid, weighted two-color,
  transparency, real-source-color, supported K values and revision caching;
- desktop Agent Access and MCP server tests cover read-only routing;
- packaged Color Picker smoke opens a real image, waits for the on-demand
  palette and verifies 1-16 visible swatches without WebGPU/page errors;
- the shared popover now observes content resizing so asynchronous palette
  rows remain inside the viewport.
