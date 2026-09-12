import type { HybridPdfPageExportReason } from './planHybridPdfPageExport';
import type { HybridPdfVectorPageExportReason } from './planHybridPdfVectorPageExport';
import type { HybridPdfNativePageExportReason } from './planHybridPdfNativePageExport';

export const hybridPdfReasonLabel: Record<HybridPdfPageExportReason, string> = {
  'text-plan-blocked': 'the text preflight is blocked',
  'no-native-text': 'no text layer can be emitted natively',
  'stale-native-layer': 'the document changed after preflight',
  'native-text-not-topmost': 'non-text content is above native text',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
export const hybridPdfVectorReasonLabel: Record<HybridPdfVectorPageExportReason, string> = {
  'no-native-vectors': 'no visible vector layer can be emitted natively',
  'native-vectors-not-topmost': 'non-vector content is above native vectors',
  'vector-effects-unsupported': 'a vector or ancestor uses unsupported masks, clipping, blend or effects',
  'vector-blend-mode-unsupported': 'the vector layer blend mode has no exact PDF equivalent',
  'vector-stroke-alignment-unsupported': 'inside or outside vector strokes require outlining first',
  'vector-gradient-unsupported': 'vector gradients require native PDF shading export',
  'vector-clipping-unsupported': 'vector clipping requires one opaque fill-only vector base',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
export const hybridPdfNativeReasonLabel: Record<HybridPdfNativePageExportReason, string> = {
  'no-native-content': 'no text or vector layer can be emitted natively',
  'native-content-not-topmost': 'non-native content interrupts the native top layer stack',
  'stale-native-text-layer': 'the document changed after text preflight',
  'vector-content-unsupported': 'a top vector uses unsupported compositing or stroke alignment',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
