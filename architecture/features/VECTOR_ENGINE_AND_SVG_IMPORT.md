# Vector engine and SVG import capability

Status: current implementation and bounded Pass 1 contract, verified 2026-08-21.

## Purpose

LightTable has a native, editable vector engine and a bounded Pass 1 SVG codec.
SVG import parses SVG into the
existing canonical vector model; it must not introduce an SVG DOM, Canvas 2D
scene or browser renderer as a second document authority.

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
| `@lighttable/vector-svg` | Pure bounded SVG import planning and symmetric serialization over `vector-core`. XML is transient parser input and is never retained as document state. |
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

- gradients, `<defs>` and bounded `<use>` resolution in the SVG codec;
- editable vector group hierarchy;
- clipping groups and general SVG masks;
- path boolean authoring (`union`, `subtract`, `intersect`, `exclude`);
- SVG filters, patterns, markers and blend/isolation semantics;
- a native SVG text-layout importer;
- embedded SVG raster-image elements;
- CSS cascade fidelity beyond a deliberately bounded import subset;
- full align/distribute and perspective-warp authoring;
- complete toolbar/Actions exposure of every capability already present in the
  engine.

Multiple subpaths are supported, but that is not the same as editable boolean
operations or a retained SVG group tree.

## Current SVG import contract

One shared import service serves File > Open, Place, SVG clipboard paste,
Actions and MCP. The public machine operation is:

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
engine and are suitable for the first implementation:

| SVG construct | Native mapping |
| --- | --- |
| `<svg>` width, height and `viewBox` | `viewBox` user units become the editable document canvas; width/height are the fallback when no `viewBox` exists. |
| Open filled paths and polylines | Open subpaths are closed for native fill geometry as required by SVG; an authored open stroke is preserved as a separate editable path. |
| Element opacity with both fill and stroke | Rejected until native object-level paint compositing can preserve overlap opacity exactly; fill-opacity and stroke-opacity remain supported. |
| `<g>` and `<a>` | Inherited style and composed transform flattened into native elements; link/navigation attributes are explicitly reported and discarded, while event handlers remain forbidden. |
| `<path>` | Native paths. Support `M/L/H/V/C/S/Q/T/A/Z`; quadratic curves and elliptical arcs convert deterministically to cubic Beziers. |
| `<rect>` / rounded `<rect>` | Live rectangle when semantics fit; otherwise a native path. |
| `<circle>` / `<ellipse>` | Live ellipse when semantics fit; otherwise a native path. |
| `<line>` | Live line or open native path. |
| `<polyline>` / `<polygon>` | Open/closed native path. |
| `transform` | Composed affine matrices. |
| `fill`, `fill-opacity`, `fill-rule`, `opacity` | Native solid/no fill, element opacity and fill rule. |
| `stroke`, width, opacity, cap, join, miter, dash array/offset | Native stroke properties. SVG strokes import as centre-aligned. |
| element `id` | Stable imported name/metadata where valid; LightTable still creates collision-safe native IDs. |

Presentation attributes, inheritance and a small deterministic inline `style`
subset are supported. Arbitrary stylesheets and a browser CSS engine are not.
Gradients, `<defs>` and `<use>` are the explicitly deferred Pass 2 rather than
being silently discarded.

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

SVG is active XML, not merely path data. `@lighttable/vector-svg` uses
`@xmldom/xmldom` only to produce a transient tree. Preflight rejects DTDs,
entities and processing instructions; semantic traversal rejects scripts,
event attributes, foreign namespaces, `foreignObject`, external resource
references and URL paint values. Navigation attributes on `<a>` are reported
and discarded without dereferencing them. The codec performs no network requests.

Default hard limits are:

- 1 MiB input and 4 MiB serialized output;
- 2,048 source/export elements, 32 levels of nesting and 128 attributes per element;
- 512 KiB path data, 256 subpaths per path and 65,536 total anchors;
- 64 dash-array entries.

The importer additionally must:

- validate finite coordinates and transforms;
- parse off the render-critical path and publish one atomic document change;
- return structured warnings/errors instead of partially importing unnoticed;
- preserve the previous document if parsing or validation fails.

MCP should send one SVG import request, not thousands of point-level calls.
The parser output should enter the same canonical command/document boundary as
UI import so Actions, MCP and direct user import cannot diverge.

## Delivery status and next order

Pass 1 now includes the pure codec package, paths/primitives/transforms/solid
paint and stroke, the shared command, Open/Place/explicit File import/paste,
Actions/MCP (including `lighttable_import_svg`), SVG export
and native-save/reopen roundtrip coverage. Next:

1. Add linear/radial gradients, gradient transforms, `<defs>` and bounded `<use>`.
2. Add renderer-backed visual equivalence fixtures in addition to semantic roundtrips.
3. Add groups, clipping, text and hybrid raster elements only as their native
   models become real.

The shortest useful artist-agent improvement is therefore not a generic
`shape: svg` rendering shortcut. It is one bounded SVG-data command that turns
well-supported SVG into real editable LightTable paths and returns an honest
conversion report.
