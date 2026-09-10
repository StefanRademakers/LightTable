import type { ImageDocument, LayerId } from '../document/documentTypes';
import { findDocumentLayer } from '../document/layerTree';
import { createDefaultLayerStyle } from './layerStyleDefaults';
import { writeLayerStyleStack } from './layerStyleDocumentWriter';
import type { LayerStyleId, LayerStyleInstance, LayerStyleKind } from './layerStyleTypes';

/** Test-only construction helpers. Never use these as application mutation routes. */
export const addLayerStyleFixture = (
  document: ImageDocument,
  layerId: LayerId,
  kind: LayerStyleKind
) => {
  const layer = findDocumentLayer(document, layerId);
  if (!layer) return document;
  return writeLayerStyleStack(document, layerId, {
    ...layer.styleStack,
    effects: [...layer.styleStack.effects, createDefaultLayerStyle(kind)],
    revision: layer.styleStack.revision + 1
  });
};

export const updateLayerStyleFixture = (
  document: ImageDocument,
  layerId: LayerId,
  effectId: LayerStyleId,
  update: (effect: LayerStyleInstance) => LayerStyleInstance
) => {
  const layer = findDocumentLayer(document, layerId);
  if (!layer) return document;
  return writeLayerStyleStack(document, layerId, {
    ...layer.styleStack,
    effects: layer.styleStack.effects.map((effect) => effect.id === effectId
      ? update(structuredClone(effect))
      : effect),
    revision: layer.styleStack.revision + 1
  });
};
