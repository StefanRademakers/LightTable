import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import {
  createImageDocument,
  createTextLayerNode,
  createVectorLayer
} from '../document/documentTypes';
import { createDefaultLayerStyle } from '../styles/layerStyleDefaults';
import { activeLayerStyleRuntimeOwners } from './layerStyleRuntimeOwners';

describe('activeLayerStyleRuntimeOwners', () => {
  it('drops deleted text/vector owners and owners whose styles are no longer active', () => {
    const document = createImageDocument('Styles', 40, 30, 'asset');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const vector = createVectorLayer([], 'Vector');
    text.styleStack.effects = [createDefaultLayerStyle('drop-shadow')];
    vector.styleStack.effects = [createDefaultLayerStyle('stroke')];
    document.layers = [document.layers[0], text, vector];

    expect([...activeLayerStyleRuntimeOwners(document)]).toEqual([text.id, vector.id]);

    const afterDelete = { ...document, layers: [document.layers[0], text] };
    expect([...activeLayerStyleRuntimeOwners(afterDelete)]).toEqual([text.id]);

    text.styleStack = { ...text.styleStack, enabled: false };
    expect(activeLayerStyleRuntimeOwners(afterDelete).size).toBe(0);
  });
});
