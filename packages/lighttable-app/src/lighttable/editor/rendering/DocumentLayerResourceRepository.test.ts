import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { DocumentLayerResourceRepository } from './DocumentLayerResourceRepository';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('DocumentLayerResourceRepository', () => {
  it('keeps one document resource set alive across renderer detach/rebind', () => {
    const repository = new DocumentLayerResourceRepository();
    const first = repository.acquire('document-a');
    const pixels = texture();
    first.rasterRuntimes.set('layer-a' as LayerId, {
      texture: pixels,
      width: 100,
      height: 80,
      maskTexture: null,
      maskId: null
    });

    const rebound = repository.acquire('document-a');

    expect(rebound).toBe(first);
    expect(rebound.rasterRuntimes.get('layer-a' as LayerId)?.texture).toBe(pixels);
    expect(pixels.destroy).not.toHaveBeenCalled();
  });

  it('releases only the explicitly closed document', () => {
    const repository = new DocumentLayerResourceRepository();
    const firstPixels = texture();
    const secondPixels = texture();
    repository.acquire('document-a').rasterRuntimes.set('layer-a' as LayerId, {
      texture: firstPixels, width: 1, height: 1, maskTexture: null, maskId: null
    });
    repository.acquire('document-b').rasterRuntimes.set('layer-b' as LayerId, {
      texture: secondPixels, width: 1, height: 1, maskTexture: null, maskId: null
    });

    expect(repository.release('document-a')).toBe(true);

    expect(firstPixels.destroy).toHaveBeenCalledOnce();
    expect(secondPixels.destroy).not.toHaveBeenCalled();
    expect(repository.has('document-a')).toBe(false);
    expect(repository.has('document-b')).toBe(true);
  });
});
