import { describe, expect, it, vi } from 'vitest';
import {
  createAdjustmentLayer,
  createRasterLayer,
  groupLayers
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import {
  dispatchSemanticFlattenGroup,
  dispatchSemanticLayerMerge
} from './semanticMergeFlattenDispatcher';

describe('semantic merge and flatten eligibility', () => {
  it('explains when selected layers cannot be isolated from their lower backdrop', async () => {
    const base = createImageDocument('Backdrop merge', 32, 24, 'base');
    const withAdjustment = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade'
    );
    const document = createRasterLayer(withAdjustment, 'Selected top');
    const layerIds = document.layers.slice(1).map(({ id }) => id);
    const execute = vi.fn();

    await expect(dispatchSemanticLayerMerge(
      { layerIds }, document, execute, () => document.revision
    )).resolves.toMatchObject({
      ok: false,
      code: 'command-unavailable',
      message: expect.stringContaining('content below')
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('distinguishes a contextual pass-through group from an empty group', async () => {
    const base = createImageDocument('Backdrop flatten', 32, 24, 'base');
    const withChild = createRasterLayer(base, 'Child');
    const document = groupLayers(withChild, [withChild.activeLayerId!], 'Pass through');
    const groupId = document.activeLayerId!;
    const execute = vi.fn();

    await expect(dispatchSemanticFlattenGroup(
      { groupId }, document, execute, () => document.revision
    )).resolves.toMatchObject({
      ok: false,
      code: 'command-unavailable',
      message: expect.stringContaining('content below')
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
