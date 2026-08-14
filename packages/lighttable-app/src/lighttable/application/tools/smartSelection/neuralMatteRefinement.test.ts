import { describe, expect, it, vi } from 'vitest';
import { RawImage } from '@huggingface/transformers';
import { compositeNeuralAlpha, refineMatteWithNeuralRuntime } from './neuralMatteRefinement';

describe('neural matte refinement', () => {
  it('composites only the unknown trimap band and preserves certain pixels', () => {
    const result = compositeNeuralAlpha(
      new Uint8Array(25).fill(99),
      new Uint8Array([
        0, 0, 0,
        0, 128, 255,
        0, 128, 255
      ]),
      { x: 1, y: 1, width: 3, height: 3 },
      new Float32Array([0, 0.25, 0.5, 0.75]), 2, 2, 5
    );
    expect(result[1 * 5 + 1]).toBe(0);
    expect(result[2 * 5 + 2]).toBeGreaterThan(0);
    expect(result[2 * 5 + 2]).toBeLessThan(255);
    expect(result[2 * 5 + 3]).toBe(255);
    expect(result[0]).toBe(99);
  });

  it('ignores processor padding instead of stretching it across the selection ROI', () => {
    const coarse = new Uint8Array(6);
    const trimap = new Uint8Array(6).fill(128);
    // Two columns of real alpha followed by two padded columns. If the padded
    // tensor were stretched over the ROI, the right-hand document pixels would
    // incorrectly become opaque.
    const paddedAlpha = new Float32Array([
      0, 1, 0, 0,
      0, 1, 0, 0
    ]);
    const result = compositeNeuralAlpha(
      coarse, trimap, { x: 0, y: 0, width: 3, height: 2 },
      paddedAlpha, 4, 2, 3, 2, 2
    );
    expect([...result]).toEqual([0, 128, 255, 0, 128, 255]);
  });

  it('runs the model on an object ROI and disposes every inference tensor', async () => {
    const width = 24;
    const height = 20;
    const logits = new Float32Array(width * height).fill(-4);
    for (let y = 6; y < 15; y += 1) for (let x = 8; x < 18; x += 1) logits[y * width + x] = 4;
    const image = new RawImage(new Uint8Array(width * height * 3).fill(127), width, height, 3);
    const inputDispose = vi.fn();
    const alphaDispose = vi.fn();
    const processor = vi.fn(async (roi: RawImage, trimap: RawImage) => {
      expect(roi.width).toBeLessThanOrEqual(width);
      expect(roi.height).toBeLessThanOrEqual(height);
      expect(trimap.channels).toBe(1);
      return {
        pixel_values: { dispose: inputDispose },
        original_sizes: [[roi.height, roi.width]],
        reshaped_input_sizes: [[roi.height, roi.width]]
      };
    });
    const model = { _call: vi.fn(async () => ({
      alphas: { dims: [1, 1, 4, 4], data: new Float32Array(16).fill(0.6), dispose: alphaDispose }
    })) };
    const output = await refineMatteWithNeuralRuntime({
      processor: processor as never, model: model as never
    }, logits, 0, width, height, image, 'standard');
    expect(processor).toHaveBeenCalledOnce();
    expect(model._call).toHaveBeenCalledOnce();
    expect(inputDispose).toHaveBeenCalledOnce();
    expect(alphaDispose).toHaveBeenCalledOnce();
    expect(output.some((value) => value > 0 && value < 255)).toBe(true);
  });
});
