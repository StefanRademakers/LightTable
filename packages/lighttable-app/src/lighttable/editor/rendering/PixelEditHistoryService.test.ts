import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { PixelEditHistoryService } from './PixelEditHistoryService';
import { PixelEditSessionStore } from './PixelEditSessionStore';

const id = 'layer' as LayerId;
const texture = () => ({
  destroy: vi.fn()
}) as unknown as GPUTexture;

const harness = () => {
  const target = texture();
  const created: GPUTexture[] = [];
  const copyTextureToTexture = vi.fn();
  const submit = vi.fn();
  const invalidateLayer = vi.fn();
  const sessions = new PixelEditSessionStore();
  const service = new PixelEditHistoryService({
    device: {
      createCommandEncoder: () => ({
        copyTextureToTexture,
        finish: () => 'commands'
      }),
      queue: { submit }
    } as unknown as GPUDevice,
    layerResources: {
      raster: (layerId: LayerId) => layerId === id
        ? { texture: target, maskTexture: null, maskId: null }
        : null
    } as never,
    sessions,
    dimensions: () => ({ width: 20, height: 10 }),
    createTexture: () => {
      const result = texture();
      created.push(result);
      return result;
    },
    maskTextureFor: () => null,
    invalidateLayer
  });
  return {
    service,
    sessions,
    target,
    created,
    copyTextureToTexture,
    submit,
    invalidateLayer
  };
};

describe('PixelEditHistoryService', () => {
  it('captures one pre-edit snapshot and exposes one atomic undo/redo entry', () => {
    const test = harness();
    test.service.begin(id, 'pixels');
    const history = test.service.finish()!;

    expect(history.byteSize).toBe(20 * 10 * 8);
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(1);
    expect(test.invalidateLayer).toHaveBeenCalledWith(id);

    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(5);
    expect(test.submit).toHaveBeenCalledTimes(3);
  });

  it('releases a pending snapshot when an edit is cancelled', () => {
    const test = harness();
    test.service.begin(id, 'pixels');
    const snapshot = test.sessions.current!.texture;

    expect(test.service.cancel()).toBe(true);
    expect(snapshot.destroy).toHaveBeenCalledOnce();
    expect(test.sessions.current).toBeNull();
  });

  it('does not allocate a snapshot for an unavailable target', () => {
    const test = harness();
    expect(() => test.service.begin('missing' as LayerId, 'pixels'))
      .toThrow('The active raster layer is not available on the GPU.');
    expect(test.created).toHaveLength(0);
  });
});
