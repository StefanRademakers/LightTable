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
        probe: async () => ({
          format: 'png',
          codec: 'browser-native',
          decodeMode: 'fast',
          bitDepth: 8
        }),
        parseLayered: async () => null,
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
        probe: async () => {
          isCanceled = true;
          return {
            format: 'png',
            codec: 'browser-native',
            decodeMode: 'fast',
            bitDepth: 8
          };
        },
        now: () => 0
      }
    });

    expect(result).toBeNull();
    expect(renderer.loadImage).not.toHaveBeenCalled();
    expect(renderer.setDocument).not.toHaveBeenCalled();
  });

  it('rejects unsupported signatures before allocating renderer image state', async () => {
    const renderer = createRenderer();
    await expect(loadDocumentSource({
      renderer,
      blob: new Blob(['unknown']),
      name: 'source.unknown',
      cacheKey: 'source:3',
      decodeMode: 'fast',
      dependencies: {
        probe: async () => ({
          format: 'unknown',
          codec: 'unsupported',
          decodeMode: 'fast',
          bitDepth: null
        }),
        now: () => 0
      }
    })).rejects.toThrow('file signature is not supported');
    expect(renderer.loadImage).not.toHaveBeenCalled();
  });

  it('uses the probed precision route even when the UI requested fast open', async () => {
    const renderer = createRenderer();
    await loadDocumentSource({
      renderer,
      blob: new Blob(['precision pixels']),
      name: 'renamed.data',
      cacheKey: 'source:4',
      decodeMode: 'fast',
      dependencies: {
        probe: async () => ({
          format: 'tiff',
          codec: 'wasm-vips',
          decodeMode: 'preserve-precision',
          bitDepth: 16
        }),
        now: () => 0
      }
    });

    expect(renderer.loadImage).toHaveBeenCalledWith(
      expect.any(Blob),
      'renamed.data',
      {
        decodeMode: 'preserve-precision',
        signal: undefined
      }
    );
  });

  it('does not initialize layered or Photoshop importers on the native fast lane', async () => {
    const renderer = createRenderer();
    const parseLayered = vi.fn(async () => null);
    const decodePhotoshop = vi.fn();
    const importPhotoshop = vi.fn();
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png[24] = 8;

    await loadDocumentSource({
      renderer,
      blob: new Blob([png]),
      name: 'ordinary-image.png',
      cacheKey: 'source:5',
      decodeMode: 'automatic',
      dependencies: {
        parseLayered,
        decodePhotoshop,
        importPhotoshop,
        now: () => 0
      }
    });
    await loadDocumentSource({
      renderer,
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]),
      name: 'ordinary-image.jpeg',
      cacheKey: 'source:6',
      decodeMode: 'automatic',
      dependencies: {
        parseLayered,
        decodePhotoshop,
        importPhotoshop,
        now: () => 0
      }
    });

    expect(parseLayered).not.toHaveBeenCalled();
    expect(decodePhotoshop).not.toHaveBeenCalled();
    expect(importPhotoshop).not.toHaveBeenCalled();
    expect(renderer.loadImage).toHaveBeenNthCalledWith(
      1,
      expect.any(Blob),
      'ordinary-image.png',
      { decodeMode: 'fast', signal: undefined }
    );
    expect(renderer.loadImage).toHaveBeenNthCalledWith(
      2,
      expect.any(Blob),
      'ordinary-image.jpeg',
      { decodeMode: 'fast', signal: undefined }
    );
  });
});
