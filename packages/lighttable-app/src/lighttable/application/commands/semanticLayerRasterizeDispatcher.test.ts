import { describe, expect, it, vi } from 'vitest';
import {
  createRasterLayer,
  groupLayers
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { dispatchSemanticLayerRasterize } from './semanticLayerRasterizeDispatcher';

describe('dispatchSemanticLayerRasterize', () => {
  it('rejects pass-through groups that depend on an external backdrop', async () => {
    const withUpper = createRasterLayer(
      createImageDocument('Rasterize', 32, 24, 'background'),
      'Upper'
    );
    const document = groupLayers(withUpper, [withUpper.activeLayerId!], 'Pass-through');
    const groupId = document.activeLayerId!;
    const execute = vi.fn();

    await expect(dispatchSemanticLayerRasterize(
      { layerId: groupId }, document, execute, () => document.revision
    )).resolves.toMatchObject({
      ok: false,
      code: 'command-unavailable',
      message: expect.stringContaining('content below')
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
