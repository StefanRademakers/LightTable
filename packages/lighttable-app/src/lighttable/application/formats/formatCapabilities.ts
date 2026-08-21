export type FormatSupportLevel = 'supported' | 'partial' | 'unavailable';

export interface FormatCapability {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly open: FormatSupportLevel;
  readonly editable: FormatSupportLevel;
  readonly export: FormatSupportLevel;
  readonly summary: string;
}

/** Product-owned capability projection shared by Open/Export UI and tests. */
export const LIGHTTABLE_FORMAT_CAPABILITIES: readonly FormatCapability[] = Object.freeze([
  {
    id: 'lighttable', label: 'LightTable', extensions: ['.png'],
    open: 'supported', editable: 'supported', export: 'supported',
    summary: 'Native layered LightTable document in a PNG-compatible container.'
  },
  {
    id: 'png', label: 'PNG', extensions: ['.png'],
    open: 'supported', editable: 'partial', export: 'supported',
    summary: 'Still raster import, native flat 8/16-bit Save, and flattened 8-bit quick export.'
  },
  {
    id: 'jpeg', label: 'JPEG', extensions: ['.jpg', '.jpeg', '.jpe', '.jfif'],
    open: 'supported', editable: 'partial', export: 'supported',
    summary: 'Still raster import and flattened 8-bit JPEG export on a white background.'
  },
  {
    id: 'webp', label: 'WebP', extensions: ['.webp'],
    open: 'supported', editable: 'partial', export: 'supported',
    summary: 'Still raster import plus native flat Save and export as 8-bit lossless WebP; animation is unavailable.'
  },
  {
    id: 'tiff', label: 'TIFF / BigTIFF', extensions: ['.tif', '.tiff'],
    open: 'supported', editable: 'partial', export: 'supported',
    summary: 'Precision still-raster import plus native flat Save and export as 8/16-bit TIFF; multipage TIFF is unavailable.'
  },
  {
    id: 'psd', label: 'Photoshop PSD', extensions: ['.psd'],
    open: 'supported', editable: 'partial', export: 'partial',
    summary: 'Semantic import; appearance-safe 8-bit RGB Editable export for the verified subset, plus an explicit flattened Maximum Appearance export.'
  },
  {
    id: 'psb', label: 'Photoshop PSB', extensions: ['.psb'],
    open: 'supported', editable: 'partial', export: 'unavailable',
    summary: 'Uses the PSD import adapter; large-document export remains validation-gated.'
  },
  {
    id: 'pdf', label: 'PDF', extensions: ['.pdf'],
    open: 'partial', editable: 'partial', export: 'partial',
    summary: 'First-page raster import; preflighted one-page flattened or compatible hybrid export.'
  },
  {
    id: 'ai', label: 'Adobe Illustrator', extensions: ['.ai'],
    open: 'unavailable', editable: 'unavailable', export: 'unavailable',
    summary: 'Planned compatibility research; no product open or export route.'
  },
  {
    id: 'svg', label: 'SVG', extensions: ['.svg'],
    open: 'supported', editable: 'partial', export: 'partial',
    summary: 'Bounded native editable paths, primitives, transforms, solid fills and strokes; unsupported semantics reject explicitly.'
  },
  {
    id: 'eps', label: 'EPS', extensions: ['.eps'],
    open: 'unavailable', editable: 'unavailable', export: 'unavailable',
    summary: 'Not currently exposed as a supported product format.'
  }
]);
