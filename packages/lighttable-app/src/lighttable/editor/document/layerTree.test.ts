import { describe, expect, it } from 'vitest';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  type LayerNode
} from './documentTypes';
import {
  findLayerNode,
  insertLayerNode,
  moveLayerNode,
  removeLayerNode,
  updateLayerNode,
  walkLayerTree
} from './layerTree';

const fixture = () => {
  const raster = createImageDocument('Tree', 16, 9, 'asset').layers[0];
  const group = createGroupLayer('People');
  const adjustment = createAdjustmentLayer(
    createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
    'Warm grade'
  );
  group.children = [raster, adjustment];
  return { raster, group, adjustment, nodes: [group] as LayerNode[] };
};

describe('LightTable canonical layer tree', () => {
  it('walks nested nodes in stable bottom-to-top order with paths', () => {
    const { nodes } = fixture();
    expect(walkLayerTree(nodes).map(({ node, path }) => [node.name, path])).toEqual([
      ['People', [0]],
      ['Background', [0, 0]],
      ['Warm grade', [0, 1]]
    ]);
  });

  it('finds and immutably updates nested nodes', () => {
    const { nodes, adjustment, group } = fixture();
    const updated = updateLayerNode(nodes, adjustment.id, (node) => ({ ...node, visible: false }));
    expect(findLayerNode(updated, adjustment.id)?.node.visible).toBe(false);
    expect(nodes[0]).toBe(group);
    expect(updated[0]).not.toBe(group);
  });

  it('inserts into groups and removes the exact nested node', () => {
    const { nodes, group } = fixture();
    const nested = createGroupLayer('Nested');
    const inserted = insertLayerNode(nodes, nested, group.id, 1);
    expect((inserted[0].type === 'group' ? inserted[0].children : []).map(({ name }) => name))
      .toEqual(['Background', 'Nested', 'Warm grade']);
    const removed = removeLayerNode(inserted, nested.id);
    expect(removed.removed?.id).toBe(nested.id);
    expect(findLayerNode(removed.nodes, nested.id)).toBeNull();
  });

  it('moves nodes between root and groups without allowing recursive groups', () => {
    const { raster, group, adjustment, nodes } = fixture();
    const nested = createGroupLayer('Nested');
    const withNested = insertLayerNode(nodes, nested, group.id);

    const adjustmentAtRoot = moveLayerNode(withNested, adjustment.id, null, 0);
    expect(adjustmentAtRoot[0].id).toBe(adjustment.id);
    expect(findLayerNode(adjustmentAtRoot, adjustment.id)?.parentId).toBeNull();

    const rasterInNested = moveLayerNode(adjustmentAtRoot, raster.id, nested.id, 0);
    expect(findLayerNode(rasterInNested, raster.id)?.parentId).toBe(nested.id);

    expect(moveLayerNode(rasterInNested, group.id, nested.id, 0)).toBe(rasterInNested);
    expect(moveLayerNode(rasterInNested, nested.id, nested.id, 0)).toBe(rasterInNested);
  });
});
