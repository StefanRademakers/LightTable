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
    summary: 'Still raster import and flattened 8-bit PNG export.'
  },
  {
    id: 'jpeg', label: 'JPEG', extensions: ['.jpg', '.jpeg', '.jpe', '.jfif'],
    open: 'supported', editable: 'partial', export: 'unavailable',
    summary: 'Still raster import; metadata round-trip and JPEG export are unavailable.'
  },
  {
    id: 'webp', label: 'WebP', extensions: ['.webp'],
    open: 'supported', editable: 'partial', export: 'unavailable',
    summary: 'Still raster import; animation and WebP export are unavailable.'
  },
  {
    id: 'tiff', label: 'TIFF / BigTIFF', extensions: ['.tif', '.tiff'],
    open: 'supported', editable: 'partial', export: 'unavailable',
    summary: 'Precision still-raster import; multipage TIFF and export are unavailable.'
  },
  {
    id: 'psd', label: 'Photoshop PSD', extensions: ['.psd'],
    open: 'supported', editable: 'partial', export: 'partial',
    summary: 'Semantic import plus fail-closed 8-bit RGB export for the Photoshop-verified editable subset.'
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
    id: 'svg-eps', label: 'SVG / EPS', extensions: ['.svg', '.eps'],
    open: 'unavailable', editable: 'unavailable', export: 'unavailable',
    summary: 'Not currently exposed as supported product formats.'
  }
]);
