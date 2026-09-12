import type { PropertiesInspectorView } from '../../application/properties/propertiesInspectorTarget';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface RetainedImagePropertiesView {
  current: PropertiesInspectorView;
}

/** Keeps a hidden image inspector stable while a typed document is presented. */
export const projectRetainedImagePropertiesView = (
  retained: RetainedImagePropertiesView,
  documentKind: 'image' | 'video' | 'model-3d',
  projected: PropertiesInspectorView
): PropertiesInspectorView => {
  if (documentKind === 'image') retained.current = projected;
  return documentKind === 'image' ? projected : retained.current;
};

export const activeLayerCanOwnGrade = (document: ImageDocument | null): boolean => {
  if (!document?.activeLayerId) return false;
  const active = findDocumentLayer(document, document.activeLayerId);
  return active?.type === 'raster' || active?.type === 'adjustment';
};
