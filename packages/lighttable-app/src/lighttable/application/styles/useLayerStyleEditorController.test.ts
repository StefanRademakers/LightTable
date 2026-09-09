import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { addLayerStyle } from '../../editor/styles/layerStyleCommands';
import { reconcileLayerStyleEditorRequest } from './useLayerStyleEditorController';

describe('Layer Style editor request reconciliation', () => {
  it('normalizes a removed child target to the surviving stack owner', () => {
    let document = createRasterLayer(createImageDocument('Styles', 64, 64, 'source'));
    const layerId = document.activeLayerId!;
    document = addLayerStyle(document, layerId, 'drop-shadow');
    const effectId = findDocumentLayer(document, layerId)!.styleStack.effects[0].id;
    const request = { layerId, effectId, before: document };
    const withoutEffect = {
      ...document,
      layers: document.layers.map((layer) => layer.id === layerId
        ? { ...layer, styleStack: { ...layer.styleStack, effects: [] } }
        : layer)
    };
    expect(reconcileLayerStyleEditorRequest(withoutEffect, request)).toEqual({
      layerId, before: withoutEffect
    });
  });

  it('closes requests for another document or a locked owner', () => {
    const document = createRasterLayer(createImageDocument('Styles', 64, 64, 'source'));
    const layerId = document.activeLayerId!;
    const request = { layerId, before: document };
    expect(reconcileLayerStyleEditorRequest(
      createImageDocument('Other', 64, 64, 'other'), request
    )).toBeNull();
    const locked = { ...document, layers: document.layers.map((layer) => layer.id === layerId
      ? { ...layer, locks: { ...layer.locks, all: true } }
      : layer) };
    expect(reconcileLayerStyleEditorRequest(locked, request)).toBeNull();
  });
});
