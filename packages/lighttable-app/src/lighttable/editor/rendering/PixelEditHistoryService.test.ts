import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { PixelEditHistoryService } from './PixelEditHistoryService';
import { PixelEditSessionStore } from './PixelEditSessionStore';

const id = 'layer' as LayerId;
const texture = () => ({
  destroy: vi.fn()
}) as unknown as GPUTexture;

const harness = (size = { width: 20, height: 10 }) => {
  const target = texture();
  const maskTarget = texture();
  const created: GPUTexture[] = [];
  const createdMasks: GPUTexture[] = [];
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
        ? { texture: target, maskTexture: null, maskId: null, ...size }
        : null
    } as never,
    sessions,
    dimensions: () => size,
    createTextureSized: () => {
      const result = texture();
      created.push(result);
      return result;
    },
    createMaskTextureSized: () => {
      const result = texture();
      createdMasks.push(result);
      return result;
    },
    maskTextureFor: (layerId) => layerId === id ? maskTarget : null,
    invalidateLayer
  });
  return {
    service,
    sessions,
    target,
    maskTarget,
    created,
    createdMasks,
    copyTextureToTexture,
    submit,
    invalidateLayer
  };
};

describe('PixelEditHistoryService', () => {
  it('captures one pre-edit snapshot and exposes one atomic undo/redo entry', () => {
    const test = harness();
    test.service.begin(id, 'pixels');
    test.service.captureAll(id, 'pixels');
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
    test.service.captureAll(id, 'pixels');
    const snapshot = test.sessions.current!.tiles[0]!.texture;

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

  it('keeps mask history in single-channel textures and budgets', () => {
    const test = harness();
    test.service.begin(id, 'mask');
    test.service.captureAll(id, 'mask');
    const history = test.service.finish()!;

    expect(history.byteSize).toBe(20 * 10 * 2);
    expect(test.created).toHaveLength(0);
    expect(test.createdMasks).toHaveLength(1);
    expect(history.undo()).toBe(true);
    expect(test.createdMasks).toHaveLength(2);
  });

  it('captures each touched tile once and budgets only captured pixels', () => {
    const test = harness({ width: 600, height: 600 });
    test.service.begin(id, 'pixels');

    expect(test.service.captureRegions(id, 'pixels', [
      { x: 250, y: 250, width: 20, height: 20 }
    ])).toBe(4);
    expect(test.service.captureRegions(id, 'pixels', [
      { x: 252, y: 252, width: 4, height: 4 }
    ])).toBe(0);

    const history = test.service.finish()!;
    expect(history.byteSize).toBe(256 * 256 * 8 * 4);
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(4);
    expect(history.undo()).toBe(true);
    expect(test.copyTextureToTexture).toHaveBeenCalledTimes(12);
  });
});
