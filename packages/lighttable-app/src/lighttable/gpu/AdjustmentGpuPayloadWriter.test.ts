import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../types';
import { AdjustmentGpuPayloadWriter } from './AdjustmentGpuPayloadWriter';

const createWriter = (colorVibrance = false) => {
  const writeBuffer = vi.fn();
  const writeTexture = vi.fn();
  const writer = new AdjustmentGpuPayloadWriter(
    { queue: { writeBuffer, writeTexture } } as unknown as GPUDevice,
    {
      uniformBuffer: {} as GPUBuffer,
      curveTexture: {} as GPUTexture,
      ...(colorVibrance ? {
        colorVibranceWhiteBalanceTexture: {} as GPUTexture,
        colorVibranceColorTexture: {} as GPUTexture
      } : {})
    }
  );
  return { writer, writeBuffer, writeTexture };
};

describe('AdjustmentGpuPayloadWriter', () => {
  it('publishes each payload once and rejects an identical replay', () => {
    const test = createWriter();
    const adjustments = createDefaultAdjustments();

    expect(test.writer.sync(adjustments, 1920, 1080, true)).toEqual({
      uniformChanged: true,
      curveChanged: true
    });
    expect(test.writer.sync(adjustments, 1920, 1080, true)).toEqual({
      uniformChanged: false,
      curveChanged: false
    });
    expect(test.writeBuffer).toHaveBeenCalledOnce();
    expect(test.writeTexture).toHaveBeenCalledOnce();
  });

  it('does not upload grade payloads for an effect-only change', () => {
    const test = createWriter();
    const adjustments = createDefaultAdjustments();
    test.writer.sync(adjustments, 1920, 1080, true);

    adjustments.effects.halation.amount = 50;
    adjustments.effects.halation.enabled = true;

    expect(test.writer.sync(adjustments, 1920, 1080, true)).toEqual({
      uniformChanged: false,
      curveChanged: false
    });
    expect(test.writeBuffer).toHaveBeenCalledOnce();
    expect(test.writeTexture).toHaveBeenCalledOnce();
  });

  it('uploads only the LUT when an already-active curve changes shape', () => {
    const test = createWriter();
    const adjustments = createDefaultAdjustments();
    adjustments.curves.master.splice(1, 0, { x: 0.5, y: 0.4 });
    test.writer.sync(adjustments, 1920, 1080, true);

    adjustments.curves.master[1] = { x: 0.5, y: 0.6 };

    expect(test.writer.sync(adjustments, 1920, 1080, true)).toEqual({
      uniformChanged: false,
      curveChanged: true
    });
    expect(test.writeBuffer).toHaveBeenCalledOnce();
    expect(test.writeTexture).toHaveBeenCalledTimes(2);
  });

  it('republishes the uniform when dimensions or input domain change', () => {
    const test = createWriter();
    const adjustments = createDefaultAdjustments();
    test.writer.sync(adjustments, 1920, 1080, false);

    expect(test.writer.sync(adjustments, 1280, 720, true).uniformChanged).toBe(true);
    expect(test.writeBuffer).toHaveBeenCalledTimes(2);
    expect(test.writeTexture).toHaveBeenCalledOnce();
  });

  it('uploads coupled Color and Vibrance LUTs only when their parameters change', () => {
    const test = createWriter(true);
    const adjustments = createDefaultAdjustments();
    adjustments.photoshopAdjustment.kind = 'color-vibrance';

    test.writer.sync(adjustments, 1920, 1080, true);
    expect(test.writeTexture).toHaveBeenCalledTimes(3); // curves plus two 3D LUTs
    test.writer.sync(adjustments, 1920, 1080, true);
    expect(test.writeTexture).toHaveBeenCalledTimes(3);

    adjustments.photoshopAdjustment.colorVibranceTemperature = 37;
    test.writer.sync(adjustments, 1920, 1080, true);
    expect(test.writeTexture).toHaveBeenCalledTimes(5);
  });
});
