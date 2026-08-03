import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerThumbnailService } from './LayerThumbnailService';

const layerId = 'layer-1' as LayerId;
const texture = {} as GPUTexture;

const harness = (
  dimensions = { width: 2100, height: 900 },
  rasterTexture: GPUTexture | null = texture,
  maskTexture: GPUTexture | null = texture
) => {
  const encode = vi.fn(async () => new Blob(['thumbnail']));
  const service = new LayerThumbnailService({
    dimensions: () => dimensions,
    layerSource: () => rasterTexture
      ? { texture: rasterTexture, width: dimensions.width, height: dimensions.height }
      : null,
    maskTexture: () => maskTexture,
    encode
  });
  return { service, encode };
};

describe('LayerThumbnailService', () => {
  it('fits wide layer pixels inside the requested box without changing aspect ratio', async () => {
    const { service, encode } = harness();

    const result = await service.export(layerId);

    expect(result).toMatchObject({ width: 80, height: 34 });
    expect(encode).toHaveBeenCalledWith(texture, false, 80, 34);
  });

  it('fits portrait masks independently and preserves the mask encode path', async () => {
    const mask = {} as GPUTexture;
    const { service, encode } = harness({ width: 900, height: 1600 }, null, mask);

    const result = await service.export(layerId, true, 80, 80);

    expect(result).toMatchObject({ width: 45, height: 80 });
    expect(encode).toHaveBeenCalledWith(mask, true, 45, 80);
  });

  it('does not upscale small sources or encode unavailable channels', async () => {
    const available = harness({ width: 32, height: 24 });
    expect(await available.service.export(layerId)).toMatchObject({
      width: 32,
      height: 24
    });

    const unavailable = harness({ width: 32, height: 24 }, null, null);
    expect(await unavailable.service.export(layerId)).toBeNull();
    expect(unavailable.encode).not.toHaveBeenCalled();
  });
});
