# Third-party software, licenses and format support

Status: implementation inventory, 2026-08-03. This document records what the
current repository actually uses and implements. It is not a legal opinion and
does not turn a planned codec into product support.

## Source of truth and release policy

The exhaustive machine-readable dependency snapshot is
[`reference/implementation/THIRD_PARTY_DEPENDENCY_INVENTORY.json`](reference/implementation/THIRD_PARTY_DEPENDENCY_INVENTORY.json).
It is generated from the pinned `package-lock.json`, `Cargo.lock` and Cargo
metadata:

```text
npm run generate:third-party
npm run verify:third-party
```

The current snapshot contains 637 npm package/version entries, 80 Cargo crates
and no unknown license fields. Multiple versions are deliberately separate.
The inventory separates direct/transitive and runtime/development roles so a
future About > Licenses view can filter the same data without maintaining a
second handwritten list.

Release review must still collect the complete license and notice texts from
the artifacts that are actually distributed. In particular, package metadata
alone is insufficient for Electron/Chromium and for the native libraries
compiled into `wasm-vips`. Any `UNKNOWN` inventory entry blocks a release.

## Direct runtime libraries and assets

| Component | Resolved version | License | Product role |
|---|---:|---|---|
| React / React DOM | 19.2.8 | MIT | Shared web and Electron UI |
| Dockview React | 7.0.4 | MIT | Docked workspace panels |
| ag-psd | 31.0.2 | MIT | Lazy PSD/PSB parser and structural serializer tests |
| PDF.js (`pdfjs-dist`) | 5.4.624 | Apache-2.0 | Lazy first-page PDF raster preview for web and Electron; not the semantic importer |
| pdf-lib | 1.17.1 | MIT | Lazy bounded one-page flattened and hybrid raster-underlay/native-text/native-vector PDF writer |
| HarfBuzzJS subset WASM (`harfbuzzjs`) | 1.5.0 | MIT | Lazy retain-GID SFNT/CFF/CFF2 font subsetting for PDF export transactions |
| woff-lib | 0.0.3 | MIT | Lazy, CSP-safe WOFF/WOFF2 to SFNT decode before PDF font subsetting |
| wasm-vips wrapper | 0.0.18 | MIT | Lazy precision image decoder |
| libvips codec bundle inside wasm-vips | package notice set | LGPLv3 and mixed permissive licenses | PNG/TIFF/JPEG/WebP precision decode; use upstream `THIRD-PARTY-NOTICES.md` for the complete bundled list |
| Transformers.js | 3.8.1 | Apache-2.0 | Lazy depth-estimation worker |
| Depth Anything V2 Small ONNX | remote model repository | Apache-2.0 | Downloaded only when depth estimation is requested; model id is `onnx-community/depth-anything-v2-small-ONNX` |
| Inter | 5.3.0 font package | OFL-1.1 | Default UI/text face |
| JetBrains Mono | 5.2.8 font package | OFL-1.1 | Bundled testable monospace face |
| Noto Sans | 5.2.8 font package | OFL-1.1 | Bundled fallback face |
| Source Serif 4 | 5.2.8 font package | OFL-1.1 | Bundled serif face |
| HarfBuzz `hb-gpu` WGSL | commit `c31bd6797...` | HarfBuzz old-style MIT license | Conditional renderer prototype; notices remain embedded in the generated shader |

The direct Rust/WASM text stack is pinned as follows:

| Crate | Version | License |
|---|---:|---|
| fontique | 0.11.0 | Apache-2.0 OR MIT |
| icu_segmenter | 2.1.2 | Unicode-3.0 |
| parley | 0.11.0 | Apache-2.0 OR MIT |
| read-fonts | 0.40.2 | MIT OR Apache-2.0 |
| serde / serde_json | 1.0.228 / 1.0.149 | MIT OR Apache-2.0 |
| skrifa | 0.43.2 | MIT OR Apache-2.0 |
| wasm-bindgen | 0.2.126 | MIT OR Apache-2.0 |
| woff2-patched | 0.4.0 | Apache-2.0 |
| zeno | 0.3.3 | Apache-2.0 OR MIT |

The build/test toolchain is also present in the exhaustive inventory. Its main
direct components are Electron 39.8.10, Electron Forge 7.11.2, Vite 8.1.5,
Vitest 4.1.10, TypeScript 5.9.3, `wgsl_reflect` 1.5.0 and WebGPU type
definitions 0.1.71. Electron is declared as a development dependency but its
runtime and Chromium notices are part of the packaged desktop release review.

## Format-support vocabulary

- **Open**: accepted by the production open flow and decoded into a document.
- **Editable semantic import**: supported objects become canonical LightTable
  objects. It never means every feature in the source format is editable.
- **Preserved/reported**: retained through an intentional carrier and reported,
  or kept preview-backed. It is not an editability claim.
- **Save**: writes the native LightTable document or a simple graded PNG.
- **Export**: writes a deliverable. Quick export is PNG; the PDF preflight can
  write one flattened page or a compatible hybrid raster-underlay with native text or vectors.
- **Research/target**: architecture exists, but the file format is not accepted
  by the product and must not appear as supported in UI.

## Current format matrix

| Format/specification family | Open | Semantic/editable status | Save/export | Current boundary |
|---|---|---|---|---|
| LightTable layered PNG, manifest v1-v3 | Yes; v1-v3 read | Native layers, vectors, flow/positioned text, fonts, masks, styles, patterns, grades and preserved-source records according to schema version | Save writes v3 in a PNG-compatible container | Private `LTBLDOC1` footer and typed manifest; not a public PNG extension standard |
| PNG, W3C PNG Third Edition | Yes | Imported as a still raster; 16-bit input selects the precision path | Flat/native preview and quick export are 8-bit PNG | APNG animation/timeline editing and full metadata round-trip are not implemented |
| JPEG, ITU-T T.81 / ISO/IEC 10918-1 family | Yes | Still raster, 8-bit product path | No JPEG export | Decoder acceptance is browser/libvips dependent; JPEG metadata is not an editable document model |
| WebP RIFF container with VP8/VP8L | Yes | Still lossy/lossless raster with decoder-provided alpha/profile handling | No WebP export | Animation/timeline and metadata round-trip are not implemented |
| TIFF 6.0 and BigTIFF signatures | Yes through lazy wasm-vips | Precision still-raster import | No TIFF export | Multi-page TIFF, arbitrary private tags and metadata round-trip are not product features |
| Adobe PSD v1 (`8BPS`, version 1) | Yes through lazy worker | Progressive semantic import with separate structural, editable, visual and round-trip parity; unsupported data is reported/preview-backed | No PSD export | Requires an embedded composite; 8/16/32-bit preview conversion; max 30,000 px per side, 400 Mpx, 10,000 layers, depth 128 and 1 GiB decoded budget |
| Adobe PSB v2 (`8BPS`, version 2) | Recognized and routed to the PSD worker | Same adapter target, but representative PSB fixture validation remains incomplete | No PSB export | LightTable intentionally keeps the 30,000 px safety limit, below the 300,000 px PSB format maximum |
| PDF 1.7 / ISO 32000-1 and PDF 2.0 / ISO 32000-2:2020 | Yes; first page through lazy PDF.js preview | Imported as one 300-ppi raster layer while the original PDF remains an immutable preserved source; canonical positioned-text and display-list contracts are not connected to production parsing yet | Native LightTable save preserves the source; PDF preflight exports one flattened page or a fail-closed raster underlay with a compatible topmost searchable-text or native-vector suffix | Password handling, page selection, multipage documents, semantic import and general vector/group/text interleaving remain gated; the preview must not be presented as editable PDF structure |
| Adobe Illustrator `.ai` | No | No AI parser. A future PDF-compatible AI path may reuse a verified PDF display-list adapter, but native Illustrator-private data needs separate preservation rules | No | Do not equate “PDF-compatible AI file” with implemented AI support |
| SVG, EPS, RAW/NEF, HEIF/AVIF/JXL | No product open route | None | No | Some transitive codecs may exist inside wasm-vips; that does not make them supported LightTable formats |

## Normative and implementation references

- PNG: [W3C PNG Specification, Third Edition](https://www.w3.org/TR/png-3/),
  Recommendation of 24 June 2025.
- JPEG: [ITU-T Recommendation T.81](https://www.itu.int/rec/T-REC-T.81-199209-I/en),
  the ISO/IEC 10918-1 baseline family reference.
- WebP: [Google WebP RIFF Container Specification](https://developers.google.com/speed/webp/docs/riff_container),
  including VP8, VP8L, alpha, ICC and animation container semantics. LightTable
  currently consumes only a decoded still image.
- TIFF: TIFF Revision 6.0 plus BigTIFF signatures as accepted by the pinned
  libvips/libtiff bundle. Decoder breadth is not a promise to edit every TIFF
  tag or page.
- PSD/PSB: [Adobe Photoshop File Formats Specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/).
  PSD is version 1 and PSB version 2; LightTable support is the tested subset in
  the matrix, not the complete Adobe feature set.
- PDF: ISO 32000-1 (PDF 1.7) and ISO 32000-2:2020 (PDF 2.0). Current product
  support is the bounded first-page raster preview in the matrix; exact object
  import and PDF export remain separately gated.

## Future UI exposure

Use this data in two existing UI patterns rather than inventing editor controls:

1. **About > Third-party software** reads runtime entries from the generated
   inventory and links/copies the full notices shipped with that build.
2. **Open/Export > Format support** reads a small product-owned capability
   projection of the matrix: Open, Editable subset, Preserved/report-only,
   Export and Planned. It must show bit-depth and structure limits beside the
   relevant codec.

The UI source should be generated or tested against the same capability
registries used by the file picker and exporters. This Markdown document is the
human contract; it must not become a second hard-coded runtime truth source.
