import { describe, expect, it } from 'vitest';
import { setLayersVisibility } from '../../editor/document/documentCommands';
import {
  createGroupLayer,
  createImageDocument,
  type ImageDocument,
  type LayerNode
} from '../../editor/document/documentTypes';
import { findLayerNode } from '../../editor/document/layerTree';
import {
  canRestoreLayerVisibility,
  captureLayerVisibility,
  planRestoreLayerVisibility,
  planSoloLayerVisibility,
  type LayerVisibilityChange
} from './layerVisibilityIsolation';

const apply = (document: ImageDocument, changes: readonly LayerVisibilityChange[]) =>
  changes.reduce((current, change) =>
    setLayersVisibility(current, [...change.layerIds], change.visible), document);

const fixture = () => {
  const competitor = createImageDocument('Competitor', 16, 16, 'asset').layers[0]!;
  const visibleChild = createImageDocument('Visible', 16, 16, 'asset').layers[0]!;
  const hiddenChild = {
    ...createImageDocument('Hidden', 16, 16, 'asset').layers[0]!,
    visible: false
  };
  const group = createGroupLayer('Target group');
  group.children = [visibleChild, hiddenChild];
  const document = {
    ...createImageDocument('Visibility', 16, 16, 'asset'),
    layers: [competitor, group] as LayerNode[],
    activeLayerId: group.id
  };
  return { document, competitor, group, visibleChild, hiddenChild };
};

describe('layer visibility isolation', () => {
  it('isolates a group without changing its child visibility flags and restores exactly', () => {
    const { document, competitor, group, visibleChild, hiddenChild } = fixture();
    const snapshot = captureLayerVisibility(document, group.id);
    const isolated = apply(document, planSoloLayerVisibility(document, group.id));

    expect(findLayerNode(isolated.layers, competitor.id)?.node.visible).toBe(false);
    expect(findLayerNode(isolated.layers, visibleChild.id)?.node.visible).toBe(true);
    expect(findLayerNode(isolated.layers, hiddenChild.id)?.node.visible).toBe(false);
    expect(canRestoreLayerVisibility(isolated, snapshot)).toBe(true);

    const restored = apply(isolated, planRestoreLayerVisibility(isolated, snapshot));
    expect(restored.layers.map((layer) => layer.visible)).toEqual([true, true]);
    expect(findLayerNode(restored.layers, hiddenChild.id)?.node.visible).toBe(false);
  });

  it('refuses the remembered restore after any intervening visibility change', () => {
    const { document, group, hiddenChild } = fixture();
    const snapshot = captureLayerVisibility(document, group.id);
    const isolated = apply(document, planSoloLayerVisibility(document, group.id));
    const changed = setLayersVisibility(isolated, [hiddenChild.id], true);

    expect(canRestoreLayerVisibility(changed, snapshot)).toBe(false);
    expect(planRestoreLayerVisibility(changed, snapshot)).toEqual([]);
  });
});
