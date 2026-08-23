# LightTable AI Import — TODO

## Goal

Add first-class Adobe Illustrator `.ai` import to LightTable without routing through SVG or using lossy conversion hacks.

Target architecture:

```text
.ai
 ↓
AI/PDF Parser
 ↓
AI Import Model
 ↓
Normalization
 ↓
LightTable Vector DOM
 ↓
WebGPU Renderer
```

The renderer should never need to know whether vector content originated from AI, PDF, SVG, EPS, or another format.

---

## 1. Define the Common Vector Import Model

Create a format-neutral intermediate representation used by all vector importers.

Suggested shape:

```ts
interface ImportedVectorDocument {
  artboards: ImportedArtboard[];
  root: ImportedNode;
  resources: ImportedResources;
  colorSpace: "RGB" | "CMYK" | "Gray" | "Mixed";
  metadata?: Record<string, unknown>;
}
```

Node types should cover at least:

- Group
- Path
- Compound path
- Text
- Image
- Clip group
- Mask group
- Unknown / unsupported node

### TODO

- [ ] Define `ImportedVectorDocument`
- [ ] Define node hierarchy
- [ ] Define transform representation
- [ ] Define path command representation
- [ ] Define fill/stroke model
- [ ] Define gradient model
- [ ] Define clipping/masking model
- [ ] Define blend mode and opacity model
- [ ] Define text representation
- [ ] Define raster resource representation
- [ ] Define color-space metadata
- [ ] Define spot-color / swatch representation
- [ ] Define extensible metadata fields

---

## 2. AI File Detection

Modern `.ai` files are commonly PDF-compatible files with Illustrator-specific private data.

The importer should inspect the file rather than assuming one encoding.

### TODO

- [ ] Detect PDF-based AI files
- [ ] Detect legacy EPS/PostScript AI files
- [ ] Read Illustrator version metadata where possible
- [ ] Gracefully reject unsupported/corrupt files
- [ ] Add file capability report for debugging

---

## 3. Choose the PDF Parsing Foundation

Prefer a mature parser rather than implementing PDF syntax from scratch.

Primary candidate to evaluate:

- PDFium

Other references:

- Poppler
- MuPDF
- Illustrator-specific open-source parsers for research/reference

### TODO

- [ ] Evaluate PDFium licensing for commercial distribution
- [ ] Verify Windows/macOS/Linux support
- [ ] Verify Electron/native integration strategy
- [ ] Verify WASM feasibility if useful
- [ ] Benchmark parse time on large Illustrator documents
- [ ] Check access to raw PDF object tree
- [ ] Check access to content streams
- [ ] Check image extraction
- [ ] Check font/text extraction
- [ ] Check transparency groups
- [ ] Check shadings / gradients
- [ ] Check clipping paths
- [ ] Check ICC/color-space handling

---

## 4. Parse PDF Artwork Directly

Map PDF drawing operations into the common vector import model.

### Geometry

- [ ] Move / line / cubic Bézier paths
- [ ] Closed/open subpaths
- [ ] Compound paths
- [ ] Fill rules
- [ ] Rectangular primitives when detectable

### Paint

- [ ] Solid fills
- [ ] Solid strokes
- [ ] Stroke width
- [ ] Line caps
- [ ] Line joins
- [ ] Miter limit
- [ ] Dash arrays
- [ ] Dash offset

### Transforms

- [ ] Current transformation matrix
- [ ] Nested transforms
- [ ] Object-space vs document-space conversion

### Transparency

- [ ] Object opacity
- [ ] Group opacity
- [ ] Blend modes
- [ ] Transparency groups

### Clipping

- [ ] Clip paths
- [ ] Nested clip paths
- [ ] Clip path fill rules

### Images

- [ ] Embedded raster image extraction
- [ ] Image transforms
- [ ] Alpha masks
- [ ] Image clipping

---

## 5. Gradients and Shadings

This should map to native LightTable gradient objects wherever possible.

### TODO

- [ ] Linear gradients
- [ ] Radial gradients
- [ ] Gradient transforms
- [ ] Gradient alpha
- [ ] Multiple stops
- [ ] Spread behavior if present
- [ ] PDF axial shading
- [ ] PDF radial shading
- [ ] Investigate mesh shading support
- [ ] Define native LT representation for mesh gradients

Do not flatten simple gradients into geometry or raster data.

---

## 6. Illustrator Private Data

Parse Illustrator-specific metadata separately from the PDF artwork layer.

Use it to restore semantics that are not fully represented by the PDF object tree.

### Target data

- [ ] Artboards
- [ ] Layer names
- [ ] Layer hierarchy
- [ ] Object names
- [ ] Swatches
- [ ] Spot colors
- [ ] Document color settings
- [ ] Editable text metadata
- [ ] Illustrator appearance information
- [ ] Brush information
- [ ] Gradient mesh metadata
- [ ] Document metadata

The private-data parser should enrich the imported document, not replace the PDF artwork parser.

---

## 7. Layer Reconstruction

The resulting LightTable document should preserve meaningful Illustrator structure where available.

### TODO

- [ ] Map Illustrator layers to LT layers/groups
- [ ] Preserve visibility state
- [ ] Preserve layer names
- [ ] Preserve nested groups
- [ ] Preserve clipping groups
- [ ] Preserve object ordering
- [ ] Preserve artboard association
- [ ] Handle unnamed/generated groups cleanly

---

## 8. Text

Text should remain editable whenever it can be reconstructed reliably.

### First pass

- [ ] Extract text content
- [ ] Extract position
- [ ] Extract transform
- [ ] Extract font family
- [ ] Extract font size
- [ ] Extract fill/stroke
- [ ] Extract character spacing
- [ ] Extract line spacing where available
- [ ] Preserve text objects as text

### Later

- [ ] Paragraph text
- [ ] Text on path
- [ ] Per-character formatting
- [ ] OpenType features
- [ ] Font substitution handling
- [ ] Missing-font reporting

If text cannot be reconstructed reliably, define an explicit fallback policy rather than silently corrupting layout.

---

## 9. Color Management

AI files may contain RGB, CMYK, Gray, ICC profiles, spot colors, and mixed color spaces.

### TODO

- [ ] Preserve source color-space metadata
- [ ] Parse RGB
- [ ] Parse CMYK
- [ ] Parse Gray
- [ ] Parse ICC-based color
- [ ] Parse spot/separation colors
- [ ] Preserve named swatches
- [ ] Convert to LT working/display space correctly
- [ ] Avoid premature destructive RGB conversion

---

## 10. Unsupported Features Policy

Unsupported features must be explicit.

Priority:

1. Preserve native editability when supported.
2. Preserve appearance when semantics cannot yet be reproduced.
3. Avoid rasterizing the whole document because of one unsupported object.

### TODO

- [ ] Define `ImportedUnsupportedNode`
- [ ] Attach original object metadata
- [ ] Add diagnostic reason
- [ ] Support local/object-level fallback rendering where necessary
- [ ] Surface import warnings in debug/dev tools
- [ ] Never silently discard content

---

## 11. Normalization Layer

Keep parser-specific behavior out of the LightTable document model.

```text
AI/PDF parser
      ↓
ImportedVectorDocument
      ↓
normalizeVectorDocument()
      ↓
LightTable Vector DOM
```

### TODO

- [ ] Normalize coordinate systems
- [ ] Normalize units
- [ ] Normalize transforms
- [ ] Normalize winding/fill rules
- [ ] Normalize colors
- [ ] Normalize gradients
- [ ] Normalize clipping/masks
- [ ] Resolve resource references
- [ ] Normalize layer ordering
- [ ] Validate resulting scene graph

---

## 12. Renderer Gaps

Compare imported AI requirements with the current SVG/vector renderer.

Current renderer already appears to support much of the required base:

- Paths
- Bézier curves
- Fills
- Strokes
- Compound paths
- Fill rules
- Transforms
- Linear/radial gradients
- Patterns
- Clipping
- Masks
- Opacity
- Reuse
- Nested vector scenes

### TODO

- [ ] Add blend-mode tests
- [ ] Add transparency-group tests
- [ ] Add raster placement tests
- [ ] Add CMYK conversion tests
- [ ] Add spot-color tests
- [ ] Add text renderer tests
- [ ] Add mesh-gradient tests
- [ ] Add complex clipping regression tests

---

## 13. Test Corpus

Create real Illustrator files specifically designed for importer regression testing.

### Files

- [ ] Basic paths
- [ ] Compound paths
- [ ] Strokes
- [ ] Dashed strokes
- [ ] Linear gradients
- [ ] Radial gradients
- [ ] Transparency
- [ ] Blend modes
- [ ] Clipping
- [ ] Masks
- [ ] Nested groups
- [ ] Artboards
- [ ] Layers
- [ ] Embedded images
- [ ] Text
- [ ] CMYK
- [ ] Spot colors
- [ ] Gradient mesh
- [ ] Brushes
- [ ] Appearance stack
- [ ] Large real-world illustration

For every source file, store a trusted Illustrator reference render.

---

## 14. Automated Visual Regression

Use automated image comparisons for import correctness.

```text
.ai
 ↓
LightTable import
 ↓
LT render
 ↓
reference comparison
```

### TODO

- [ ] Reference PNG render generation
- [ ] Deterministic LT rendering
- [ ] Pixel-difference test
- [ ] Perceptual-difference metric
- [ ] Threshold configuration
- [ ] Difference heatmap
- [ ] CI regression suite

Also test document structure separately; pixel-perfect output alone is not enough.

---

## 15. Performance

AI import should remain practical for large professional documents.

### TODO

- [ ] Profile parsing
- [ ] Stream file reading where possible
- [ ] Avoid unnecessary rasterization
- [ ] Deduplicate shared resources
- [ ] Cache fonts/images/gradients
- [ ] Avoid expanding geometry unnecessarily
- [ ] Lazy-load expensive resources where possible
- [ ] Benchmark 10 MB / 100 MB / 500 MB documents

---

## 16. Definition of Done — V1

A normal modern Illustrator document containing:

- multiple artboards
- layers/groups
- paths
- compound paths
- solid fills
- strokes
- linear/radial gradients
- clipping paths
- opacity
- common blend modes
- embedded images
- basic text

can be opened directly in LightTable while preserving its useful editable structure and producing a visually close match to Illustrator.

No SVG conversion step should exist in the production AI import path.

---

## Recommended Implementation Order

1. Common Vector Import Model
2. PDFium feasibility/prototype
3. PDF path/fill/stroke import
4. transforms + clipping
5. gradients
6. transparency + blend modes
7. images
8. artboards/layers
9. Illustrator private metadata
10. text
11. color management
12. complex Illustrator-specific objects
13. performance and regression corpus
