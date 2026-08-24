# Vector engine and SVG import capability

Status: current editable SVG and hybrid-renderer contract, verified 2026-08-23.

## Purpose

LightTable has a native editable vector model, a secure bounded SVG
normalization/codec pipeline and one hybrid retained vector renderer. SVG
import parses normalized static SVG into the existing canonical vector/group
model; it must not introduce an SVG DOM, Canvas 2D scene, browser preview or
Vello scene as a second document authority.

This document separates three things that are easy to confuse:

- what the native model can represent;
- what the renderer and editor can use today;
- which SVG subset can be imported without silently losing meaning.

## Where the vector engine lives

| Package / boundary | Current responsibility |
| --- | --- |
| `@lighttable/vector-core` | Serializable paths and live shapes, affine transforms, cubic Bezier math, adaptive flattening, hit testing, selections, anchor/handle mutation, pen construction and path topology. It has no DOM or GPU dependency. |
| `@lighttable/vector-rendering` | Realizes canonical curves and strokes into document-space geometry. Owns revisioned caches, stale-work rejection, stroke meshes, bounds and editing-overlay data. |
| `@lighttable/vector-webgpu` | Native WebGPU fill, stroke and editing-overlay rendering. Uses multisampling plus stencil/cover rendering for concave and compound paths. |
| `@lighttable/vector-svg-normalizer` | Secure, renderer-independent, local-only `usvg` WASM normalization of untrusted static SVG. It owns budgets and resource denial, not document semantics. |
| `@lighttable/vector-svg` | Pure bounded editable SVG import planning and symmetric serialization over `vector-core`. XML is transient parser input and is never retained as document state. |
| `@lighttable/paint-scene` / `paint-scene-adapters` | Validated renderer-neutral retained fragments, clips, opacity composition and explicit capability reports. |
| `@lighttable/vector-vello` | Retained Rust/Vello fragment synchronization and zero-copy rendering into shared-device textures. |
| `@lighttable/lighttable-app` | Vector layers, tools, properties, document mutations, persistence, PSD interchange and shared commands. |
| `@lighttable/command-contract` | Machine schemas used by UI recording, Actions and MCP, including `vector.importSvg` and `file.exportSvg`. |

Canonical geometry stays semantic. Flattened contours, stroke triangles,
thumbnails and GPU textures are derived caches and are never document data.

## Native representation available today

### Geometry

The native model can represent:

- one vector layer containing multiple vector elements;
- paths containing multiple open or closed subpaths;
- straight segments and cubic Bezier segments;
- corner, smooth and symmetric anchors with independent handles;
- `nonzero` and `evenodd` fill rules;
- concave shapes, holes and compound geometry through subpaths and fill rules;
- arbitrary affine element transforms, including translation, scale, rotation,
  reflection and skew;
- parametric live rectangles, ellipses, triangles, polygons, stars and lines;
- per-corner rectangle radii, rounded polygon/star corners and line
  arrowheads.

The toolbar currently exposes rectangle, ellipse, triangle and line creation,
plus Pen, path selection, direct selection and anchor tools. Polygon and star
exist in the engine; star is also available through the machine command, but
toolbar/recording exposure is not yet complete for every live-shape kind.

### Paint and stroke

Every vector element can own:

- no fill, a solid RGBA fill or a shared gradient fill;
- element opacity;
- no stroke or a solid/gradient stroke;
- independent stroke opacity and width;
- inside, centre or outside stroke alignment on closed contours;
- butt, round or square caps;
- miter, round or bevel joins and a miter limit;
- dash arrays and dash offset;
- linear, radial, angle, reflected and diamond gradients;
- gradient color and opacity stops, interpolation choice, transforms and
  object-, layer- or document-relative coordinates.

Colors are stored/rendered in the application's linear premultiplied pipeline.
SVG colors must therefore be decoded from SVG's sRGB presentation space rather
than copied numerically into linear fields.

### Editing and document behaviour

Available native behaviour includes:

- element and point selection, including marquee selection;
- moving anchors and Bezier handles;
- inserting and deleting anchors;
- converting corner/smooth/symmetric anchor modes;
- extending, closing, reversing and joining open paths;
- element translation, rotation and scaling;
- vector gradient placement and editing;
- native save/reopen, retained previews and WebGPU thumbnails;
- PSD import/export for the explicitly verified compatible subset;
- semantic create/update/remove commands shared by Actions and MCP;
- atomic command batches for many vector creations in one request.

## Important current gaps

The following should not be presented as complete native capabilities yet:

- arbitrary editable group hierarchy beyond imported opacity/clip groups;
- general SVG masks, patterns, filters and embedded raster images;
- path boolean authoring (`union`, `subtract`, `intersect`, `exclude`);
- exact multi-operand clip union, inverted clips and vector+raster mask
  multiplication;
- full SVG marker and blend/isolation semantics;
- a native SVG text-layout importer;
- CSS cascade fidelity beyond a deliberately bounded import subset;
- full align/distribute and perspective-warp authoring;
- complete toolbar/Actions exposure of every capability already present in the
  engine.

Multiple subpaths and imported opacity/clip groups are supported, but that is
not the same as editable boolean operations or a general retained SVG DOM/tree.

## Current SVG import contract

One shared asynchronous import service serves File > Open, explicit
File > Import/Place, SVG clipboard paste, Actions and MCP. Untrusted input is
preflighted and normalized before the editable codec. The public machine
operation is:

```json
{
  "command": "vector.importSvg",
  "parameters": {
    "svg": "<svg viewBox=\"0 0 100 100\">...</svg>",
    "placement": "document",
    "layerName": "Imported SVG"
  }
}
```

It parses and validates the entire payload, produces a bounded import plan,
then commits atomically. It does not execute a long series of public
`vector.create` calls or expose parser implementation details to MCP.

### First native subset

These SVG constructs have a direct or controlled mapping to the current
engine and are admitted today:

| SVG construct | Native mapping |
| --- | --- |
| `<svg>` width, height and `viewBox` | `viewBox` user units become the editable document canvas; width/height are the fallback when no `viewBox` exists. |
| Open filled paths and polylines | Open subpaths are closed for native fill geometry as required by SVG; an authored open stroke is preserved as a separate editable path. |
| Element opacity with both fill and stroke | Rejected until native object-level paint compositing can preserve overlap opacity exactly; fill-opacity and stroke-opacity remain supported. |
| `<g>` and `<a>` | Inherited style and transforms map to native elements/groups. Observable group opacity and bounded local clips remain explicit; link/navigation behavior is reported and discarded, while event handlers remain forbidden. |
| `<path>` | Native paths. Support `M/L/H/V/C/S/Q/T/A/Z`; quadratic curves and elliptical arcs convert deterministically to cubic Beziers. |
| `<rect>` / rounded `<rect>` | Live rectangle when semantics fit; otherwise a native path. |
| `<circle>` / `<ellipse>` | Live ellipse when semantics fit; otherwise a native path. |
| `<line>` | Live line or open native path. |
| `<polyline>` / `<polygon>` | Open/closed native path. |
| `transform` | Composed affine matrices. |
| `fill`, `fill-opacity`, `fill-rule`, `opacity` | Native solid/no fill, element opacity and fill rule. |
| `stroke`, width, opacity, cap, join, miter, dash array/offset | Native stroke properties. SVG strokes import as centre-aligned. |
| element `id` | Stable imported name/metadata where valid; LightTable still creates collision-safe native IDs. |
| local `<linearGradient>` / `<radialGradient>` | Native editable gradient paint, including transforms, object/user-space coordinates, spread modes, template inheritance and radial focal geometry. |
| local `<clipPath>` | Bounded editable vector clip geometry after normalization; unsupported unions/inversion fail explicitly. |

Presentation attributes, inheritance and a small deterministic inline `style`
subset are supported. Arbitrary stylesheets and a browser CSS engine are not.
The normalizer may expand safe local references such as `<use>` before editable
import. `defs` resources are not document authority; only admitted gradients
and clips survive as canonical semantics.

### Convert only with an explicit report

These constructs may be converted, but the import result must report the
conversion:

- quadratic curves and arcs to cubic paths;
- nested group transforms flattened into element transforms;
- live primitives converted to paths when SVG geometry cannot remain
  parametric;
- `currentColor` resolved from the bounded inherited style context;
- unsupported gradient spread modes expanded only when a bounded,
  appearance-equivalent conversion is available;
- simple clip paths converted to geometry only after native boolean/clipping
  behaviour has a verified equivalent.

### Reject or use an explicit appearance fallback

The first editable importer should not silently claim support for:

- scripts, event handlers, animation or foreign HTML;
- external URLs, fonts, stylesheets or network-loaded resources;
- SVG filters, blend/isolation chains, complex masks or filter regions;
- patterns, mesh gradients, markers and paint servers without a native match;
- `<text>` where font, shaping, baseline and text-on-path semantics cannot be
  retained accurately;
- embedded `<image>` until hybrid vector/raster import has a defined asset
  contract;
- non-scaling strokes unless the transform can be baked without changing the
  result;
- unsupported CSS selectors, variables or cascade behaviour.

For File > Open, a future maximum-appearance mode may rasterize unsupported
content while retaining the source SVG as provenance. That is a separate mode
from editable native import and must be labelled as such.

## Security and performance boundaries

SVG is active XML, not merely path data. A conservative JS preflight and the
pinned feature-minimal `@lighttable/vector-svg-normalizer` WASM boundary reject
DTD/entity/processing-instruction input, active content and uncertain external
resources before `usvg`. Filesystem, font, image and network resolvers are
disabled. The normalized output then enters `@lighttable/vector-svg`, which
uses `@xmldom/xmldom` only for a transient tree. Event attributes,
`foreignObject`, external URLs and data URLs remain forbidden. Harmless foreign
editor metadata and unknown passive SVG subtrees are ignored/reported while
supported siblings continue; they must not crash the whole import.

Default hard limits are split by boundary:

- normalizer: 32 MiB input/output, 250,000 elements and 256
  levels of nesting;
- editable codec/export: 32 MiB input/output, 32,768 elements, 32 levels of
  nesting and 128 attributes per element;
- editable geometry: 8 MiB path data, 4,096 subpaths and 262,144 anchors.

The importer additionally must:

- validate finite coordinates and transforms;
- parse off the render-critical path and publish one atomic document change;
- return structured warnings/errors instead of partially importing unnoticed;
- preserve the previous document if parsing or validation fails.

MCP should send one SVG import request, not thousands of point-level calls.
The parser output should enter the same canonical command/document boundary as
UI import so Actions, MCP and direct user import cannot diverge.

## Delivery status and next order

Current delivery includes secure normalization; editable paths/primitives,
transforms, solid/linear/radial paint and strokes; group opacity; bounded local
vector clips; shared Open/Place/import/paste/Actions/MCP routes (including
`lighttable_import_svg`); SVG export; native save/reopen; browser-oracle corpus
evidence; and retained Vello/native rendering through semantic islands.

Next, in fidelity order:

1. Implement exact multi-operand clip boolean union, inverted clips and
   vector+raster mask multiplication.
2. Preserve exact clip/mask/effect/blend ordering and expand the packaged parity
   corpus across vendors and DPI scales.
3. Add patterns, filters, embedded raster elements and SVG text only when their
   canonical editable/fallback and secure resource contracts are explicit.

The shortest useful artist-agent improvement is therefore not a generic
`shape: svg` rendering shortcut. It is one bounded SVG-data command that turns
well-supported SVG into real editable LightTable paths and returns an honest
conversion report.
