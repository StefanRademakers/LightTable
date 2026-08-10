# LightTable GPU Text and Document-Text Architecture

**Status:** architecture and implementation advice  
**Audience:** AI coding agent working inside the LightTable repository  
**Priority:** high-performance native text editing, GPU rendering, PSD/PDF compatibility, and future text-on-path  
**Date:** 2026-08-02

---

## 0. Executive directive

Implement text as a **first-class native LightTable scene node**, not as HTML, CSS, SVG, Canvas2D, a browser text overlay, or a permanently rasterized image.

The visible text pipeline must remain LightTable-owned and GPU-first:

```text
canonical TextLayer
    -> font resolution
    -> shaping and paragraph/path layout in Rust/WASM or equivalent native core
    -> immutable positioned glyph runs
    -> LightTable-owned WebGPU glyph realization
    -> revisioned premultiplied source texture or direct vector realization
    -> existing RasterRenderContract
    -> existing processing, mask, Layer Style, clipping and compositor stack
    -> cached document content texture
    -> viewport presentation
    -> GPU editor overlays
```

The architecture must support two distinct text sources from the beginning:

1. **Flow text** — semantic Unicode text authored or edited in LightTable.
2. **Positioned text** — exact imported glyph runs, primarily for PDF and other fixed-layout formats.

Both source types must converge into one downstream `RealizedTextLayout` representation and one GPU renderer. Do not build separate PDF-text and editor-text renderers.

Open-source reuse is explicitly encouraged. Before building a complex subsystem from scratch, investigate whether a permissively licensed library can be integrated, compiled to WASM, wrapped behind a LightTable contract, or used as a reference implementation. Clone serious candidates into `.referenceCode/`, keep that directory out of Git, document licenses, and produce a measured integration spike before committing to a custom implementation.

---

## 1. Non-negotiable LightTable constraints

The implementation must follow the current architecture documents, especially:

- `architecture/RENDERING_AND_PROCESSING.md`
- `architecture/PERFORMANCE_CONTRACT.md`
- `architecture/VECTOR_SYSTEM.md`
- `architecture/DOCUMENT_AND_SCENE_MODEL.md`
- `architecture/contracts/SCENE_TRANSFORM_CONTRACT.md`
- `architecture/PHOTOSHOP_INTERCHANGE.md`
- `architecture/SYSTEM_MAP.md`

### 1.1 Rendering products remain separate

Text must respect the existing three-product model:

1. **Content rendering** evaluates text, layer-local processing, transforms, masks, Layer Styles, clipping and blending.
2. **Presentation rendering** samples the cached document content into the viewport.
3. **Editor overlays** render caret, selection, text boxes, baselines, path handles and other interaction feedback.

Text editing must not collapse these products back into one broad “redraw everything” path.

Examples:

```text
caret blink
    -> overlay dirty only

selection range changed
    -> overlay dirty only, unless editable glyph highlighting is implemented in source rendering

viewport pan or zoom
    -> presentation dirty only

text color changed
    -> text paint/source realization dirty, not shaping or paragraph layout

layer moved
    -> scene geometry/composite dirty, not shaping or layout

character inserted
    -> shaping + layout + text realization dirty
```

### 1.2 No second document model in the renderer

The canonical document owns serializable text semantics and revisions. It never owns:

- `GPUTexture`, `GPUBuffer`, pipelines or bind groups;
- WASM pointers or parsed font handles;
- browser `FontFace` objects;
- DOM ranges, elements or CSS measurements;
- cached glyph triangles;
- atlas page handles;
- PDF engine page handles.

Renderer and layout packages may own revisioned runtime realizations, but these must be reconstructible from canonical document state and document assets.

### 1.3 One transform authority

Every text layer stores one `localToParent` affine transform. Text layout happens in layer-local coordinates. The existing scene transform graph derives `localToDocument`.

Never store viewport transforms in text data. Never use DOM element positions to align rendered text. Pointer routing must follow:

```text
viewport/device -> document -> text-layer local
```

Rendering follows the reverse path.

### 1.4 Linear premultiplied renderer contract

Text realization enters the compositor using the same contract as other layer sources:

- explicit texture dimensions;
- layer-local and/or document bounds;
- source and geometry revisions;
- source-to-document transform;
- linear-sRGB working semantics;
- premultiplied alpha.

Do not return a naked texture as the subsystem boundary.

---

## 2. Product scope

The target is not merely “draw a string.” The architecture must support a progression toward Photoshop-class typography and robust interchange.

### 2.1 Required native authoring modes

- Point text.
- Paragraph/area text.
- Rich text runs within one text layer.
- Mixed fonts, weights, italics, sizes and colors.
- Tracking, kerning, leading and baseline shift.
- Horizontal and vertical scaling.
- Alignment and paragraph direction.
- Font fallback and missing-font reporting.
- Variable fonts and OpenType features.
- Text fill and optional native vector stroke.
- Existing LightTable masks, clipping, opacity, fill opacity, blend modes and Layer Styles.
- GPU caret, selection and frame overlays.
- Cached inactive-layer rendering.

### 2.2 Planned advanced modes

- Text on a Bézier path.
- Per-glyph transforms and imported fixed-layout text.
- Text-to-path.
- Warped text and envelope deformation.
- Vertical text.
- Color fonts and emoji.
- PSD text import/export.
- PDF page and text-object import/export.
- Possible SVG, AI, EPS and other vector/document interchange adapters.

The initial implementation may be staged, but the document model and package boundaries must not block these later modes.

---

## 3. Package topology

Create separate packages, matching the existing vector separation.

```text
packages/text-core
packages/text-layout
packages/text-rendering
packages/text-webgpu
packages/font-core
packages/font-wasm              optional if WASM needs its own package boundary
packages/document-text-import   optional shared import normalization layer
packages/pdf-import             later, adapter package
```

A smaller first landing may combine `font-core` into `text-layout`, but do not combine canonical text models with WebGPU resources.

### 3.1 `@lighttable/text-core`

Owns serializable text semantics and pure editing operations.

Responsibilities:

- `TextLayerData` and source variants.
- Rich-text style runs.
- Point, paragraph and path layout settings.
- Character- and paragraph-style mutation helpers.
- Stable range operations.
- Text edit commands and undo payloads.
- Serialization and migrations.
- Validation and normalization.
- Import status and preservation metadata.
- No DOM, WebGPU, PDF engine or WASM handles.

### 3.2 `@lighttable/text-layout`

Owns backend-neutral shaping and layout orchestration.

Responsibilities:

- Unicode segmentation.
- Script and direction analysis.
- Font fallback and run segmentation.
- OpenType shaping.
- Paragraph line breaking and alignment.
- Cluster, caret and selection mapping.
- Point-text and paragraph-text layout.
- Path-text layout.
- Immutable `RealizedTextLayout` output.
- Revision-keyed CPU/WASM caches.

This package may call a Rust/WASM module, but the TypeScript-facing API must remain stable and host-neutral.

### 3.3 `@lighttable/text-rendering`

Owns backend-neutral realization planning.

Responsibilities:

- Convert positioned glyph runs into render batches.
- Select atlas, MSDF or direct-outline realization per run/glyph/quality bucket.
- Calculate ink bounds and effect padding.
- Decide whether direct glyph rendering or a cached layer texture is cheaper.
- Hold immutable render plans and cache keys.
- No WebGPU-specific objects.

### 3.4 `@lighttable/text-webgpu`

Owns all WebGPU resources and encoding.

Responsibilities:

- Glyph atlas pages.
- Coverage/MSDF textures.
- Outline path buffers.
- Instance buffers.
- Pipelines and bind groups.
- Text source render targets.
- Cached layer textures or tiles.
- GPU byte accounting.
- Device-loss recovery.
- Final destruction.
- Submitted resource retention.

### 3.5 `@lighttable/font-core`

Owns canonical font asset metadata and selection identities.

Responsibilities:

- Stable font asset IDs.
- Requested vs resolved font identity.
- Font source and provenance.
- Embedded/system/bundled/user font metadata.
- Variable-axis coordinates.
- Font fingerprints.
- Embedding rights metadata where available.
- Missing-font and substitution state.

Font binary bytes belong in the existing document asset system, not directly inside text layer JSON.

### 3.6 `@lighttable/pdf-import`

Do not build this as part of the first text tool, but preserve a clear adapter boundary.

Responsibilities later:

- Parse PDF page resources and content.
- Produce a normalized PDF display list.
- Convert display operations to native LightTable scene nodes.
- Preserve exact glyph IDs, positions and transforms.
- Import embedded subset fonts as document font assets.
- Create import reports with structural, editable, visual and preservation status.

---

## 4. Canonical document model

Add `TextLayer` as a first-class layer type rather than disguising text as `VectorLayer` or `RasterLayer`.

```ts
interface TextLayerData extends BaseLayerData {
  readonly type: 'text';
  readonly source: TextSourceData;
  readonly localToParent: Matrix3Data;

  readonly contentRevision: number;
  readonly styleRevision: number;
  readonly layoutRevision: number;
  readonly pathRevision: number;
  readonly geometryRevision: number;

  readonly interchange?: TextInterchangeMetadata;
}

type TextSourceData =
  | FlowTextSourceData
  | PositionedTextSourceData;
```

### 4.1 Flow text

```ts
interface FlowTextSourceData {
  readonly kind: 'flow';
  readonly text: string;
  readonly styleRuns: readonly TextStyleRunData[];
  readonly paragraphRuns: readonly ParagraphStyleRunData[];
  readonly layout: FlowTextLayoutData;
}

type FlowTextLayoutData =
  | PointTextLayoutData
  | ParagraphTextLayoutData
  | PathTextLayoutData;
```

`FlowTextSourceData` is the authoring model. It stores Unicode and semantic styling, never derived glyph IDs or line breaks.

### 4.2 Positioned text

```ts
interface PositionedTextSourceData {
  readonly kind: 'positioned';
  readonly runs: readonly PositionedTextRunData[];
  readonly extractedText?: string;
  readonly logicalOrderConfidence?: number;
  readonly editability: PositionedTextEditability;
}

interface PositionedTextRunData {
  readonly fontAssetId: FontAssetId;
  readonly fontInstance: FontInstanceData;
  readonly glyphs: readonly PositionedSourceGlyphData[];
  readonly textMatrix: Matrix3Data;
  readonly paint: TextPaintData;
  readonly renderingMode: TextRenderingMode;
  readonly sourceEncoding?: ImportedTextEncodingData;
}

interface PositionedSourceGlyphData {
  readonly glyphId: number;
  readonly cluster?: number;
  readonly unicode?: string;
  readonly sourceCharacterCode?: number;
  readonly x: number;
  readonly y: number;
  readonly advanceX: number;
  readonly advanceY: number;
  readonly localTransform?: Matrix3Data;
}
```

This is essential for PDF and other fixed-layout formats. Do not automatically reshape positioned text through HarfBuzz; the source format may already have selected and positioned exact glyphs.

### 4.3 Rich style runs

```ts
interface TextStyleRunData {
  readonly start: number;
  readonly end: number;

  readonly requestedFont: RequestedFontData;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic' | 'oblique';
  readonly fontStretch: number;

  readonly fill: PaintData;
  readonly stroke?: VectorStrokeData;

  readonly tracking: number;
  readonly kerning: 'auto' | 'metrics' | 'optical' | 'none';
  readonly baselineShift: number;
  readonly horizontalScale: number;
  readonly verticalScale: number;

  readonly language?: string;
  readonly scriptOverride?: string;
  readonly directionOverride?: 'ltr' | 'rtl';
  readonly openTypeFeatures?: Readonly<Record<string, boolean | number>>;
  readonly variableAxes?: Readonly<Record<string, number>>;

  readonly syntheticBold?: boolean;
  readonly syntheticItalic?: boolean;
}
```

Use Unicode text indices consistently. Prefer UTF-16 indices only if the whole application already standardizes on JavaScript string offsets; otherwise strongly consider code-point or grapheme-aware range helpers. Never split surrogate pairs or grapheme clusters during editing.

### 4.4 Paragraph style

```ts
interface ParagraphStyleRunData {
  readonly start: number;
  readonly end: number;
  readonly alignment: 'start' | 'center' | 'end' | 'justify';
  readonly direction: 'auto' | 'ltr' | 'rtl';
  readonly lineHeight: LineHeightData;
  readonly firstLineIndent: number;
  readonly startIndent: number;
  readonly endIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly hyphenation: 'off' | 'auto';
}
```

Do not make every possible typography control part of milestone one, but choose a serializable shape that can evolve without replacing the layer type.

### 4.5 Point and paragraph layout

```ts
interface PointTextLayoutData {
  readonly mode: 'point';
  readonly origin: Vec2Data;
  readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
}

interface ParagraphTextLayoutData {
  readonly mode: 'paragraph';
  readonly frame: RectData;
  readonly overflow: 'visible' | 'clip' | 'indicator';
  readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
}
```

Paragraph frame resize and geometric layer transform are separate operations. The text tool edits the frame and causes reflow. The transform tool modifies `localToParent` and does not reflow unless explicitly requested.

### 4.6 Text on path

```ts
interface PathTextLayoutData {
  readonly mode: 'path';
  readonly pathRef: ScenePathReference;
  readonly startOffset: number;
  readonly endOffset?: number;
  readonly side: 'left' | 'right';
  readonly direction: 'forward' | 'reverse';
  readonly alignment: 'start' | 'center' | 'end' | 'justify';
  readonly baselineOffset: number;
  readonly keepUpright: boolean;
  readonly deformation: 'rigid-glyphs' | 'warped-outlines';
}
```

The referenced path remains canonical vector geometry. Store a stable layer/element/subpath reference, not a copied flattened polyline.

### 4.7 Interchange metadata

Follow the existing four parity dimensions.

```ts
interface TextInterchangeMetadata {
  readonly sourceFormat?: 'psd' | 'psb' | 'pdf' | 'svg' | 'ai' | 'eps' | 'other';
  readonly structuralStatus?: ImportStatus;
  readonly editableStatus?: ImportStatus;
  readonly visualStatus?: ImportStatus;
  readonly preservationStatus?: ImportStatus;
  readonly sourceObjectId?: string;
  readonly warnings?: readonly string[];
  readonly preservationPayloadRef?: AssetId;
}
```

Do not call a PDF or PSD text import “supported” merely because it visually rasterizes. Report structural, editable, visual and preservation parity separately.

---

## 5. Font asset architecture

Fonts are first-class document assets. This is required for reliable PDF/PSD interchange and reproducible rendering.

```ts
interface FontAssetData {
  readonly id: FontAssetId;
  readonly binaryAssetId?: AssetId;
  readonly source:
    | 'embedded-document'
    | 'embedded-pdf'
    | 'embedded-psd'
    | 'user-imported'
    | 'system'
    | 'bundled';

  readonly originalName?: string;
  readonly familyName?: string;
  readonly subfamilyName?: string;
  readonly postScriptName?: string;
  readonly subsetPrefix?: string;
  readonly fingerprint: string;
  readonly format?: 'ttf' | 'otf' | 'woff' | 'woff2' | 'cff' | 'cff2' | 'type1' | 'type3' | 'unknown';
  readonly embeddingRights?: FontEmbeddingRightsData;
  readonly provenance?: AssetProvenanceData;
}
```

### 5.1 Font resolution order

Resolve requested fonts using stable and explicit rules:

```text
exact embedded asset/fingerprint
    -> exact PostScript name
    -> family + style + weight + stretch
    -> variable-font compatible instance
    -> configured fallback family
    -> script-aware fallback
    -> last-resort font
```

The layout result must record the **resolved** font asset/instance, not just the requested family name.

### 5.2 PDF subset fonts

When a PDF embeds `ABCDEE+SomeFont`, retain the binary as a document font asset. Render exact glyph IDs against that asset. Do not replace it with a system font merely because the base name appears familiar.

Subset fonts may have incomplete Unicode maps. Visual rendering can still be exact while semantic editing remains limited. Preserve these states separately.

### 5.3 Font loading policy

- Parse fonts off the UI thread where practical.
- Deduplicate by fingerprint.
- Bound parsed-font caches by bytes.
- Keep font binaries in document assets; parsed structures are runtime caches.
- Recreate parsed handles after WASM reset or device loss as needed.
- Never depend on browser font loading for rendering correctness.

A hidden DOM input may be used for IME event capture, but browser font selection and browser text metrics are not authoritative.

---

## 6. Shaping and layout engine

Shaping and paragraph layout should run on CPU/WASM. GPU compute is not a priority for shaping because correctness, Unicode complexity and branch-heavy font logic dominate. The GPU owns visible rasterization and compositing.

### 6.1 Common output contract

Both flow text and imported positioned text must produce:

```ts
interface RealizedTextLayout {
  readonly key: TextLayoutKey;
  readonly glyphRuns: readonly PositionedGlyphRun[];
  readonly lines: readonly TextLineMetrics[];
  readonly caretStops: readonly CaretStop[];
  readonly selectionGeometry: readonly SelectionGeometryEntry[];
  readonly clusterMap: readonly GlyphClusterMapEntry[];
  readonly inkBounds: RectData;
  readonly logicalBounds: RectData;
  readonly warnings: readonly TextLayoutWarning[];
}

interface PositionedGlyphRun {
  readonly fontAssetId: FontAssetId;
  readonly fontInstance: FontInstanceData;
  readonly paint: TextPaintData;
  readonly glyphs: readonly PositionedGlyph[];
  readonly direction: 'ltr' | 'rtl' | 'ttb' | 'btt';
  readonly language?: string;
  readonly script?: string;
}

interface PositionedGlyph {
  readonly glyphId: number;
  readonly cluster: number;
  readonly x: number;
  readonly y: number;
  readonly advanceX: number;
  readonly advanceY: number;
  readonly rotation?: number;
  readonly transform?: Matrix3Data;
}
```

The renderer knows only this realized layout plus render quality and target transform. It does not care whether the source was a LightTable paragraph or imported PDF glyphs.

### 6.2 Flow-text pipeline

```text
Unicode text
    -> grapheme and bidi analysis
    -> style-run intersection
    -> script/language segmentation
    -> font fallback resolution
    -> shaping per compatible run
    -> line breaking
    -> paragraph alignment/justification
    -> glyph positions and line metrics
    -> caret/cluster/selection maps
```

### 6.3 Positioned-text pipeline

```text
imported exact glyph IDs and matrices
    -> validate font resource
    -> normalize source coordinates
    -> preserve exact positioning
    -> infer optional logical text/caret mapping only when confidence is sufficient
    -> RealizedTextLayout
```

Do not send imported positioned glyphs through normal shaping unless the user explicitly chooses “convert/recover as flow text.”

### 6.4 Editing granularity

Editing commands operate on semantic text and runs. During an active edit session, keep disposable preview/edit state outside canonical history. Commit one command per logical transaction rather than one command per pointer event.

Keyboard typing may be grouped by a short coalescing transaction policy, but undo behavior should remain predictable and document-scoped.

### 6.5 IME input bridge

Full Unicode editing requires OS/browser IME composition support.

Permitted exception:

```text
hidden native/DOM input
    -> composition/input/clipboard events only
    -> TextToolController
    -> canonical FlowText source
```

Forbidden:

- visible DOM text;
- DOM range rendering;
- CSS caret or selection;
- `measureText` as layout truth;
- browser line wrapping as layout truth.

The hidden input is an event bridge, not a renderer.

---

## 7. GPU text rendering strategy

Use a hybrid strategy. No single glyph rendering method is optimal for all sizes, transforms, effects and export fidelity.

### 7.1 Rendering paths

#### A. Coverage atlas

Best for:

- small UI-scale and document text;
- stable scale ranges;
- high glyph reuse;
- fast live typing;
- hinted or grayscale glyphs where small-size legibility matters.

Store single-channel coverage or packed coverage in atlas pages. Sample in a WebGPU shader and apply run paint.

#### B. MSDF/MTSDF atlas

Best for:

- moderate zoom ranges;
- interactive scaling;
- repeated glyphs;
- sharp corners at a broad scale range;
- inexpensive live editing.

MSDF is useful, but must not become the only final-quality path. It can show artifacts for extreme zoom, thin details, self-intersections, complex overlap, large strokes and certain glyph constructions.

#### C. Direct vector outline rendering

Best for:

- high zoom;
- very large display text;
- export;
- text-to-path;
- native vector strokes;
- path deformation and warping;
- exact shape fidelity;
- glyphs that do not render well through an atlas.

Extract glyph outlines and route them into the existing LightTable vector realization/WebGPU backend where feasible.

#### D. Color and bitmap glyph path

Later support may require separate handling for:

- COLR/CPAL, including COLRv1;
- CBDT/CBLC;
- sbix;
- SVG-in-OpenType;
- embedded bitmap strikes.

Do not force these into monochrome outlines. Add a capability/status model and preserve unsupported fonts visibly in import reports.

### 7.2 Quality selection

Use an explicit policy, not ad-hoc branches:

```ts
interface TextRenderQualityPolicy {
  chooseGlyphMode(input: {
    fontSizePx: number;
    effectiveScale: number;
    transformComplexity: number;
    isActivelyEditing: boolean;
    needsVectorStroke: boolean;
    needsOutlineWarp: boolean;
    isFinalExport: boolean;
    glyphCapabilities: GlyphCapabilities;
  }): 'coverage-atlas' | 'msdf-atlas' | 'vector-outline' | 'color-glyph';
}
```

The policy should be benchmark-driven and overridable for diagnostics.

### 7.3 Existing vector backend integration

Preferred long-term path:

```text
font glyph outline
    -> canonical/immutable glyph path realization
    -> existing vector-rendering cache
    -> vector-webgpu stencil/cover or later improved backend
    -> text source target
```

Do not store converted vector paths per character in the document. Glyph path conversion is a runtime cache keyed by font instance and glyph ID.

### 7.4 GPU batching

Batch by compatible state:

- render mode;
- atlas page or outline pipeline;
- font instance/variation key where required;
- paint type;
- clip and target;
- blend/coverage mode.

Use instanced glyph quads for atlas rendering. Avoid one draw call per glyph.

For direct outlines, cache immutable glyph geometry and instance transforms where the vector backend supports it. Repeated glyphs must reuse geometry.

### 7.5 Alpha and paint

Render text into a premultiplied linear working target. Text fill may be:

- solid color;
- gradient;
- pattern;
- later other native paint types.

Differentiate:

1. **Native text/vector stroke** — part of text source geometry/paint.
2. **Layer Style stroke** — a post-source effect evaluated by the existing style stack.

A Layer Style change must not invalidate shaping or glyph geometry.

---

## 8. Caching and performance architecture

Performance and cache ownership are first-class requirements.

Every cache must define:

- owner;
- complete key;
- estimated byte size;
- invalidation rule;
- eviction policy;
- destroy path;
- device/WASM-reset recovery path.

### 8.1 Cache layers

#### Font binary asset cache

Canonical bytes in the document asset system. Deduplicate by fingerprint.

#### Parsed font cache

```text
font fingerprint + parser version
    -> parsed font tables/runtime face
```

Owned by the font runtime, byte-bounded and reconstructible.

#### Shaping cache

```text
text slice
+ resolved font instance
+ direction/script/language
+ OpenType features
+ variation axes
+ shaping engine version
    -> glyph IDs, clusters, advances and offsets
```

Changing fill color must not invalidate this cache.

#### Paragraph layout cache

```text
shaped runs
+ paragraph frame and paragraph style
+ line breaking/hyphenation settings
+ path revision when applicable
    -> positioned runs, lines, caret and selection maps
```

Changing `localToParent` must not invalidate paragraph layout.

#### Glyph outline cache

```text
font fingerprint
+ glyph ID
+ variation coordinates
+ hinting/outline mode
    -> immutable path geometry
```

#### Atlas glyph cache

```text
font instance
+ glyph ID
+ atlas mode
+ em/raster bucket
+ edge range/hinting settings
    -> atlas allocation and metrics
```

#### Text render-plan cache

```text
layout key
+ paint revision
+ quality bucket
+ vector/atlas capability state
    -> immutable text render plan
```

#### Cached layer source

```text
text render-plan key
+ final quality bucket
+ padding/effect source requirements
    -> tight premultiplied texture or tiled source
```

### 8.2 Revision domains

Use explicit revisions rather than a single broad text revision.

Recommended minimum:

```text
contentRevision
styleRevision
fontResolutionRevision
shapingRevision
layoutRevision
paintRevision
pathRevision
geometryRevision
sourceRealizationRevision
```

Dependency examples:

| Mutation | Shaping | Layout | Glyph geometry/atlas | Source texture | Composite |
|---|---:|---:|---:|---:|---:|
| Insert character | yes | yes | maybe | yes | yes |
| Change font family | yes | yes | yes | yes | yes |
| Change font size | yes/metrics | yes | bucket-dependent | yes | yes |
| Change fill color | no | no | no | yes | yes |
| Change Layer Style | no | no | no | no | style/composite only |
| Change layer opacity | no | no | no | no | composite only |
| Move layer | no | no | no | usually no | geometry/composite only |
| Zoom viewport | no | no | only if quality bucket policy requests refresh | usually no | presentation only |
| Edit text path | no reshaping in many cases | yes | no or transform-only | yes | yes |

### 8.3 Active editing vs settled rendering

During active editing:

```text
live realized glyph runs
    -> atlas or direct outlines
    -> current text source target
    -> compositor
```

Caret, selection and frame are GPU overlays.

After input settles or editing ends:

```text
final-quality glyph realization
    -> tight-bounds cached text source texture
    -> compositor reuses source until relevant revision changes
```

Do not use arbitrary long timers as correctness boundaries. Pointer-up, edit commit and final input flush must force final-quality state. A small idle settle may be used only as a performance optimization.

### 8.4 Cache or draw directly?

Do not raster-cache every inactive text layer blindly. Compare estimated costs.

```ts
interface TextCacheDecisionInput {
  glyphCount: number;
  uniqueGlyphCount: number;
  estimatedDirectDrawCost: number;
  estimatedTextureBytes: number;
  expectedReuseFrames: number;
  effectiveBoundsPx: RectData;
  transformStability: number;
  hasExpensivePaintOrEffects: boolean;
}
```

Examples:

- Twenty glyphs with a stable atlas may be cheaper to draw directly than maintaining a large cached texture.
- A large paragraph with many glyphs and complex paint is a strong cache candidate.
- A huge transformed text layer should use scale buckets or tiles rather than an enormous permanent texture.

### 8.5 Tight bounds and padding

Cache only measured ink bounds plus required source/effect padding. Texture dimensions are not semantic bounds.

Include padding for:

- native stroke;
- filter sampling if text-local processing is allowed;
- Layer Style source needs where source alpha outside hard bounds matters;
- anti-aliasing fringe.

Do not permanently include viewport-sized transparent areas.

### 8.6 Tiling

Support or design for tiled text/page caches when dimensions exceed practical targets.

```text
layer-local tile grid
+ scale bucket
+ dirty tile set
+ LRU residency
```

This is especially important for large paragraph text, poster-sized documents and PDF pages.

### 8.7 Inactive documents

Text runtimes in inactive documents may retain bounded caches for fast tab switching, but must not run recurring layout, atlas maintenance, caret animation, scope analysis or GPU submissions.

---

## 9. Editor tool architecture

Create a proper `TextToolController`, not a React component containing editing logic.

Responsibilities:

- Create point or paragraph text layers.
- Start and end edit sessions.
- Convert pointer coordinates through the scene transform graph.
- Resolve caret positions from layout maps.
- Maintain disposable selection/composition state.
- Apply style changes to ranges.
- Commit commands.
- Publish semantic dirty domains.
- Cooperate with transform and path tools.

```ts
interface TextEditSession {
  readonly layerId: LayerId;
  readonly anchorDocumentRevision: number;
  readonly caretIndex: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly compositionRange?: TextRangeData;
  readonly preferredCaretInlinePosition?: number;
}
```

### 9.1 GPU overlays

Use the existing vector overlay infrastructure for:

- caret;
- selected ranges;
- paragraph frame;
- baseline and text origin;
- overflow indicator;
- path baseline;
- start/end offsets;
- path direction;
- text bounds and transform handles where appropriate.

Overlay changes must not dirty text pixels or document content unless they change actual semantics.

### 9.2 Interaction quality

- Coalesce pointer movement to at most one preview update per animation frame.
- Flush the last preview on pointer-up.
- Do not route raw pointer events through canonical React state.
- Keep typing responsive while final-quality source caching happens after commit/settle.
- Move expensive layout work to a worker/WASM worker when measurements prove it useful.
- Cancel stale asynchronous layout results by revision key.

### 9.3 Undo

One logical gesture or edit transaction creates one undo entry. Runtime GPU/font resources do not belong in command history.

Possible command types:

- `CreateTextLayerCommand`
- `EditTextContentCommand`
- `ApplyTextStyleCommand`
- `ChangeParagraphFrameCommand`
- `ChangeTextPathSettingsCommand`
- `ConvertPositionedTextToFlowTextCommand`
- `ConvertTextToPathsCommand`

Commands store IDs and serializable before/after semantic state or efficient deltas.

---

## 10. Text on path

Design now; implement after stable point and paragraph text.

### 10.1 Rigid-glyph path text

Pipeline:

1. Shape text normally.
2. Obtain cumulative advances.
3. Build or reuse an arc-length table for the canonical Bézier subpath.
4. Map each glyph origin/center to a path distance.
5. Resolve position, tangent and normal.
6. Rotate the glyph by the tangent.
7. Apply baseline offset along the normal.
8. Preserve clusters and caret mapping.

Cache the arc-length table using the vector path revision and flattening tolerance/quality bucket.

### 10.2 Warped-outline path text

Later, for connected scripts or stronger deformation:

```text
outline point (x, y)
    -> pathPosition(startOffset + x)
       + pathNormal(startOffset + x) * y
```

This requires direct glyph outlines and should use the vector/GPU path, not MSDF quads.

### 10.3 Imported path-like text

PDF commonly stores curved text as individually transformed glyphs rather than semantic path text. Import it as positioned text first. A later analysis tool may offer “Recover Text on Path” when glyph origins and rotations fit a curve with sufficient confidence.

Never silently replace exact positioned text with a guessed semantic path.

---

## 11. PDF compatibility architecture

PDF support changes the text design in an important way: exact glyph positioning and embedded font preservation are mandatory.

### 11.1 PDF import stages

```text
PDF parser/engine
    -> normalized PDF display list
    -> LightTable semantic conversion
    -> native scene graph
    -> LightTable renderer
```

Do not couple PDF parser calls directly throughout the compositor. Do not make a rendered bitmap the only import result.

### 11.2 Normalized display list

Design an intermediate representation such as:

```ts
type PdfDisplayOperation =
  | PdfSaveState
  | PdfRestoreState
  | PdfConcatTransform
  | PdfSetFillPaint
  | PdfSetStrokePaint
  | PdfSetBlendMode
  | PdfSetAlpha
  | PdfClipPath
  | PdfDrawPath
  | PdfDrawImage
  | PdfDrawText
  | PdfBeginTransparencyGroup
  | PdfEndTransparencyGroup
  | PdfApplySoftMask
  | PdfBeginMarkedContent
  | PdfEndMarkedContent;
```

The exact schema can evolve, but the adapter must first capture source semantics and graphics state before converting them into LightTable nodes.

### 11.3 PDF text mapping

Map text objects to `PositionedTextSourceData` with:

- exact font asset/subset;
- glyph IDs or source character codes mapped to glyphs;
- exact advances and offsets;
- text matrix;
- horizontal scale;
- character and word spacing;
- rise/baseline shift;
- fill/stroke/clip rendering mode;
- Unicode mapping when trustworthy;
- source object metadata.

Do not reshape imported glyphs by default.

### 11.4 PDF page mapping

A page should map approximately to:

```text
Page Group
    -> VectorLayer(s)
    -> Positioned TextLayer(s)
    -> RasterLayer(s)
    -> nested group/form objects
    -> clipping/vector masks
    -> transparency group semantics
```

Preserve z-order and graphics-state nesting.

### 11.5 Transparency and groups

PDF isolated and knockout transparency groups may not match a normal LightTable group. Extend group semantics explicitly where needed; do not hide PDF behavior inside special compositor branches keyed by import provenance.

### 11.6 Editability levels

Classify imported text:

1. **Flow editable** — reliable Unicode, font mapping, order and recoverable paragraph semantics.
2. **Position editable** — exact glyphs can be recolored, transformed and styled, but normal insertion is unsafe.
3. **Vector editable** — text must be represented as glyph outlines.
4. **Visual only/preserved** — source cannot yet be mapped faithfully.

Expose conversion as an explicit command when confidence allows.

### 11.7 PDF reference rendering

Use an independent reference renderer to compare visual output. The reference is test truth, not LightTable’s runtime renderer.

Recommended test workflow:

```text
PDF page
    -> reference engine raster at defined scale/color path
    -> LightTable semantic import
    -> LightTable native render
    -> image comparison and structural report
```

Record sampled pixels, mean/max error, thresholds and unsupported semantics.

### 11.8 PDF export

The architecture should allow:

```text
FlowText
    -> shape
    -> subset/embed font where allowed
    -> PDF text objects with positioned glyphs

PositionedText
    -> preserve exact glyph placement and embedded font where possible

unsupported/deformed text
    -> vector outline fallback
```

Font subsetting and embedding rights must be handled explicitly.

---

## 12. PSD/PSB compatibility

Use the same native `TextLayer`; PSD is an adapter target.

For each PSD text layer, report:

- structural parity;
- editable semantic parity;
- visual parity;
- preservation parity.

Preserve Photoshop-specific text engine data only through a deliberate preservation carrier, never as undocumented conditionals spread through rendering code.

A raster preview may be retained temporarily for import diagnostics, but must not be misreported as native editable text.

Mixed styles, paragraph text, transforms, warp and missing-font states must be represented explicitly.

---

## 13. Other format compatibility

A strong text core improves more than PDF and PSD.

### 13.1 SVG

SVG text may contain spans, transforms, text paths and exact positioning. Import into flow text only when semantics are reliable; otherwise use positioned text or vector outlines.

Do not use SVG as LightTable’s internal renderer.

### 13.2 AI/EPS/PostScript

These may contain text operators and embedded/subset fonts, but semantics vary. Normalize into positioned text or outlines through the document import layer.

### 13.3 Office and design formats

Future importers can target the same two text source types. Fixed-layout formats generally map more safely to positioned text first.

### 13.4 Native LightTable format

The native format stores semantic text, font asset references and optional preservation metadata. It does not serialize glyph atlas locations, outline buffers or cached layer textures as authoritative state.

Optional derived caches may be stored only as discardable acceleration artifacts with strict versioning and complete fallback reconstruction.

---

## 14. Open-source projects to investigate

The coding agent must investigate these projects before implementing equivalent complex functionality. Prefer primary repositories and official documentation. Record commit/tag, license, build target, WASM feasibility, API maturity, missing features and integration cost.

Clone candidates into `.referenceCode/` and ensure `.referenceCode/` is in `.gitignore`.

### 14.1 Parley — primary rich-text layout candidate

Repository: <https://github.com/linebender/parley>

Why inspect:

- rich text layout;
- font fallback integration;
- bidi and Unicode handling;
- line breaking;
- positioned glyph output;
- selection/caret concepts;
- Rust architecture suitable for WASM.

Parley currently builds on the Linebender text stack, including Fontique, HarfRust, Skrifa and ICU4X. It is likely the best architectural match for a Rust/WASM `text-layout` package.

Tasks:

- Build a minimal WASM spike.
- Measure bundle size, startup time and shaping/layout throughput.
- Test Latin, Arabic, Devanagari, CJK, emoji and mixed bidi.
- Verify rich style runs and variable fonts.
- Determine whether to use directly, wrap selected parts, or copy architectural patterns only.
- Verify current license files and dependency licenses before adoption.

### 14.2 Fontations / Skrifa — primary font parsing and outline candidate

Repository: <https://github.com/googlefonts/fontations>

Skrifa README: <https://github.com/googlefonts/fontations/tree/main/skrifa>

Why inspect:

- modern Rust OpenType parsing;
- glyph outline extraction;
- variation coordinates;
- font metrics and metadata;
- likely good WASM compatibility;
- relevant to both text rendering and PDF embedded fonts.

Tasks:

- Parse representative TTF, OTF/CFF, CFF2 and variable fonts in WASM.
- Extract outlines and convert them to LightTable vector geometry.
- Test malformed font behavior and memory use.
- Investigate hinting support and small-size quality implications.
- Evaluate color-font table support and roadmap.

### 14.3 HarfBuzz / harfbuzzjs — correctness reference and alternative shaping candidate

Main repository: <https://github.com/harfbuzz/harfbuzz>

JavaScript/WASM binding: <https://github.com/harfbuzz/harfbuzzjs>

Documentation: <https://harfbuzz.github.io/>

Why inspect:

- industry-standard shaping behavior;
- OpenType and AAT coverage;
- complex-script correctness;
- font subsetting support useful for PDF export;
- mature fuzzing and real-world compatibility.

Notes:

- Do not confuse HarfBuzz’s experimental “WASM shaper inside fonts” feature with compiling HarfBuzz itself to WebAssembly.
- `harfbuzzjs` demonstrates a practical Emscripten/WASM route.
- A Rust stack using HarfRust may integrate more cleanly with Parley, but HarfBuzz remains the correctness baseline.

Tasks:

- Compare HarfRust/Parley results against HarfBuzz on a corpus.
- Evaluate harfbuzzjs size and performance.
- Investigate using HarfBuzz subsetting in desktop/native builds or WASM.
- Decide whether LightTable needs one shared implementation across web/Electron or can use equivalent implementations behind identical test contracts.

### 14.4 Fontique — font fallback and selection

Repository is part of the Linebender ecosystem; locate the current official repository from Parley dependencies.

Why inspect:

- font collection and fallback;
- family/style selection;
- cross-platform abstraction;
- likely compatibility with Parley/Skrifa.

Tasks:

- Determine how system fonts are enumerated in browser/Electron/native environments.
- Keep host font discovery behind a capability adapter.
- Ensure embedded document fonts take precedence.

### 14.5 ICU4X — Unicode segmentation and bidi support

Official project: <https://github.com/unicode-org/icu4x>

Why inspect:

- Unicode properties;
- segmentation;
- script data;
- locale-aware processing;
- WASM-oriented design.

Do not import a huge data bundle blindly. Measure selected components and data-provider strategies.

### 14.6 Cosmic Text — alternative integrated reference

Repository: <https://github.com/pop-os/cosmic-text>

Why inspect:

- shaping, fallback, layout and editing concepts in one Rust codebase;
- practical text buffers;
- useful comparison to Parley.

Treat it as a serious alternative/reference, but compare modularity, WASM footprint, complex-script coverage, selection mapping and color-font support.

### 14.7 Swash — font introspection and glyph rendering reference

Repository: <https://github.com/dfrg/swash>

Why inspect:

- font introspection;
- scaling and outlines;
- rasterization and color glyph behavior;
- potential source for coverage atlas generation.

Evaluate whether selected functionality can be used without duplicating Skrifa responsibilities.

### 14.8 Vello — GPU vector renderer research, not automatic adoption

Repository: <https://github.com/linebender/vello>

Why inspect:

- compute-centric GPU 2D rendering;
- glyph/path batching;
- integration patterns with Parley;
- advanced anti-aliasing and large-scene behavior.

Important:

- Vello has historically described itself as alpha; verify current status.
- LightTable already has a vector and compositor architecture.
- Do not replace the existing renderer merely because Vello draws text.
- Consider borrowing algorithms, using it as a benchmark/reference, or integrating a narrowly scoped backend only if measured benefits justify the complexity.

### 14.9 msdfgen — MSDF generation reference/candidate

Repository: <https://github.com/Chlumsky/msdfgen>

Why inspect:

- high-quality MSDF generation;
- edge coloring;
- glyph atlas generation;
- permissive reuse may save substantial implementation time.

Tasks:

- Verify current license.
- Build an Emscripten or native-worker spike.
- Measure glyph generation latency.
- Consider generating atlas entries in a worker and uploading to WebGPU.
- Test pathological glyphs and compare against direct vector rendering.
- Investigate MTSDF where useful.

Do not use MSDF as the only final-quality renderer.

### 14.10 FreeType — mature raster/hinting reference

Repository: <https://gitlab.freedesktop.org/freetype/freetype>

Why inspect:

- mature font rasterization and hinting;
- broad font format compatibility;
- possible coverage-atlas generator;
- known Emscripten/WASM history.

Trade-offs:

- C library and build complexity;
- overlap with Skrifa/Swash;
- potentially valuable for small hinted text and unusual font formats.

Run a focused spike before deciding. Avoid carrying two full font stacks without a measured reason.

### 14.11 PDFium — primary permissive PDF engine candidate

Official source: <https://pdfium.googlesource.com/pdfium/>

Public API headers: <https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/>

Useful Rust wrapper/reference: <https://github.com/ajrcarey/pdfium-render>

Why inspect:

- Chromium’s mature PDF engine;
- rendering and text extraction;
- page object APIs;
- permissive BSD-style licensing, with third-party dependency notices;
- native desktop suitability;
- existing third-party WASM builds/wrappers demonstrate feasibility.

Tasks:

- Confirm exact upstream and dependency licensing for distribution.
- Determine whether page-object APIs expose enough text glyph/font/matrix detail for semantic conversion.
- Prototype desktop native integration first if building PDFium to WASM is too expensive.
- Evaluate a worker-hosted WASM build for web.
- Keep the PDF adapter contract independent so web and desktop can use different engine builds while producing identical normalized display lists.

Do not assume all wrapper licenses or capabilities equal upstream PDFium. Inspect upstream APIs directly.

### 14.12 PDF.js — readable Apache-licensed parser/reference

Repository: <https://github.com/mozilla/pdf.js>

Documentation/demo: <https://mozilla.github.io/pdf.js/>

Why inspect:

- Apache 2.0;
- JavaScript code is easy to inspect;
- operator lists, font handling and web-worker architecture;
- fast route for a browser-side import prototype.

Cautions:

- It is primarily a viewer and commonly renders through Canvas-related paths.
- Do not adopt its visible renderer as LightTable’s renderer.
- Font and edge-case fidelity must be validated independently.
- Use its parser/operator-list concepts or adapter output where useful.

### 14.13 MuPDF — excellent architecture/reference, licensing caution

Official site: <https://mupdf.com/>

Documentation: <https://mupdf.readthedocs.io/>

Why inspect:

- strong display-list/device architecture;
- fast renderer;
- PDF and multiple other document formats;
- useful model for converting page commands into a custom device/scene.

Licensing:

- Open-source MuPDF is AGPL.
- A closed commercial LightTable product generally requires careful AGPL compliance or a commercial license.
- Do not copy or link AGPL code into LightTable without an explicit approved licensing decision.

It remains valuable as an architectural and visual reference, and a commercial license can be evaluated if the technical value is compelling.

### 14.14 Skia — behavior and benchmark reference

Repository: <https://skia.googlesource.com/skia/>

Why inspect:

- mature glyph run and paragraph behavior;
- text blob caching;
- path measurement;
- broad font handling;
- PDF-related rendering experience.

Do not introduce Skia as a second complete renderer unless a measured and strategic decision supports it. Avoid CPU/GPU copy boundaries and conflicting render authorities.

### 14.15 Optional PDF/vector projects

Investigate only if they materially improve the chosen route:

- `pdfium-render` for Rust API patterns.
- `pdf.js` operator list internals.
- permissive Rust PDF parsers for metadata/object inspection, while verifying rendering completeness.
- Apache PDFBox as a semantic/reference implementation, not a likely in-process renderer for LightTable.

Avoid selecting a young parser solely because it is MIT-licensed. PDF compatibility is deep; correctness corpus and reference comparison matter more than a simple API demo.

---

## 15. Open-source evaluation procedure

For each serious candidate, create a short report under:

```text
architecture/reference/text/
```

Recommended report fields:

```text
Project
Repository and exact revision/tag
License and dependency licenses
Language
WASM path
Native desktop path
Bundle/binary size
Startup cost
Memory ownership
Threading/worker support
Supported font/PDF features
Known missing features
API stability
Security/fuzzing posture
Performance measurements
Integration complexity
Recommendation: adopt / wrap / reference / reject
```

### 15.1 Reference source checkout

The coding agent may clone repositories into:

```text
.referenceCode/
```

Ensure `.referenceCode/` is ignored by Git.

Suggested layout:

```text
.referenceCode/parley
.referenceCode/fontations
.referenceCode/harfbuzz
.referenceCode/harfbuzzjs
.referenceCode/cosmic-text
.referenceCode/swash
.referenceCode/vello
.referenceCode/msdfgen
.referenceCode/pdfium
.referenceCode/pdf.js
```

Do not vendor code into production packages until license and architecture reviews are complete.

### 15.2 Build-vs-adopt rule

Before starting a custom subsystem estimated above several engineering days, answer:

1. Is there a permissively licensed implementation?
2. Can it compile to WASM or run in Electron/native?
3. Can it be wrapped behind a LightTable-owned contract?
4. Does it preserve LightTable’s GPU and scene ownership?
5. Is the performance measurable and acceptable?
6. Does it improve format compatibility?
7. Is its maintenance activity and test corpus strong enough?

If yes, prefer integration or selective reuse over recreating years of typography/PDF work.

---

## 16. Recommended technical direction

### 16.1 Preferred initial stack

```text
Rust/WASM text layout module
    Parley
    + Fontique
    + Skrifa/Fontations
    + HarfRust
    + selected ICU4X components

LightTable TypeScript contracts
    TextLayer + FontAsset + RealizedTextLayout

LightTable GPU renderer
    coverage/MSDF atlas for interactive text
    + direct glyph outlines through vector-webgpu for final/high zoom
    + cached tight layer source where beneficial

PDF adapter later
    PDFium primary candidate
    + PDF.js as readable browser/reference implementation
    + independent reference raster comparison
```

This is a recommendation, not permission to adopt blindly. Validate current licenses, APIs, WASM footprint and correctness through spikes.

### 16.2 Alternative route

If Parley’s WASM/API maturity or feature coverage is insufficient:

```text
custom LightTable paragraph orchestrator
    + HarfBuzz/harfbuzzjs shaping
    + ICU4X segmentation/bidi
    + Skrifa/FreeType/Swash outlines and metrics
```

This is more work and should be chosen only after evidence.

### 16.3 Do not choose

Avoid these as foundational architecture:

- CSS/DOM text rendered over the canvas.
- SVG text as the internal format.
- Canvas2D `fillText` or `measureText` as authoritative rendering/layout.
- Permanently rasterized text layers.
- One texture atlas generated for every font size with no eviction.
- Re-shaping imported PDF glyphs by default.
- One monolithic `TextManager` owning document state, fonts, GPU and UI.
- A second full renderer that bypasses `LayerCompositor`.
- AGPL dependencies in the shipping closed product without an explicit legal/commercial decision.

---

## 17. Implementation phases

### Phase 0 — research and contracts

Deliverables:

- Open-source evaluation reports.
- Final package dependency graph.
- `TextLayer`, `FontAsset` and `RealizedTextLayout` TypeScript contracts.
- Revision dependency graph.
- Worker/WASM boundary design.
- GPU resource ownership diagram.
- Test corpus plan.

Exit criteria:

- No implementation starts with unresolved renderer or document ownership.
- Chosen shaping/layout candidate passes a minimal WASM spike.

### Phase 1 — basic point text

Features:

- Native `TextLayer` with flow source.
- Point text.
- Font family, size, weight, italic and solid fill.
- Basic Latin shaping plus architecture ready for complex scripts.
- GPU atlas rendering.
- GPU caret and selection.
- Undo/redo.
- Tight bounds.
- Existing transforms, opacity, blend, masks and Layer Styles.
- Cached settled source or direct-draw decision.

Exit criteria:

- No DOM/CSS/SVG visible text.
- Pan/zoom does not re-shape or re-composite unnecessarily.
- Layer movement does not re-layout text.
- Device loss can rebuild text resources.

### Phase 2 — rich and paragraph text

Features:

- Paragraph frame and wrapping.
- Mixed style runs.
- Mixed fonts and sizes.
- Tracking, leading and baseline shift.
- Bidi and complex-script corpus.
- Font fallback and missing-font warnings.
- Variable fonts/OpenType features.
- Worker-based layout if profiling justifies it.

Exit criteria:

- Arabic, Devanagari, CJK and mixed bidi render and edit correctly in test fixtures.
- Style-only edits avoid shaping/layout invalidation where appropriate.

### Phase 3 — direct outline path

Features:

- Glyph outline extraction.
- Conversion into vector realization.
- Final/high-zoom quality switching.
- Native vector stroke.
- Text-to-path.
- Better export quality.

Exit criteria:

- Large text remains crisp at extreme zoom.
- Repeated glyph outlines are cached and instanced/reused.
- Atlas and outline paths compare acceptably.

### Phase 4 — text on path

Features:

- Stable vector path references.
- Arc-length cache.
- Start/end offsets and side/direction.
- GPU editing overlays.
- Rigid-glyph placement.
- Later warped-outline mode.

Exit criteria:

- Path edits invalidate only path layout/source realization.
- Layer transforms do not mutate path/text semantics.

### Phase 5 — PSD text interchange

Features:

- PSD text layer mapping.
- Mixed style and transform mapping.
- Import reports.
- Missing-font behavior.
- Visual comparisons against Photoshop composites.

Exit criteria:

- Four parity dimensions reported independently.

### Phase 6 — PDF import spike

Features:

- PDF engine evaluation finalized.
- One-page normalized display list.
- Paths, images, clips and exact positioned glyphs.
- Embedded subset font assets.
- Native LightTable page scene.
- Reference renderer comparison.

Exit criteria:

- Imported PDF text renders without default reshaping.
- Page pan/zoom uses presentation only.
- Stable fixture corpus and error reports exist.

### Phase 7 — PDF production and export

Features:

- Transparency groups, soft masks and forms.
- Tiled page caches.
- Editability classification and flow-text recovery.
- PDF export with font subsetting/embedding and outline fallback.

---

## 18. Testing and verification

### 18.1 Unit tests

- Style-run splitting and merging.
- Grapheme-safe insert/delete.
- Revision invalidation.
- Font resolution.
- Flow/positioned source serialization.
- Layout cache keys.
- Text-on-path arc-length mapping.
- Bounds and padding.
- World-preserving reparent.

### 18.2 Typography corpus

Include licensed/open fonts and text fixtures for:

- Latin with ligatures and kerning.
- Arabic joining and bidi.
- Hebrew and mixed bidi.
- Devanagari and other Indic shaping.
- Thai.
- CJK.
- combining marks.
- emoji and variation selectors.
- variable fonts.
- CFF/CFF2 fonts.
- malformed and missing font cases.

### 18.3 Visual golden tests

Render at defined scales and compare:

- atlas vs vector outline;
- interactive vs final quality;
- web vs Electron;
- device pixel ratios;
- transformed text;
- masks and Layer Styles;
- clipping and groups;
- imported PSD/PDF references.

Report nonzero sample counts, mean and maximum error and threshold.

### 18.4 Performance tests

Measure:

- font parse time;
- WASM startup;
- shaping throughput;
- paragraph layout throughput;
- edit latency;
- glyph atlas generation/upload;
- cache hit rate;
- GPU submissions per action;
- draw calls and glyph batching;
- memory by cache owner;
- inactive-document activity;
- large-page tiled-cache behavior.

Performance targets should be derived from representative documents rather than synthetic one-line strings only.

### 18.5 Dirty-path assertions

Add instrumentation/tests proving:

```text
caret blink -> overlay submission only
pan/zoom -> presentation submission only
opacity change -> composite only
text color -> source paint + composite, no shaping
layer move -> geometry/composite, no layout
character insert -> shaping/layout/source/composite
inactive document -> no recurring work
```

### 18.6 Format fixtures

PDF fixtures should isolate:

- embedded TrueType subset;
- CFF subset;
- missing `ToUnicode`;
- per-glyph transforms;
- fill/stroke/clip text modes;
- curved/rotated text;
- transparency group;
- clipping path;
- image and vector interaction;
- Type 3 font;
- malformed recovery case.

PSD fixtures should isolate point text, paragraph text, mixed styles, transform, warp and missing fonts.

---

## 19. Security and robustness

Fonts and PDFs are hostile-input surfaces.

Requirements:

- Parse untrusted font/PDF data in WASM sandbox or isolated worker/process where practical.
- Use mature fuzzed libraries when possible.
- Enforce allocation and recursion limits.
- Validate dimensions and glyph counts.
- Cancel stale imports/layout jobs.
- Avoid blocking the renderer/UI thread on large documents.
- Treat parser errors as import-report entries, not silent corruption.
- Never trust embedded names or lengths without validation.

Electron desktop may use a utility process for PDF parsing if that materially improves isolation and stability.

---

## 20. Resource ownership proposal

```text
DocumentSession
    owns canonical TextLayer and FontAsset references

TextLayoutRuntime
    owns WASM module instance, parsed-font cache and layout cache

TextLayerRuntimeStore
    owns per-layer realized layouts and render-plan handles

GlyphAtlasManager
    owns atlas textures, allocations and glyph metadata

GlyphOutlineCache
    owns immutable CPU/vector realization cache

TextWebGpuRenderer
    owns pipelines, instance buffers and transient targets

TextSourceCache
    owns cached layer textures/tiles and byte budget

SubmittedResourceRetainer
    keeps transient resources alive through GPU completion
```

No owner may rely on React unmount timing alone. All resources need explicit idempotent destruction.

---

## 21. Suggested public interfaces

These are illustrative. Adapt naming to the repository conventions.

```ts
interface TextLayoutService {
  realize(
    layer: TextLayerData,
    fonts: FontSnapshot,
    options: TextLayoutOptions,
    signal?: AbortSignal,
  ): Promise<RealizedTextLayout>;

  dispose(): void;
}

interface TextRenderPlanner {
  buildPlan(input: {
    layout: RealizedTextLayout;
    layer: TextLayerData;
    quality: TextRenderQuality;
    effectiveScale: number;
  }): TextRenderPlan;
}

interface TextLayerRenderer {
  realizeSource(input: {
    plan: TextRenderPlan;
    target: TextRenderTargetRequest;
    context: RenderContext;
  }): RasterRenderContract;

  invalidateLayer(layerId: LayerId, domains: TextDirtyDomains): void;
  releaseLayer(layerId: LayerId): void;
  destroy(): void;
}
```

The compositor receives only the resulting render contract and remains the sole authority on layer ordering and effect semantics.

---

## 22. Key architectural decisions to record as ADRs

Create architecture decision records for:

1. Native `TextLayer` vs vector/raster emulation.
2. Flow text and positioned text source variants.
3. Selected shaping/layout stack.
4. Font asset and system-font capability model.
5. Hybrid atlas/direct-outline renderer.
6. Text source caching policy.
7. PDF engine and normalized display list.
8. AGPL/commercial-license policy for reference and production dependencies.
9. Worker/process isolation for fonts and PDF.
10. Text-to-path and path-reference semantics.

---

## 23. Immediate coding-agent tasks

Perform these in order.

### Task A — repository audit

Locate:

- layer union and serialization;
- asset system;
- scene transform graph;
- `RasterRenderContract`;
- `LayerDocumentRenderer` and runtime stores;
- compositor planning;
- vector-core/rendering/webgpu package interfaces;
- GPU overlay primitives;
- dirty-domain scheduler;
- undo transaction conventions;
- PSD import status models.

Write a short integration map before changing code.

### Task B — research checkouts

Ensure `.referenceCode/` is ignored, then clone the strongest candidates. Inspect actual code, examples, licenses and build files. Do not rely only on README summaries.

### Task C — WASM spike

Build a minimal prototype that accepts:

- font bytes;
- Unicode text;
- font size;
- width;
- style runs;

and returns positioned glyph IDs, positions, line metrics, clusters and bounds.

Use at least Latin, Arabic, Devanagari and mixed bidi fixtures.

### Task D — outline spike

Extract glyph outlines from the chosen font stack and render them through the current vector backend or a small isolated WebGPU proof. Compare with an atlas route.

### Task E — architecture proposal

Before production implementation, submit:

- exact package graph;
- selected libraries and licenses;
- measured WASM size/startup/performance;
- data contracts;
- cache keys and budgets;
- dirty graph;
- first milestone file list;
- unresolved risks.

### Task F — minimal vertical slice

Implement one native point text layer end-to-end:

```text
document serialization
-> layout
-> GPU rendering
-> compositor
-> transform
-> overlay caret
-> edit command
-> cache and destruction
```

Do not begin paragraph UI before this vertical slice proves ownership and dirty behavior.

---

## 24. Acceptance criteria for the architecture

The architecture is acceptable only when all are true:

- Text is a first-class serializable layer.
- Visible text is rendered only through LightTable GPU paths.
- CSS, SVG and Canvas2D are not rendering authorities.
- Flow and positioned text share one downstream layout/render contract.
- PDF exact glyph placement can be preserved without reshaping.
- Embedded fonts can be document assets.
- Font/layout/GPU resources have explicit owners and byte budgets.
- Pan/zoom remains presentation-only.
- Caret and selection remain GPU overlays.
- Inactive text layers/documents do no recurring work.
- Atlas and direct-outline paths can coexist.
- Text can later be converted to paths and placed on paths.
- PSD/PDF adapters report parity dimensions independently.
- Open-source candidates are evaluated before costly custom implementation.
- Shipping dependencies have reviewed permissive/commercial-compatible licenses.
- Web and Electron produce equivalent native document semantics even when host adapters differ.

---

## 25. Final recommendation

Build LightTable text as a **general document-text engine**, not a narrow Photoshop-style string tool.

The recommended center is:

```text
TextLayer
    FlowTextSource | PositionedTextSource
        -> Rust/WASM shaping and layout
        -> RealizedTextLayout
        -> hybrid WebGPU atlas/direct-outline renderer
        -> optional tight/tiled settled source cache
        -> existing RasterRenderContract and compositor
```

Use Parley/Fontique/Skrifa/HarfRust/ICU4X as the first Rust/WASM stack to evaluate, with HarfBuzz as the correctness baseline and possible alternative. Reuse the existing LightTable vector backend for direct glyph outlines where practical. Evaluate `msdfgen` or an equivalent mature implementation for interactive MSDF generation rather than recreating edge-coloring logic immediately.

For PDF, prefer a normalized display-list adapter with PDFium as the primary permissive engine candidate. Use PDF.js as an accessible Apache-licensed reference/prototype and MuPDF as a strong architectural/reference implementation only under an explicit licensing decision.

The core performance strategy is not “rasterize all text.” It is:

- preserve semantic text;
- cache expensive shaping/layout and glyph realizations independently;
- batch GPU glyph drawing;
- use direct outlines for final/high-zoom cases;
- cache settled layer sources only when cheaper than redrawing;
- tile huge content;
- invalidate only the exact dependent stages;
- keep viewport and overlays separate from document content.

This gives LightTable a path to Photoshop-class editable text, PDF-quality fixed-layout import, text on curves, high zoom fidelity, performant inactive layers, and compatibility with future vector/document formats without introducing a competing renderer or abandoning the current scene/compositor architecture.
