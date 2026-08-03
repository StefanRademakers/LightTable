# PDF semantic extraction spike

Status: Slice 19 decision evidence
Checked: 2026-08-03

## Decision

Use a pinned PDFium build behind `@lighttable/pdf-core` for production PDF and
PDF-compatible Illustrator import. Do not consume PDFium handles outside the
adapter and do not use `FPDFText_GetText()` as a display-list source.

The stock public API is sufficient for page-object enumeration, effective
character matrices, origins, text rendering mode and decoded font data. It is
not sufficient for exact positioned text because it does not expose the
original character code, CID and resolved glyph ID together. A small maintained
PDFium adapter is therefore a hard gate, not an optional optimization.

MuPDF is the independent extraction and rendering oracle for the fixture
corpus. Its device model exposes glyph IDs, CID/raw codes, Unicode, advances,
glyph positions and text transforms directly. MuPDF is AGPL-3.0 or commercially
licensed, so no MuPDF source or binary may ship in LightTable under the current
licensing assumptions.

## Sources and pinned research revisions

- PDFium `2870fa9244b0f0f69fb743fab1e08deefcb07b2b`, inspected from a shallow
  sparse checkout in ignored `.referenceCode/pdfium`.
- MuPDF `838d1c0792fafc0d9840ebfc5c2c62b77a001bd7`, inspected from a shallow
  sparse checkout in ignored `.referenceCode/mupdf`.
- [PDFium text extraction API](https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_text.h)
- [PDFium page-object and font API](https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_edit.h)
- [MuPDF text representation](https://mupdf.readthedocs.io/en/latest/_static/generated/c/html/text_8h.html)
- [MuPDF device API](https://mupdf.readthedocs.io/en/latest/_static/generated/c/html/device_8h.html)
- [PDFium Rust wrapper and WASM packaging notes](https://github.com/ajrcarey/pdfium-render)

## Capability result

| Required value | Stock PDFium public API | PDFium internal evidence | MuPDF oracle | Decision |
|---|---|---|---|---|
| Content-stream order | Page-object enumeration | `CPDF_TextObject` retains parsed items | Page run through custom `fz_device` | Enumerate page objects, never reading-order text |
| Effective character matrix | `FPDFText_GetMatrix` | `CharInfo.matrix()` is text matrix times enclosing form matrices | span `trm`, item x/y and device CTM | Public PDFium result is usable and oracle-comparable |
| Character origin/bounds | `FPDFText_GetCharOrigin`, box APIs | `CharInfo.origin()` and item origin | item x/y and advance | Use origins and advances; bounds are not advance |
| PDF character-code bytes | Not exposed | `CPDF_TextObject::GetCharCode`; `CPDF_Font::AppendChar` reconstructs encoded bytes | item `cid` retains CID/raw code, not byte sequence | Add adapter field and retain bytes separately from Unicode |
| CID | Not exposed | `CPDF_CIDFont::CIDFromCharCode` | `fz_text_item.cid` | Add adapter field |
| Resolved glyph ID | Glyph path API accepts a glyph but extraction does not return it | `CPDF_Font::GlyphFromCharCode` is the renderer mapping | `fz_text_item.gid` | Add adapter field; never reshape imported text |
| Unicode mapping | Per-character Unicode and object UTF-16 | `UnicodeFromCharCode`, ActualText handling | item `ucs`; mappings can be one-to-many | Store separately with confidence/source |
| Advance and positioning | Origin of adjacent characters can be inferred but is lossy | item origin, char width, word/character spacing and TJ kernings exist | item `adv` and transform | Adapter exports evaluated origin and advance directly |
| Text render mode 0–7 | `FPDFTextObj_GetTextRenderMode` | exact `TextRenderingMode` on object | fill/stroke/clip/ignore device callbacks | Preserve the original integer mode; do not infer from callbacks |
| Embedded font bytes | `FPDFFont_GetFontData` plus `FPDFFont_GetIsEmbedded` | decoded embedded stream or substitution face | font buffer is retained internally | Accept bytes only when `GetIsEmbedded == 1`; fingerprint immediately |
| Type 3 programs | Font is reported embedded, but not a normal outline font | Type 3 char procedures remain PDF programs | device can render/cache Type 3 display lists | Preserve bounded programs and use sandboxed preview until Slice 20 |

## Required PDFium adapter ABI

Implement the engine bridge as bulk extraction so a PDF with thousands of
glyphs does not make thousands of JS/WASM or FFI round trips. Names below are
LightTable bridge names, not proposed upstream PDFium public APIs.

```c
typedef struct LT_PDF_GLYPH_INFO {
  uint32_t char_code;
  uint16_t cid;
  int32_t glyph_id;
  uint8_t source_bytes[4];
  uint8_t source_byte_count;
  double origin_x, origin_y;
  double advance_x, advance_y;
  FS_MATRIX glyph_matrix;
} LT_PDF_GLYPH_INFO;

size_t LT_PDFTextObj_GetGlyphCount(FPDF_PAGEOBJECT text_object);
FPDF_BOOL LT_PDFTextObj_GetGlyphs(
    FPDF_PAGEOBJECT text_object,
    LT_PDF_GLYPH_INFO* output,
    size_t capacity,
    size_t* required);
```

The implementation reads `CPDF_TextObject` items in original order, uses
`CPDF_Font::AppendChar()` for encoded bytes, `CIDFromCharCode()` when applicable,
and `GlyphFromCharCode()` for the actual face mapping. It evaluates origin,
advance and glyph matrix once inside PDFium. It must mark generated/substitution
glyphs instead of presenting them as exact source data.

The bridge also needs bulk resource enumeration for embedded font streams,
images, paths, clips and forms. Every returned buffer is copied into a bounded,
serializable `PdfNormalizedDisplayList`; no PDFium pointer crosses that boundary.

## Desktop and web build direction

- Desktop: ship a pinned native PDFium dynamic library beside Electron and call
  the adapter from a dedicated utility/worker process. Disable V8, XFA and
  JavaScript because they are unnecessary for semantic page import.
- Web: compile the same adapter and pinned PDFium revision as a separately lazy
  WASM module. Load it only after a PDF/AI document is probed. Use a dedicated
  worker, bounded initial memory plus controlled growth, and transfer normalized
  batches rather than per-glyph calls.
- Rust may own the safe host wrapper and validation, but it does not replace the
  C++ PDFium adapter. `pdfium-render` demonstrates native/WASM binding patterns;
  its stock bindings cannot supply the missing glyph tuple.
- PDF.js remains useful for browser visual diagnostics, but its public
  `getTextContent()` contract exposes Unicode strings, transforms and a converted
  font name rather than exact PDF glyph IDs and source codes. It is not the
  semantic importer.

## Fixture and acceptance gates

Before enabling PDF import in the UI, a generated fixture corpus must include:

1. simple Type 1/TrueType text, Type 0/CID text and multibyte CMaps;
2. embedded subset and non-embedded substitution fonts;
3. every text rendering mode 0 through 7;
4. `TJ` offsets, character/word spacing, horizontal scale, rise and vertical text;
5. rotated/skewed text inside nested form transforms;
6. ligatures and one-to-many/many-to-one Unicode mappings;
7. bounded Type 3 glyphs and intentionally malformed limits.

For every fixture, compare PDFium adapter output with the MuPDF device trace and
a raster reference at multiple scales. The gate fails on a glyph-ID, CID,
matrix, advance, render-mode or embedded-font fingerprint mismatch. Unicode
differences are recorded separately because extraction mappings can legitimately
differ from visual glyph identity.

## Rejected paths

- Stock PDFium public text extraction alone: it loses the exact glyph tuple.
- PDF.js `getTextContent()` as importer: designed for text-layer/search content,
  not a lossless page display list.
- MuPDF as a shipped dependency: licensing is incompatible without an explicit
  commercial or AGPL product decision.
- Re-shaping extracted Unicode with HarfBuzz: changes authored glyph selection
  and positioning and therefore breaks fixed-layout compatibility.
