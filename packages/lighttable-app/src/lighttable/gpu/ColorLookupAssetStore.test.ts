import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DocumentAssetId } from '../editor/document/documentTypes';
import { ColorLookupAssetStore } from './ColorLookupAssetStore';

beforeAll(() => {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
});

const cube = [
  'LUT_3D_SIZE 2',
  'DOMAIN_MIN 0 0 0',
  'DOMAIN_MAX 1 1 1',
  '0 0 0', '1 0 0', '0 1 0', '1 1 0',
  '0 0 1', '1 0 1', '0 1 1', '1 1 1', ''
].join('\n');

describe('ColorLookupAssetStore', () => {
  it('uploads a float 3D texture and retains the exact embedded source', async () => {
    const texture = { destroy: vi.fn() };
    const device = {
      createTexture: vi.fn(() => texture),
      queue: { writeTexture: vi.fn() }
    } as unknown as GPUDevice;
    const store = new ColorLookupAssetStore(device);
    const lutId = 'lut-gpu' as DocumentAssetId;
    const source = new Blob([cube], { type: 'application/x-cube' });

    const runtime = await store.load({ lutId, source });

    expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({
      size: [2, 2, 2], dimension: '3d', format: 'rgba32float'
    }));
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture },
      expect.any(Float32Array),
      { bytesPerRow: 32, rowsPerImage: 2 },
      { width: 2, height: 2, depthOrArrayLayers: 2 }
    );
    expect(runtime.size).toBe(2);
    expect(store.get(lutId)).toBe(runtime);
    expect(store.getSource(lutId)).toBe(source);
    expect(store.estimatedTextureBytes()).toBe(128);

    store.clear();
    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(store.get(lutId)).toBeNull();
  });
});
