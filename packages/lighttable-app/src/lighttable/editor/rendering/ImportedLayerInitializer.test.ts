import { describe, expect, it, vi } from 'vitest';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { ImportedLayerInitializer } from './ImportedLayerInitializer';

const texture = () => ({
  createView: vi.fn(() => ({}))
}) as unknown as GPUTexture;

const documentWithSource = (kind: 'imported-image' | 'runtime'): ImageDocument => ({
  id: 'document-1',
  name: 'Document',
  width: 16,
  height: 9,
  colorSpace: 'linear-srgb',
  layers: [{
    id: 'layer-1' as LayerId,
    type: 'raster',
    name: 'Background',
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipped: false,
    locked: false,
    positionLocked: false,
    pixelsLocked: false,
    alphaLocked: false,
    geometryRevision: 0,
    pixelRevision: 0,
    pixelSource: kind === 'imported-image'
      ? { kind: 'imported-image' }
      : { kind: 'runtime' },
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    mask: null,
    styles: []
  }],
  documentAssets: []
} as unknown as ImageDocument);

const harness = (destination: GPUTexture | null = texture()) => {
  const submit = vi.fn();
  const drawFullscreen = vi.fn();
  const source = texture();
  const initializer = new ImportedLayerInitializer({
    device: {
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => ({ finish: () => 'commands' })),
      queue: { submit }
    } as unknown as GPUDevice,
    sampler: {} as GPUSampler,
    decodePipeline: {
      getBindGroupLayout: vi.fn(() => ({}))
    } as unknown as GPURenderPipeline,
    rasterTexture: () => destination,
    drawFullscreen
  });
  return { initializer, source, submit, drawFullscreen };
};

describe('ImportedLayerInitializer', () => {
  it('decodes a flat imported source into its canonical raster runtime', () => {
    const test = harness();

    expect(test.initializer.initialize(documentWithSource('imported-image'), test.source))
      .toBe(true);
    expect(test.drawFullscreen).toHaveBeenCalledOnce();
    expect(test.submit).toHaveBeenCalledWith(['commands']);
  });

  it('leaves persisted runtime-only documents for asset restoration', () => {
    const test = harness();

    expect(test.initializer.initialize(documentWithSource('runtime'), test.source))
      .toBe(false);
    expect(test.drawFullscreen).not.toHaveBeenCalled();
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('fails explicitly when document synchronization omitted the imported runtime', () => {
    const test = harness(null);

    expect(() => test.initializer.initialize(
      documentWithSource('imported-image'),
      test.source
    )).toThrow('could not be initialized');
  });
});
