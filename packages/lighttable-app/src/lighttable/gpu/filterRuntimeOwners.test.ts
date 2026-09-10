import { describe, expect, it } from 'vitest';
import {
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer,
  createRasterLayer,
  removeRasterLayerAttachedAdjustment
} from '../editor/document/documentCommands';
import { createImageDocument } from '../editor/document/documentTypes';
import { findDocumentLayer } from '../editor/document/layerTree';
import { attachedAdjustmentOwnerId } from '../processing/attachedAdjustment';
import { createFilterStack, filterModule } from '../processing/filter';
import { collectActiveFilterRuntimeKeys } from './filterRuntimeOwners';

describe('filter runtime owners', () => {
  it('tracks standalone and attached filter owners and drops removed owners', () => {
    let document = createRasterLayer(createImageDocument('Filters', 32, 32, 'source'));
    const rasterId = document.activeLayerId!;
    const attachedStack = createFilterStack('median');
    document = addRasterLayerAttachedAdjustment(document, rasterId, {
      id: 'attached-filter',
      adjustmentKind: 'median',
      name: 'Median',
      enabled: true,
      revision: 0,
      adjustmentStack: attachedStack
    });
    document = createAdjustmentLayer(
      document, createFilterStack('gaussian-blur'), 'Gaussian Blur', rasterId, 'gaussian-blur'
    );
    const filterLayerId = document.activeLayerId!;
    const filterLayer = findDocumentLayer(document, filterLayerId)!;
    const standaloneModule = filterLayer.type === 'adjustment'
      ? filterModule(filterLayer.adjustmentStack)!
      : null;
    const attachedModule = filterModule(attachedStack)!;

    expect([...collectActiveFilterRuntimeKeys(document)].sort()).toEqual([
      `${filterLayerId}::${standaloneModule!.id}`,
      `${attachedAdjustmentOwnerId(rasterId, 'attached-filter')}::${attachedModule.id}`
    ].sort());

    document = removeRasterLayerAttachedAdjustment(document, rasterId, 'attached-filter');
    expect([...collectActiveFilterRuntimeKeys(document)])
      .toEqual([`${filterLayerId}::${standaloneModule!.id}`]);
  });
});
