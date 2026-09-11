import { describe, expect, it, vi } from 'vitest';
import { createLayerAssetExportSnapshot } from './LayerAssetExportSnapshot';

describe('immutable layer export capture', () => {
  it('submits every copy in one batch and releases only owned snapshots', () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 1, COPY_SRC: 2, TEXTURE_BINDING: 4 });
    try {
      const encoder = { copyTextureToTexture: vi.fn(), finish: vi.fn(() => ({})) };
      const textures: GPUTexture[] = [];
      const device = {
        createCommandEncoder: vi.fn(() => encoder),
        createTexture: vi.fn(() => {
          const texture = { destroy: vi.fn() } as unknown as GPUTexture;
          textures.push(texture);
          return texture;
        }),
        queue: { submit: vi.fn() }
      };
      const source = { width: 10, height: 20, depthOrArrayLayers: 1,
        format: 'rgba16float', label: 'live', destroy: vi.fn() } as unknown as GPUTexture;
      const snapshot = createLayerAssetExportSnapshot(device as unknown as GPUDevice);
      const first = snapshot.retain(source);
      snapshot.retain(source);
      expect(device.queue.submit).not.toHaveBeenCalled();
      snapshot.submit();
      expect(() => snapshot.retain(source)).toThrow('capture is already closed');
      expect(() => snapshot.submit()).toThrow('capture is already closed');
      expect(device.createCommandEncoder).toHaveBeenCalledOnce();
      expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(device.queue.submit).toHaveBeenCalledOnce();
      snapshot.release(first);
      snapshot.dispose();
      snapshot.dispose();
      expect(source.destroy).not.toHaveBeenCalled();
      for (const texture of textures) expect(texture.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
