import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import { createDefaultAdjustments } from '../../types';
import { prepareDocumentSource } from './prepareDocumentSource';

const pngSource = () => {
  const header = new Uint8Array(32);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  header[24] = 8;
  return new Blob([header], { type: 'image/png' });
};

const renderer = () => ({
  loadImage: vi.fn(async () => ({
    name: 'image.png',
    width: 2,
    height: 2,
    contentType: 'image/png'
  })),
  initializeDocumentSurface: vi.fn(),
  setDocument: vi.fn(),
  loadLayerAssets: vi.fn(async () => undefined),
  setAdjustmentStack: vi.fn(),
  setAdjustments: vi.fn(),
  measureReferenceDifference: vi.fn(async () => ({
    threshold: 2 / 255,
    differingPixels: 0,
    differingPixelPercentage: 0,
    meanAbsoluteRgbError: 0,
    maximumChannelError: 0,
    meanAbsoluteAlphaError: 0,
    maximumAlphaError: 0,
    sampledPixels: 4,
    stride: 1
  }))
});

describe('prepareDocumentSource', () => {
  it('returns only after document upload and grade hydration are complete', async () => {
    const target = renderer();
    const result = await prepareDocumentSource({
      renderer: target,
      blob: pngSource(),
      name: 'image.png',
      cacheKey: 'image',
      decodeMode: 'fast',
      initialAdjustments: createDefaultAdjustments(),
      groupVisibility: createDefaultGroupVisibility()
    });

    expect(result?.loaded.document.name).toBe('image.png');
    expect(target.setDocument).toHaveBeenCalledOnce();
    expect(target.setAdjustments).toHaveBeenCalledOnce();
  });

  it('does not publish a prepared result after the task becomes stale', async () => {
    const target = renderer();
    let canceled = false;
    target.loadImage.mockImplementation(async () => {
      canceled = true;
      return {
        name: 'image.png',
        width: 2,
        height: 2,
        contentType: 'image/png'
      };
    });

    await expect(prepareDocumentSource({
      renderer: target,
      blob: pngSource(),
      name: 'image.png',
      cacheKey: 'image',
      decodeMode: 'fast',
      initialAdjustments: createDefaultAdjustments(),
      groupVisibility: createDefaultGroupVisibility(),
      isCanceled: () => canceled
    })).resolves.toBeNull();
    expect(target.setAdjustments).not.toHaveBeenCalled();
  });
});
