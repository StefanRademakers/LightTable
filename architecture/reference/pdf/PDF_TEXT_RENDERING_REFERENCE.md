# PDF text rendering reference for LightTable

Status: implementation research, not a canonical architecture contract.

This note records the parts of the PDF imaging model that are useful when
designing native GPU text for LightTable. PDF is a fixed-layout page-description
format, not a text-authoring model. Its rendering rules are therefore a useful
reference for glyph realization, positioning and painting, but not a replacement
for Unicode shaping, paragraph layout, selection or editing semantics.

## Sources

- [ISO 32000-2:2020 (PDF 2.0) sponsored access](https://pdfa.org/sponsored-standards/)
  is the current specification. The PDF Association bundle includes accumulated
  errata and is periodically updated; the download may require the association's
  zero-cost checkout flow.
- [Adobe PDF 32000-1:2008 / PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
  is freely and directly available and was inspected for the clause references
  below.
- [Public PDF specification errata](https://pdf-issues.pdfa.org/) should be checked
  before treating wording from either edition as an implementation oracle.

Last checked: 2026-08-02.

Do not vendor the ISO bundle or the 22 MB Adobe PDF into the repository by
default. Keep this implementation-focused note versioned and use the official
links as source of truth.

## Relevant clauses in PDF 32000-1:2008

### 9.1-9.2: characters, glyphs and fonts

PDF distinguishes an abstract character from its graphical glyph. Glyphs are
font-provided graphics whose outlines participate in ordinary coordinate
transforms and graphics operations. The specification explicitly notes that an
efficient implementation can cache and reuse previously realized glyphs.

LightTable consequence: canonical text and derived glyph realizations must be
separate. A `TextLayer` stores characters and styles; a shaping/layout result
stores glyph IDs, clusters, advances and positions; GPU resources cache outlines,
coverage and painted tiles without entering the document model.

### 9.2.4: positioning and metrics

Glyph advance is distinct from visible outline bounds. Horizontal and vertical
writing use displacement vectors, origins and metrics. Glyph space is normally
mapped to text space in 1/1000 units; Type 3 fonts provide an explicit font
matrix.

LightTable consequence: never infer caret positions, selection bounds or line
layout from raster bounds. Preserve advances, cluster boundaries, baselines,
glyph origins and ink bounds as different values in the layout contract.

### 9.3: text state and rendering modes

PDF text state includes character spacing, word spacing, horizontal scaling,
leading, font, font size, rendering mode, rise and knockout. Rendering modes
support fill, stroke, fill-then-stroke, invisible text and variants that add
glyph outlines to the clipping path. Stroke settings are interpreted in user
space. When fill and stroke are combined, glyphs are painted in sequence rather
than merging all outlines into one shape first.

LightTable consequence:

- character paint and layer styles are different stages;
- baseline shift/rise belongs to layout, not to the layer transform;
- fill/stroke order should be explicit in character style;
- a future text-as-clipping-path feature can reuse vector path semantics;
- overlapping translucent glyphs need a declared knockout/compositing policy.

### 9.4: text matrices and showing glyphs

PDF keeps a text matrix and text-line matrix. The conceptual text rendering
matrix combines font size, horizontal scale, text rise, the text matrix and the
graphics current transformation matrix. It is evaluated per glyph. Text-showing
operators then update the position from glyph advance, character/word spacing
and optional per-run positioning corrections.

LightTable consequence: expose one immutable per-glyph realization contract:

```ts
interface PositionedGlyph {
  fontFaceId: string;
  glyphId: number;
  clusterStart: number;
  clusterEnd: number;
  origin: { x: number; y: number };
  advance: { x: number; y: number };
  glyphToLayer: AffineMatrix;
  inkBounds: Rect;
}
```

The WebGPU backend consumes this contract in batches. Viewport pan and zoom are
not part of `glyphToLayer`; they remain presentation state.

### 9.5-9.9: font kinds, CMaps and embedding

PDF supports simple fonts, Type 0 composite fonts backed by CIDFonts, Type 1,
TrueType, CFF/OpenType and Type 3 fonts. Composite fonts use CMaps to translate
variable-length character codes to CIDs. Embedded fonts provide the most
predictable result, but font licensing may prohibit embedding or permit it only
for viewing and printing. A subset can also omit tables needed for authoring.

LightTable consequence:

- font identity, font bytes and font licensing/embedding permission are separate
  asset properties;
- an embedded font recovered from an imported PDF must not automatically become
  an editable project font;
- CFF and TrueType outlines can feed the same GPU coverage backend after parsing;
- Type 3 glyph programs require a bounded PDF graphics interpreter and are not a
  normal font-outline path. Initially they should render through an imported PDF
  preview or a sandboxed PDF renderer;
- font-subset presence does not guarantee that the font can reshape newly edited
  text.

### 9.10: Unicode extraction

PDF character codes and glyph IDs do not inherently identify Unicode text.
`ToUnicode` CMaps and replacement text provide that mapping when available, and
ligature glyphs may map to multiple Unicode scalars.

LightTable consequence: preserve the authored Unicode string and grapheme/cluster
mapping independently from glyph IDs. Never reconstruct editable text from glyph
IDs alone. PDF import needs an explicit native/editable, visually rendered and
preserved-only status, following the Photoshop interchange parity model.

## Proposed LightTable realization boundary

```text
Unicode text + character/paragraph runs
    -> shaping, bidi and line composition
    -> positioned glyphs with cluster mapping
    -> cached glyph outline resources
    -> WebGPU coverage tiles
    -> fill/stroke character paint in linear premultiplied colour
    -> local processing / warp
    -> mask, layer styles, clipping and ordinary compositing
```

PDF reinforces the boundary from positioned glyphs onward. The stages before
that boundary remain LightTable authoring responsibilities and should use a
dedicated shaping/layout engine rather than PDF operators, CSS layout,
`CanvasRenderingContext2D.measureText()` or SVG text.

## Cache implications

Use separate revision keys for:

1. font bytes, face index and variation coordinates;
2. Unicode content, script, language, direction and OpenType features;
3. paragraph constraints and line composition;
4. positioned glyph geometry and effective raster scale;
5. character paint;
6. downstream processing, mask and layer styles.

Glyph outlines and metrics can be shared across documents. Positioned runs are
layer-owned. Coverage/output tiles are document-renderer resources with explicit
byte estimates, eviction, submission retention and device-loss teardown.

## What not to copy from PDF

- PDF text strings are encoded show operations, not a canonical editable string.
- PDF does not define an interactive paragraph composer or editing transaction
  model.
- PDF's font substitution rules are deliberately implementation-dependent when
  font programs are absent; LightTable needs deterministic fallback plus a
  visible missing-font state.
- A PDF text object is not equivalent to a LightTable layer. Layer transforms,
  masks, effects, warp, history and cache invalidation remain governed by the
  LightTable document and render contracts.
