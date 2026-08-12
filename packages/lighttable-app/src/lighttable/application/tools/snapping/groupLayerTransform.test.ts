import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import {
  createGroupLayer,
  createRasterLayer,
  moveLayerIntoGroup
} from '../../../editor/document/documentCommands';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import {
  topLevelTransformLayerIds,
  transformLayerGroupInDocumentSpace
} from './groupLayerTransform';

describe('multi-layer document-space transform', () => {
  it('moves differently transformed layers by one identical document delta', () => {
    const base = createImageDocument('group', 100, 100, 'asset');
    const withFirst = createRasterLayer(base, 'first');
    const withSecond = createRasterLayer(withFirst, 'second');
    const first = { ...withSecond.layers[0], transform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 } };
    const second = { ...withSecond.layers[1], transform: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 40 } };
    const document = { ...withSecond, layers: [first, second], activeLayerId: second.id };
    const moved = transformLayerGroupInDocumentSpace(document, [first.id, second.id], {
      a: 1, b: 0, c: 0, d: 1, tx: 8, ty: -3
    });
    expect(moved.layers[0].transform).toMatchObject({ tx: 13, ty: 4 });
    expect(moved.layers[1].transform).toMatchObject({ a: 2, d: 2, tx: 38, ty: 37 });
  });

  it('transforms a selected group without applying the delta twice to a selected child', () => {
    const base = createImageDocument('nested', 100, 100, 'asset');
    const withChild = createRasterLayer(base, 'child');
    const childId = withChild.activeLayerId!;
    const withGroup = createGroupLayer(withChild, 'group');
    const groupId = withGroup.activeLayerId!;
    const nested = moveLayerIntoGroup(withGroup, childId, groupId);

    expect(topLevelTransformLayerIds(nested, [groupId, childId])).toEqual([groupId]);
    const moved = transformLayerGroupInDocumentSpace(nested, [groupId, childId], {
      a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 4
    });
    expect(findDocumentLayer(moved, groupId)?.transform).toMatchObject({ tx: 12, ty: 4 });
    expect(findDocumentLayer(moved, childId)?.transform).toMatchObject({ tx: 0, ty: 0 });
  });
});
