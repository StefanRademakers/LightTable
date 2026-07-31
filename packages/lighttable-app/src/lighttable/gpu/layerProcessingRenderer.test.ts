import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type RasterLayer
} from '../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../processing/adjustmentStack';
import { createDefaultAdjustments } from '../types';
import { LayerProcessingRenderer } from './layerProcessingRenderer';

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
});
