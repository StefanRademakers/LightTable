import { describe, expect, it, vi } from 'vitest';
import {
  createAdjustmentLayer,
  createImageDocument,
  type RasterLayer
} from '../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../processing/adjustmentStack';
import { createDefaultAdjustments } from '../types';
import { LayerProcessingRenderer } from './layerProcessingRenderer';
import { selectAdjustmentLayerModules } from '../processing/adjustmentLayerCatalog';
import { createGaussianBlurStack } from '../processing/gaussianBlurFilter';

const texture = (name: string) => ({ name }) as unknown as GPUTexture;
const encoder = {} as GPUCommandEncoder;

const layerWithStack = (): RasterLayer => {
  const layer = createImageDocument('Layer order', 1, 1, 'asset').layers[0] as RasterLayer;
  return {
    ...layer,
    adjustmentStack: createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
  };
};

describe('LayerProcessingRenderer', () => {
  it('executes geometry, grade, spatial and display-post in domain order', () => {
    const calls: string[] = [];
    const geometry = texture('geometry');
    const grade = texture('grade');
    const spatial = texture('spatial');
    const display = texture('display');
    const renderer = new LayerProcessingRenderer(
      {
        encode: vi.fn((_encoder, input) => {
          calls.push(`grade:${(input as unknown as { name: string }).name}`);
          return grade;
        })
      },
      {
        encodeSourceGeometry: vi.fn((_encoder, input) => {
          calls.push(`geometry:${(input as unknown as { name: string }).name}`);
          return geometry;
        }),
        encodeLinearSpatial: vi.fn((_encoder, input) => {
          calls.push(`spatial:${(input as unknown as { name: string }).name}`);
          return spatial;
        }),
        encodeDisplayPost: vi.fn((_encoder, input) => {
          calls.push(`display:${(input as unknown as { name: string }).name}`);
          return display;
        })
      }
    );

    expect(renderer.encode(encoder, texture('source'), layerWithStack())).toBe(display);
    expect(calls).toEqual([
      'geometry:source',
      'grade:geometry',
      'spatial:grade',
      'display:spatial'
    ]);
  });

  it('returns the source untouched when a layer has no processing stack', () => {
    const source = texture('source');
    const layer = { ...layerWithStack(), adjustmentStack: null };
    const renderer = new LayerProcessingRenderer(
      { encode: vi.fn() },
      {
        encodeSourceGeometry: vi.fn(),
        encodeLinearSpatial: vi.fn(),
        encodeDisplayPost: vi.fn()
      }
    );

    expect(renderer.encode(encoder, source, layer)).toBe(source);
  });

  it('executes Lens FX adjustment layers at their canonical stack position', () => {
    const source = texture('source');
    const settings = createDefaultAdjustments();
    settings.effects.lensDistortion.enabled = true;
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(settings),
      'lens-fx'
    );
    const layer = createAdjustmentLayer(stack, 'Lens Fx', 'lens-fx');
    const grade = { encode: vi.fn() };
    const geometry = texture('geometry');
    const spatial = texture('spatial');
    const display = texture('display');
    const effects = {
      encodeSourceGeometry: vi.fn(() => geometry),
      encodeLinearSpatial: vi.fn(() => spatial),
      encodeDisplayPost: vi.fn(() => display)
    };
    const renderer = new LayerProcessingRenderer(grade, effects);

    expect(renderer.encode(encoder, source, layer)).toBe(display);
    expect(grade.encode).not.toHaveBeenCalled();
    expect(effects.encodeSourceGeometry).toHaveBeenCalledWith(encoder, source, layer);
    expect(effects.encodeLinearSpatial).toHaveBeenCalledWith(encoder, geometry, layer);
    expect(effects.encodeDisplayPost).toHaveBeenCalledWith(encoder, spatial, layer);
  });

  it('routes Gaussian Blur through the filter stage between grade and display effects', () => {
    const source = texture('source');
    const filtered = texture('filtered');
    const layer = createAdjustmentLayer(
      createGaussianBlurStack(12, (kind) => `${kind}-gaussian`),
      'Gaussian Blur',
      'gaussian-blur'
    );
    const grade = { encode: vi.fn() };
    const effects = {
      encodeSourceGeometry: vi.fn(),
      encodeLinearSpatial: vi.fn(),
      encodeDisplayPost: vi.fn()
    };
    const filters = {
      encode: vi.fn((
        _encoder: GPUCommandEncoder,
        _source: GPUTexture,
        _layer: RasterLayer
      ) => filtered)
    };
    const renderer = new LayerProcessingRenderer(grade, effects, filters);

    expect(renderer.encode(encoder, source, layer)).toBe(filtered);
    expect(filters.encode).toHaveBeenCalledWith(encoder, source, layer);
    expect(grade.encode).not.toHaveBeenCalled();
    expect(effects.encodeSourceGeometry).not.toHaveBeenCalled();
  });

  it('exactly bypasses disabled processing owners', () => {
    const source = texture('source');
    const layer = layerWithStack();
    layer.adjustmentStack = {
      ...layer.adjustmentStack!,
      modules: layer.adjustmentStack!.modules.map((module) => ({
        ...module,
        enabled: false
      }))
    };
    const grade = { encode: vi.fn() };
    const effects = {
      encodeSourceGeometry: vi.fn(),
      encodeLinearSpatial: vi.fn(),
      encodeDisplayPost: vi.fn()
    };
    const renderer = new LayerProcessingRenderer(grade, effects);

    expect(renderer.encode(encoder, source, layer)).toBe(source);
    expect(grade.encode).not.toHaveBeenCalled();
    expect(effects.encodeSourceGeometry).not.toHaveBeenCalled();
    expect(effects.encodeLinearSpatial).not.toHaveBeenCalled();
    expect(effects.encodeDisplayPost).not.toHaveBeenCalled();
  });

  it('processes enabled attached nodes in authored order after the raster stack', () => {
    const source = texture('source');
    const attachmentStack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'exposure'
    );
    const layer = {
      ...layerWithStack(),
      adjustmentStack: null,
      attachedAdjustments: [{
        id: 'first', adjustmentKind: 'exposure' as const, name: 'Exposure',
        enabled: true, revision: 0, adjustmentStack: attachmentStack
      }, {
        id: 'disabled', adjustmentKind: 'threshold' as const, name: 'Threshold',
        enabled: false, revision: 0, adjustmentStack: attachmentStack
      }]
    };
    const output = texture('attached-output');
    const grade = {
      encode: vi.fn((_encoder: GPUCommandEncoder, _source: GPUTexture, _layer: RasterLayer) => output)
    };
    const effects = {
      encodeSourceGeometry: vi.fn(),
      encodeLinearSpatial: vi.fn(),
      encodeDisplayPost: vi.fn()
    };
    const renderer = new LayerProcessingRenderer(grade, effects);

    expect(renderer.encode(encoder, source, layer)).toBe(output);
    expect(grade.encode).toHaveBeenCalledTimes(1);
    expect(grade.encode.mock.calls[0]?.[2]).toMatchObject({
      name: 'Exposure', adjustmentStack: attachmentStack
    });
  });

  it('routes an attached Gaussian Blur through the shared filter executor', () => {
    const source = texture('source');
    const filtered = texture('filtered');
    const stack = createGaussianBlurStack(6, (kind) => `${kind}-attached-gaussian`);
    const layer = {
      ...layerWithStack(),
      adjustmentStack: null,
      attachedAdjustments: [{
        id: 'blur', adjustmentKind: 'gaussian-blur' as const, name: 'Gaussian Blur',
        enabled: true, revision: 0, adjustmentStack: stack
      }]
    };
    const filters = {
      encode: vi.fn((
        _encoder: GPUCommandEncoder,
        _source: GPUTexture,
        _layer: RasterLayer
      ) => filtered)
    };
    const renderer = new LayerProcessingRenderer(
      { encode: vi.fn() },
      { encodeSourceGeometry: vi.fn(), encodeLinearSpatial: vi.fn(), encodeDisplayPost: vi.fn() },
      filters
    );

    expect(renderer.encode(encoder, source, layer)).toBe(filtered);
    expect(filters.encode).toHaveBeenCalledOnce();
    expect(filters.encode.mock.calls[0]?.[2]).toMatchObject({
      id: expect.stringContaining('::attached-adjustment::blur'),
      name: 'Gaussian Blur',
      adjustmentStack: stack
    });
  });
});
