import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createLayerFinalizationCommandBinding } from './LayerFinalizationCommandBinding';

const fixture = () => {
  let document = createImageDocument('Image', 10, 10, 'image'); let current = true;
  const order: string[] = [];
  const commands = {
    rasterizeLayerWhenReady: vi.fn(async () => { order.push('rasterize'); return 'raster-output' as never; }),
    rasterizeTextLayerWhenReady: vi.fn(async () => 'text-output' as never),
    mergeLayersWhenReady: vi.fn(async () => { order.push('merge'); return 'merge-output' as never; }),
    flattenWhenReady: vi.fn(async () => 'flatten-output' as never)
  };
  const ports = {
    captureScope: vi.fn(() => ({ assertCurrent: () => { if (!current) throw new Error('Retired finalization'); } })),
    getDocument: () => document, commands,
    settlePixels: vi.fn(async () => { order.push('settle'); }),
    waitForFrame: vi.fn(async () => { order.push('frame'); })
  };
  return { ports, commands, order, binding: createLayerFinalizationCommandBinding(ports),
    retire: () => { current = false; },
    changeDocument: () => { document = { ...document, revision: document.revision + 1 }; }
  };
};
const source = 'source' as never;

describe('finalization semantic binding', () => {
  it('maps exact returned destination IDs for all five command contracts', async () => {
    const f = fixture();
    await expect(f.binding.executeLayerRasterize({ layerId: source })).resolves.toEqual({
      sourceLayerId: source, outputLayerId: 'raster-output', outputType: 'raster'
    });
    await expect(f.binding.executeTextRasterize({ layerId: source })).resolves.toEqual({ layerId: 'text-output', outputType: 'raster' });
    await expect(f.binding.executeLayerMerge({ layerIds: [source] })).resolves.toEqual({ layerIds: [source], outputLayerId: 'merge-output' });
    await expect(f.binding.executeFlattenGroup({ groupId: source })).resolves.toEqual({ groupId: source, outputLayerId: 'flatten-output' });
    await expect(f.binding.executeFlattenImage()).resolves.toEqual({ outputLayerId: 'flatten-output' });
    expect(f.ports.settlePixels).toHaveBeenCalledTimes(3);
    expect(f.ports.waitForFrame).toHaveBeenCalledTimes(5);
    expect(f.commands.flattenWhenReady.mock.calls).toEqual([[{ kind: 'group', groupId: source }], [{ kind: 'image' }]]);
  });

  it('allows settlement to publish canonical state before the frame boundary', async () => {
    const f = fixture();
    f.ports.settlePixels.mockImplementation(async () => { f.order.push('settle'); f.changeDocument(); });
    await f.binding.executeLayerMerge({ layerIds: [source] });
    expect(f.order).toEqual(['settle', 'frame', 'merge']);
  });

  it('rejects retirement during settlement before requesting a frame or finalizing', async () => {
    const f = fixture(); f.ports.settlePixels.mockImplementation(async () => f.retire());
    await expect(f.binding.executeFlattenImage()).rejects.toThrow('Retired');
    expect(f.ports.waitForFrame).not.toHaveBeenCalled(); expect(f.commands.flattenWhenReady).not.toHaveBeenCalled();
  });

  it('rejects document edits or renderer retirement across the host frame', async () => {
    for (const change of ['document', 'renderer'] as const) {
      const f = fixture();
      f.ports.waitForFrame.mockImplementation(async () => change === 'document' ? f.changeDocument() : f.retire());
      await expect(f.binding.executeLayerRasterize({ layerId: source })).rejects.toThrow();
      expect(f.commands.rasterizeLayerWhenReady).not.toHaveBeenCalled();
    }
  });

  it('preserves owner failures and does not retry another finalization route', async () => {
    const f = fixture(); const error = new Error('Exact source unavailable');
    f.commands.rasterizeLayerWhenReady.mockRejectedValue(error);
    await expect(f.binding.executeLayerRasterize({ layerId: source })).rejects.toBe(error);
    expect(f.commands.rasterizeLayerWhenReady).toHaveBeenCalledTimes(1);
    expect(f.commands.flattenWhenReady).not.toHaveBeenCalled();
  });
});
