import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultAdjustments,
  type LightTableImageMetadata
} from '../../types';
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

const createRequest = () => ({
  renderer: createRenderer(),
  blob: new Blob(['pixels'], { type: 'image/png' }),
  name: 'source.png',
  cacheKey: 'source:recipe',
  decodeMode: 'fast' as const,
  initialAdjustments: createDefaultAdjustments(),
  dependencies: {
    probe: async () => ({
      format: 'png' as const,
      codec: 'browser-native' as const,
      decodeMode: 'fast' as const,
      bitDepth: 8
    }),
    now: () => 0
  }
});

describe('loadDocumentSource', () => {
  it('applies explicit new-document resolution, depth and profile semantics', async () => {
    const result = await loadDocumentSource({
      ...createRequest(),
      creationSettings: { resolutionPpi: 300, bitDepth: 16, profile: 'adobe-rgb-1998' }
    });
    expect(result?.document).toMatchObject({
      resolutionPpi: 300,
      colorSettings: { bitDepth: 16, blendProfile: 'adobe-rgb-1998', profileState: 'assigned' }
    });
  });

  it('owns a flat recipe grade on the imported raster layer', async () => {
    const adjustments = createDefaultAdjustments();
    adjustments.exposureEV = 1.25;
    const result = await loadDocumentSource({
      ...createRequest(),
      initialAdjustments: adjustments
    });

    const background = result?.document.layers[0];
    expect(background?.type).toBe('raster');
    expect(background?.type === 'raster' && background.adjustmentStack).not.toBeNull();
  });

  it('does not create a local grade badge for a neutral flat import', async () => {
    const result = await loadDocumentSource({
      ...createRequest(),
      initialAdjustments: createDefaultAdjustments()
    });

    const background = result?.document.layers[0];
    expect(background?.type).toBe('raster');
    expect(background?.type === 'raster' && background.adjustmentStack).toBeNull();
  });

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
      initialAdjustments: createDefaultAdjustments(),
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
      sourceDecodeMs: 0,
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
      initialAdjustments: createDefaultAdjustments(),
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

  it('opens a PDF page preview and preserves the original source bytes', async () => {
    const renderer = createRenderer();
    const source = new Blob([new TextEncoder().encode('%PDF-1.4\nsource')], {
      type: 'application/pdf'
    });
    const preview = new Blob(['png preview'], { type: 'image/png' });
    const result = await loadDocumentSource({
      renderer,
      blob: source,
      name: 'FormulierPersoneel.pdf',
      cacheKey: 'source:pdf',
      decodeMode: 'automatic',
      initialAdjustments: createDefaultAdjustments(),
      dependencies: {
        probe: async () => ({
          format: 'pdf', codec: 'pdf-raster', decodeMode: 'fast', bitDepth: null
        }),
        decodePdfPreview: async () => ({
          preview, pageCount: 1, pageNumber: 1, width: 2457, height: 3484,
          scalePixelsPerPoint: 300 / 72
        }),
        now: () => 0
      }
    });

    expect(renderer.loadImage).toHaveBeenCalledWith(preview, 'FormulierPersoneel.pdf', {
      decodeMode: 'fast', signal: undefined
    });
    expect(result?.metadata).toMatchObject({
      decoder: 'pdfjs', sourceFormat: 'PDF',
      sourceInterpretation: 'Page 1 of 1 at 300 ppi preview'
    });
    expect(result?.document.assets.preservedSources).toEqual([
      expect.objectContaining({
        kind: 'pdf-document', name: 'FormulierPersoneel.pdf', byteLength: source.size
      })
    ]);
    expect(result?.preservedSourceAssets).toHaveLength(1);
    expect(result?.preservedSourceAssets[0]?.source).toBe(source);
  });

  it('rejects unsupported signatures before allocating renderer image state', async () => {
    const renderer = createRenderer();
    await expect(loadDocumentSource({
      renderer,
      blob: new Blob(['unknown']),
      name: 'source.unknown',
      cacheKey: 'source:3',
      decodeMode: 'fast',
      initialAdjustments: createDefaultAdjustments(),
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
      initialAdjustments: createDefaultAdjustments(),
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
      initialAdjustments: createDefaultAdjustments(),
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
      initialAdjustments: createDefaultAdjustments(),
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
