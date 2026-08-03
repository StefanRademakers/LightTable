import type {
  DocumentFontAsset,
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import { formatFlowTextSource } from './flowTextFormatting';
import { textFontPatch } from './textPropertyPresentation';

/**
 * Replaces every authored run of one editable flow-text layer.
 *
 * The command deliberately routes through the canonical text mutation path so
 * revisions, locks, derived-preview invalidation and persistence all observe
 * the same atomic edit as the property bar.
 */
export const replaceMissingTextFont = (
  document: ImageDocument,
  layerId: LayerId,
  asset: DocumentFontAsset
): ImageDocument => {
  const layer = findDocumentLayer(document, layerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
  return applyTextLayerDataMutation(document, layerId, {
    ...layer.text,
    source: formatFlowTextSource(
      layer.text.source,
      null,
      textFontPatch(asset),
      {}
    )
  });
};
