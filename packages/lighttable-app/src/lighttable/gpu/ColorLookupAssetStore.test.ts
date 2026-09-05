import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DocumentAssetId } from '../editor/document/documentTypes';
import { ColorLookupAssetStore } from './ColorLookupAssetStore';
import { DocumentColorLookupResourceRepository } from './DocumentColorLookupResourceRepository';

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

    expect(store.remove(lutId)).toBe(true);
    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(store.get(lutId)).toBeNull();

    store.clear();
    expect(texture.destroy).toHaveBeenCalledOnce();
    expect(store.get(lutId)).toBeNull();
  });

  it('keeps an asynchronous load bound to its original document', async () => {
    const texture = { destroy: vi.fn() };
    const device = {
      createTexture: vi.fn(() => texture),
      queue: { writeTexture: vi.fn() }
    } as unknown as GPUDevice;
    const repository = new DocumentColorLookupResourceRepository();
    const store = new ColorLookupAssetStore(device, repository, 'document-a');
    const lutId = 'lut-delayed' as DocumentAssetId;
    const source = new Blob([cube], { type: 'application/x-cube' });
    let finishReading!: (value: string) => void;
    vi.spyOn(source, 'text').mockReturnValue(new Promise((resolve) => {
      finishReading = resolve;
    }));

    const loading = store.load({ lutId, source });
    store.bind('document-b');
    finishReading(cube);
    await loading;

    expect(store.get(lutId)).toBeNull();
    expect(store.getSource(lutId, 'document-a')).toBe(source);
    expect(store.getSource(lutId, 'document-b')).toBeNull();
  });
});
