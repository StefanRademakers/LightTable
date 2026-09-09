import { isFilterKind, type FilterKind, type FilterSettingsMap } from '@lighttable/filter-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { walkRasterLayers } from '../../editor/document/layerTree';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import { filterSettings } from '../../processing/filter';

/** Validates canonical document references carried by otherwise pure filter settings. */
export const filterDocumentReferenceError = <K extends FilterKind>(
  document: ImageDocument,
  kind: K,
  settings: FilterSettingsMap[K]
): string | null => {
  if (kind !== 'displace') return null;
  const mapAssetId = (settings as FilterSettingsMap['displace']).mapAssetId;
  if (!mapAssetId) return null;
  return walkRasterLayers(document.layers).some(({ layer }) => layer.id === mapAssetId)
    ? null
    : 'The displacement map must reference a raster layer in this document.';
};

export const assertFilterStackDocumentReferences = (
  document: ImageDocument,
  kind: string,
  stack: AdjustmentStack
): void => {
  if (!isFilterKind(kind)) return;
  const settings = filterSettings(stack, kind);
  if (!settings) throw new Error('The filter settings are invalid.');
  const error = filterDocumentReferenceError(document, kind, settings);
  if (error) throw new Error(error);
};
