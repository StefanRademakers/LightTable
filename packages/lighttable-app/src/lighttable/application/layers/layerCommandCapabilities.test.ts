import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import {
  addLayerMask,
  createRasterLayer,
  createAdjustmentLayer,
  createTextLayer,
  deleteLayers,
  groupLayers,
  setRasterLayerAdjustmentStack
} from '../../editor/document/documentCommands';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { addLayerStyle } from '../../editor/styles/layerStyleCommands';
import { createFilterStack } from '../../processing/filter';
import {
  createImageDocument,
  createVectorLayer,
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
    expect(capabilities.canDeleteSelection).toBe(false);
    expect(capabilities.rasterLayerCount).toBe(1);
    expect(capabilities.activeIndex).toBe(0);
    expect(capabilities.canMergeDown).toBe(false);
    expect(capabilities.canFlattenImage).toBe(true);
    expect(capabilities.canToggleActiveClipping).toBe(false);
    expect(capabilities.canRasterizeActiveLayer).toBe(false);
    expect(capabilities.hasRasterizableLayer).toBe(false);
    expect(capabilities.hasMergeCandidate).toBe(false);
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
    expect(capabilities.hasMergeCandidate).toBe(true);
  });

  it('admits semantic vector duplication and rasterization through the shared query', () => {
    const document = createDocument();
    const vector = createVectorLayer([], 'Vector');
    document.layers = [vector];
    document.activeLayerId = vector.id;

    const capabilities = queryLayerCommandCapabilities(document);
    expect(capabilities.canDuplicateActiveLayer).toBe(true);
    expect(capabilities.canRasterizeActiveLayer).toBe(true);
    expect(capabilities.hasRasterizableLayer).toBe(true);
  });

  it('offers rasterization only when a raster layer has live semantics to bake', () => {
    const plain = createDocument();
    expect(queryLayerCommandCapabilities(plain).canRasterizeActiveLayer).toBe(false);

    const graded = setRasterLayerAdjustmentStack(
      plain,
      plain.activeLayerId!,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    );
    expect(queryLayerCommandCapabilities(graded).canRasterizeActiveLayer).toBe(true);

    const masked = addLayerMask(plain, plain.activeLayerId!);
    expect(queryLayerCommandCapabilities(masked).canRasterizeActiveLayer).toBe(true);

    const styled = addLayerStyle(plain, plain.activeLayerId!, 'drop-shadow');
    expect(queryLayerCommandCapabilities(styled).canRasterizeActiveLayer).toBe(true);
  });

  it('only offers standalone adjustment rasterization for pixel-generating filters', () => {
    const document = createAdjustmentLayer(
      createDocument(),
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Adjustment'
    );

    expect(queryLayerCommandCapabilities(document).canRasterizeActiveLayer).toBe(false);

    const clouds = createAdjustmentLayer(
      createDocument(),
      createFilterStack('clouds'),
      'Clouds',
      undefined,
      'clouds'
    );

    expect(queryLayerCommandCapabilities(clouds).canRasterizeActiveLayer).toBe(true);
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
    expect(capabilities.hasFlattenableGroup).toBe(true);
  });

  it('exposes compositing commands for text while rejecting pixel editing', () => {
    const document = createTextLayer(createDocument(), createDefaultTextLayerData(), 'Text fixture');
    const capabilities = queryLayerCommandCapabilities(document);

    expect(capabilities.activeLayer?.type).toBe('text');
    expect(capabilities.canDuplicateActiveLayer).toBe(true);
    expect(capabilities.canEditActivePixels).toBe(false);
    expect(capabilities.canEditActiveLayerStyles).toBe(true);
    expect(capabilities.canAddActiveMask).toBe(true);
    expect(capabilities.canMergeDown).toBe(true);
    expect(capabilities.canFlattenImage).toBe(true);
  });

  it('keeps deletion availability aligned with the final-raster invariant', () => {
    const document = createTextLayer(createDocument(), createDefaultTextLayerData(), 'Text');
    const rasterId = document.layers.find((layer) => layer.type === 'raster')!.id;
    const textId = document.layers.find((layer) => layer.type === 'text')!.id;

    expect(queryLayerCommandCapabilities(document, [rasterId]).canDeleteSelection).toBe(false);
    expect(queryLayerCommandCapabilities(document, [textId]).canDeleteSelection).toBe(true);
  });

  it('allows one of multiple text-only layers to be deleted', () => {
    const withText = createTextLayer(createDocument(), createDefaultTextLayerData(), 'First');
    const textOnly = {
      ...withText,
      layers: withText.layers.filter((layer) => layer.type === 'text')
    };
    const twoText = createTextLayer(textOnly, createDefaultTextLayerData(), 'Second');
    const firstId = twoText.layers[0]!.id;

    expect(queryLayerCommandCapabilities(twoText, [firstId]).canDeleteSelection).toBe(true);
    expect(deleteLayers(twoText, [firstId]).layers).toHaveLength(1);
    expect(queryLayerCommandCapabilities(
      deleteLayers(twoText, [firstId])
    ).canDeleteSelection).toBe(false);
  });
});
