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

## Clipboard

Keep the in-app LightTable-to-LightTable path fast and semantically rich, while
also interoperating with OS image clipboard formats. Copy uses active-layer
pixels inside the selection; Copy Merged uses the visible composite. Paste
creates a layer at the source bounds when LightTable metadata is available and
uses selection/document placement policy for external bitmap data.

## Portability boundary

LightTable assets and CSS live in `packages/lighttable-app`. StoryBuilder may
connect its media browser/upload APIs through host capabilities but cannot be a
resource directory. Desktop-only enhancements must sit behind capabilities so
the web build remains complete and testable.
