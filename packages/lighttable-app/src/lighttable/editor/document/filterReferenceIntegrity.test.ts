import { describe, expect, it } from 'vitest';
import { defaultFilterSettings } from '@lighttable/filter-core';
import {
  createAdjustmentLayer,
  createRasterLayer,
  deleteLayer,
  setAdjustmentLayerStack
} from './documentCommands';
import { createImageDocument } from './documentTypes';
import { findDocumentLayer } from './layerTree';
import { createFilterStack, filterSettings, setFilterSettings } from '../../processing/filter';

describe('filter reference integrity', () => {
  it('clears a Displace map atomically when its raster layer is deleted', () => {
    let document = createRasterLayer(createImageDocument('Maps', 64, 64, 'source'));
    const contentId = document.activeLayerId!;
    document = createRasterLayer(document);
    const mapId = document.activeLayerId!;
    document = createAdjustmentLayer(
      document,
      createFilterStack('displace', {
        ...defaultFilterSettings('displace'),
        mapAssetId: mapId
      }),
      'Displace',
      mapId,
      'displace'
    );
    const filterId = document.activeLayerId!;
    document = deleteLayer(document, mapId);
    expect(findDocumentLayer(document, contentId)?.type).toBe('raster');
    const filter = findDocumentLayer(document, filterId);
    expect(filter?.type === 'adjustment'
      ? filterSettings(filter.adjustmentStack, 'displace')?.mapAssetId
      : 'missing').toBeNull();
  });

  it('does not revise unrelated Displace stacks when a different layer is removed', () => {
    let document = createRasterLayer(createImageDocument('Maps', 64, 64, 'source'));
    const mapId = document.activeLayerId!;
    document = createRasterLayer(document);
    const removableId = document.activeLayerId!;
    document = createAdjustmentLayer(document, createFilterStack('displace'),
      'Displace', removableId, 'displace');
    const filterId = document.activeLayerId!;
    const filter = findDocumentLayer(document, filterId);
    if (filter?.type !== 'adjustment') throw new Error('fixture');
    document = setAdjustmentLayerStack(document, filterId, setFilterSettings(
      filter.adjustmentStack, 'displace', { mapAssetId: mapId }
    ));
    const before = findDocumentLayer(document, filterId);
    document = deleteLayer(document, removableId);
    const after = findDocumentLayer(document, filterId);
    expect(after?.revision).toBe(before?.revision);
  });
});
