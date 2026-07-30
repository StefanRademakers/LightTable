import { describe, expect, it, vi } from 'vitest';
import type { LightTableImageMetadata } from '../../types';
import {
  loadDocumentSource,
  type DocumentSourceRenderer
} from './loadDocumentSource';

const metadata: LightTableImageMetadata = {
  name: 'source.png',
  width: 640,
  height: 360,
  contentType: 'image/png'
};

const createRenderer = () => ({
  loadImage: vi.fn(async () => metadata),
  setDocument: vi.fn(),
  loadLayerAssets: vi.fn(async () => undefined)
}) satisfies DocumentSourceRenderer;

describe('loadDocumentSource', () => {
  it('creates and hydrates a native document for a regular raster source', async () => {
    const renderer = createRenderer();
    const blob = new Blob(['pixels'], { type: 'image/png' });
    let now = 0;

    const result = await loadDocumentSource({
      renderer,
      blob,
      name: 'source.png',
      cacheKey: 'source:1',
      decodeMode: 'fast',
      dependencies: {
        parseLayered: async () => null,
        isPhotoshop: () => false,
        supportsImage: () => true,
        now: () => ++now
      }
    });

    expect(result?.metadata).toEqual(metadata);
    expect(result?.document.width).toBe(640);
    expect(result?.document.height).toBe(360);
    expect(result?.layeredAdjustmentStack).toBeNull();
    expect(renderer.loadImage).toHaveBeenCalledWith(blob, 'source.png', {
      decodeMode: 'fast',
      signal: undefined
    });
    expect(renderer.setDocument).toHaveBeenCalledWith(result?.document);
    expect(renderer.loadLayerAssets).not.toHaveBeenCalled();
    expect(result?.timings).toEqual({
      layeredProbeMs: 1,
      decodeAndUploadMs: 1,
      documentInitMs: 1
    });
  });

  it('does not mutate the renderer after cancellation during probing', async () => {
    const renderer = createRenderer();
    let isCanceled = false;
    const result = await loadDocumentSource({
      renderer,
      blob: new Blob(['pixels'], { type: 'image/png' }),
      name: 'source.png',
      cacheKey: 'source:2',
      decodeMode: 'fast',
      isCanceled: () => isCanceled,
      dependencies: {
        parseLayered: async () => {
          isCanceled = true;
          return null;
        },
        now: () => 0
      }
    });

    expect(result).toBeNull();
    expect(renderer.loadImage).not.toHaveBeenCalled();
    expect(renderer.setDocument).not.toHaveBeenCalled();
  });

  it('rejects unsupported sources before allocating renderer image state', async () => {
    const renderer = createRenderer();
    await expect(loadDocumentSource({
      renderer,
      blob: new Blob(['unknown']),
      name: 'source.unknown',
      cacheKey: 'source:3',
      decodeMode: 'fast',
      dependencies: {
        parseLayered: async () => null,
        isPhotoshop: () => false,
        supportsImage: () => false,
        now: () => 0
      }
    })).rejects.toThrow('LightTable supports JPEG, PNG, WebP, PSD');
    expect(renderer.loadImage).not.toHaveBeenCalled();
  });
});
