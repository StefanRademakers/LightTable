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
    const firstRasterMask = texture();
    const firstPreview = texture();
    const firstNodeMask = texture();
    const secondPixels = texture();
    const first = repository.acquire('document-a');
    first.rasterRuntimes.set('layer-a' as LayerId, {
      texture: firstPixels, width: 1, height: 1,
      maskTexture: firstRasterMask, maskId: 'raster-mask-a'
    });
    first.derivedPreviews.set('preview-a' as LayerId, {
      texture: firstPreview, width: 1, height: 1
    });
    first.nodeMasks.set('node-a' as LayerId, {
      texture: firstNodeMask, maskId: 'node-mask-a'
    });
    repository.acquire('document-b').rasterRuntimes.set('layer-b' as LayerId, {
      texture: secondPixels, width: 1, height: 1, maskTexture: null, maskId: null
    });

    expect(repository.release('document-a')).toBe(true);

    expect(firstPixels.destroy).toHaveBeenCalledOnce();
    expect(firstRasterMask.destroy).toHaveBeenCalledOnce();
    expect(firstPreview.destroy).toHaveBeenCalledOnce();
    expect(firstNodeMask.destroy).toHaveBeenCalledOnce();
    expect(secondPixels.destroy).not.toHaveBeenCalled();
    expect(repository.has('document-a')).toBe(false);
    expect(repository.has('document-b')).toBe(true);
  });

  it('detaches an exact set before a replacement generation uses the same key', () => {
    const repository = new DocumentLayerResourceRepository();
    const oldPixels = texture();
    repository.acquire('document').rasterRuntimes.set('old' as LayerId, {
      texture: oldPixels, width: 1, height: 1, maskTexture: null, maskId: null
    });

    const destroyDetached = repository.detach('document');
    const newPixels = texture();
    repository.acquire('document').rasterRuntimes.set('new' as LayerId, {
      texture: newPixels, width: 1, height: 1, maskTexture: null, maskId: null
    });
    destroyDetached?.();

    expect(oldPixels.destroy).toHaveBeenCalledOnce();
    expect(newPixels.destroy).not.toHaveBeenCalled();
    expect(repository.get('document')?.rasterRuntimes.get('new' as LayerId)?.texture)
      .toBe(newPixels);
  });
});
