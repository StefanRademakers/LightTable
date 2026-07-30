import { describe, expect, it } from 'vitest';
import {
  createRasterLayer,
  groupLayers
} from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';
import { queryLayerCommandCapabilities } from './layerCommandCapabilities';

const createDocument = (): ImageDocument =>
  createImageDocument('Capabilities', 64, 64, 'background');

describe('queryLayerCommandCapabilities', () => {
  it('derives single-layer command availability from canonical state', () => {
    const document = createDocument();
    const capabilities = queryLayerCommandCapabilities(document);

    expect(capabilities.layerCount).toBe(1);
    expect(capabilities.rasterLayerCount).toBe(1);
    expect(capabilities.activeIndex).toBe(0);
    expect(capabilities.canMergeDown).toBe(false);
    expect(capabilities.canFlattenImage).toBe(true);
    expect(capabilities.canToggleActiveClipping).toBe(false);
  });

  it('shares merge, clipping and flatten decisions across presentations', () => {
    const document = createRasterLayer(createDocument(), 'Upper');
    const layerIds = walkLayerTree(document.layers).map(({ node }) => node.id);
    const capabilities = queryLayerCommandCapabilities(document, layerIds);

    expect(capabilities.canGroupSelection).toBe(true);
    expect(capabilities.canMergeSelected).toBe(true);
    expect(capabilities.canMergeDown).toBe(true);
    expect(capabilities.canFlattenImage).toBe(true);
    expect(capabilities.canToggleActiveClipping).toBe(true);
  });

  it('rejects grouping layers from different parents and recognizes groups', () => {
    const twoLayers = createRasterLayer(createDocument(), 'Nested');
    const grouped = groupLayers(
      twoLayers,
      walkLayerTree(twoLayers.layers).map(({ node }) => node.id),
      'Group'
    );
    const group = grouped.layers.find((layer) => layer.type === 'group')!;
    const withRootLayer = createRasterLayer(grouped, 'Root');
    const rootLayer = withRootLayer.layers.find((layer) => layer.type === 'raster')!;
    const nestedLayer = walkLayerTree(withRootLayer.layers)
      .find(({ parentId, node }) => parentId === group.id && node.type === 'raster')!.node;
    const capabilities = queryLayerCommandCapabilities(
      withRootLayer,
      [rootLayer.id, nestedLayer.id, group.id]
    );

    expect(capabilities.canGroupSelection).toBe(false);
    expect(capabilities.canUngroupSelection).toBe(true);
  });
});
