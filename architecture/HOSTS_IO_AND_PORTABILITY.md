# Hosts, I/O and portability

## One editor, multiple hosts

`@lighttable/app` is the product. Web, Electron and StoryBuilder provide a
`LightTableHost` capability object. The shared editor may request open/save,
recent files, confirmation, clipboard and optional media browsing without
knowing whether the data came from an `<input>`, native filesystem, S3 or an
authenticated application.

Current host kinds are `web`, `electron` and `storybuilder`. Electron keeps its
renderer sandboxed and exposes native operations through preload. It must not
fork editor behavior.

## Unified open path

All entry points—file menu, startup argument, recent file, drop target, media
browser and host API—feed one application-owned open/hydrate flow. Detect by
header/content where possible; extensions and picker masks are hints.

Fast common formats take the cheapest correct path. Precision or structured
formats lazily load the required worker/codec:

- common PNG/JPEG/WebP and LightTable documents;
- TIFF and high-bit-depth/profile-aware decoding through the precision worker;
- PSD/PSB through the PSD worker and semantic importer;
- SVG through secure local-only usvg normalization and the bounded editable
  vector codec. A conservatively preflighted warm open may use a transient
  browser/GPU first-pixel preview, but canonical import never uses browser
  pixels as document authority;
- future RAW/NEF through an isolated decoder capability.

A specialized codec may delay only documents that need it. Worker failures
must include phase and cause; "unknown worker error" is not adequate production
diagnostics.

## PSD/PSB import

The target is editable semantic import, not a flattened viewer. Import order is
bottom-first and must map supported groups, masks, clipping, transforms, blend
modes, opacity/fill, text/vector previews, adjustment layers, styles, patterns
and smart assets into the LightTable model. Unsupported information is listed
in an import report and preserved only when there is an explicit forward path.

Photoshop's embedded composite is useful as transient reference truth for
difference measurement. It is not saved as a second full PSD payload in a
LightTable document. Comparison with zero sampled pixels is invalid and must be
reported as unavailable, never as a 0% error success.

PSD compatibility is implemented as translation into the native document and
processing model. Photoshop is a crucial interchange target and visual truth
source, but it does not define LightTable's internal schema or UX. The same
native model must remain able to represent capabilities PSD cannot express,
including future 3D, AI and LightTable-specific GPU workflows.

## Save and export

- A simple corrected raster can save/export through the host as a normal image
  with its LightTable recipe metadata where appropriate.
- A multilayer document saves the LightTable document model and required assets.
- Export explicitly chooses bit depth, profile/encoding and flattening.
- Sixteen-bit import does not imply sixteen-bit export; the UI and exporter
  must report the actual result.
- Host cancellation is a normal result, not an application error.
- SVG export is available only when visible document content consists of native
  vector/group content whose admitted paths, primitives, transforms, solid or
  linear/radial gradient paint, opacity groups and vector clips can be
  represented exactly. Unsupported semantics reject rather than flatten
  silently.

On desktop, ordinary Save replaces an opened JPEG, PNG, WebP or TIFF in its
original format only when the current model is exactly representable as one
neutral full-canvas raster. JPEG and WebP replacement is 8-bit; PNG and TIFF
replacement supports 8-bit and 16-bit document output. This is a current-state
capability gate, not an edit-history rule: live Grade/Lens Fx, adjustment nodes,
masks, effects, transforms, extra layers or retained document-only assets select
the LightTable document writer. Flatten Image bakes those semantics and can make
the source-format gate eligible again.

Native flat Save uses explicit deterministic encodings: JPEG quality 92 on a
white background, lossless WebP, PNG compression level 6, and deflate TIFF with
a horizontal predictor. File > Export uses the same codec policies for its PNG,
JPEG, WebP and TIFF outputs. These are Save/export policies, not claims that
source codec settings or arbitrary metadata round-trip. User-facing quality,
compression, metadata and animation controls remain separate future work.

The renderer may request source replacement only for the exact path returned
by a trusted desktop open operation. The main process bounds that authority,
checks that path and format agree, refuses replacement after an external file
change, and publishes bytes through the normal atomic writer. Web and hosted
files continue through Save As/download because they do not own a replaceable
filesystem target.

Packaged desktop builds register JPEG/JPG, PNG, WebP and TIFF/TIF as supported
Open With types. Windows registration uses per-user capabilities and ProgIDs
without replacing `UserChoice`; Squirrel install/update registers them and
uninstall removes only LightTable-owned keys and values. Cold process arguments,
warm second-instance arguments and macOS `open-file` events enter the same
bounded launch-file queue and application open flow.

## Clipboard

Keep the in-app LightTable-to-LightTable path fast and semantically rich, while
also interoperating with OS image clipboard formats. Copy uses active-layer
pixels inside the selection; Copy Merged uses the visible composite. Paste
creates a layer at the source bounds when LightTable metadata is available and
uses selection/document placement policy for external bitmap data.

The rich in-app payload is authoritative when available. OS clipboard PNG/
native-image transport must encode the same display/color contract rather than
reinterpret linear working bytes as sRGB; copying merged pixels out and pasting
them back into a new layer must preserve rendered color within the verified
round-trip tolerance.

## Portability boundary

LightTable assets and CSS live in `packages/lighttable-app`. StoryBuilder may
connect its media browser/upload APIs through host capabilities but cannot be a
resource directory. Desktop-only enhancements must sit behind capabilities so
the web build remains complete and testable.
