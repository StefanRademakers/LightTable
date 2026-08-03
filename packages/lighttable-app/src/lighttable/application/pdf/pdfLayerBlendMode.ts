import type { PdfBlendMode } from '@lighttable/pdf-core';
import type { BlendMode } from '../../editor/document/blendModes';

const supported = new Set<PdfBlendMode>([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity'
]);

export const pdfLayerBlendMode = (mode: BlendMode): Exclude<PdfBlendMode, 'unsupported'> | null => (
  supported.has(mode as PdfBlendMode)
    ? mode as Exclude<PdfBlendMode, 'unsupported'>
    : null
);
