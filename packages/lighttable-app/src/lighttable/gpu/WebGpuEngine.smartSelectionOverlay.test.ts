import { beforeEach, describe, expect, it, vi } from 'vitest';

const setMask = vi.fn();
const overlayConstructor = vi.fn();

vi.mock('../editor/rendering/SmartSelectionOverlayBackend', () => ({
  SmartSelectionOverlayBackend: class {
    constructor(...args: unknown[]) {
      overlayConstructor(...args);
    }

    setMask(mask: unknown) {
      setMask(mask);
    }
  }
}));

import { WebGpuEngine } from './WebGpuEngine';

describe('WebGpuEngine smart-selection preview presentation', () => {
  beforeEach(() => {
    setMask.mockClear();
    overlayConstructor.mockClear();
  });

  it('uploads the transient mask and dirties only the viewport presentation', () => {
    const invalidate = vi.fn();
    const invalidateCorrectionFrom = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      device: { label: 'device' },
      canvasFormat: 'rgba8unorm',
      smartSelectionOverlayBackend: null,
      renderDirty: { invalidate, invalidateCorrectionFrom },
      requestRender
    } as unknown as WebGpuEngine;
    const setPreview = WebGpuEngine.prototype.setSmartSelectionPreview.bind(engine);
    const mask = { width: 8, height: 6, data: new Uint8Array(48).fill(255) };

    setPreview(mask);
    setPreview(null);

    expect(overlayConstructor).toHaveBeenCalledOnce();
    expect(setMask.mock.calls).toEqual([[mask], [null]]);
    expect(invalidate.mock.calls).toEqual([['viewport'], ['viewport']]);
    expect(invalidateCorrectionFrom).not.toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it('does not allocate or schedule work when clearing an absent preview', () => {
    const invalidate = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      device: { label: 'device' },
      canvasFormat: 'rgba8unorm',
      smartSelectionOverlayBackend: null,
      renderDirty: { invalidate },
      requestRender
    } as unknown as WebGpuEngine;

    WebGpuEngine.prototype.setSmartSelectionPreview.call(engine, null);

    expect(overlayConstructor).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
  });
});
