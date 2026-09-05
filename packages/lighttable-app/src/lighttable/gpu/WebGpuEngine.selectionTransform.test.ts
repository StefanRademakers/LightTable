import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

const engineHarness = (validationError: GPUError | null = null) => {
  const renderer = { transformSelection: vi.fn(() => true) };
  const onDeviceLost = vi.fn();
  const device = {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => validationError)
  };
  const engine = {
    callbacks: { onDeviceLost },
    destroyed: false,
    device,
    documentRenderer: renderer,
    imageDocument: { id: 'document-1' },
    renderDirty: { invalidate: vi.fn() },
    requestRender: vi.fn(),
    selectionQueue: Promise.resolve()
  } as unknown as WebGpuEngine;
  Object.setPrototypeOf(engine, WebGpuEngine.prototype);
  return { device, engine, onDeviceLost, renderer };
};

describe('WebGpuEngine selection transform queue', () => {
  it('captures validation around the queued GPU transform', async () => {
    const { device, engine, renderer } = engineHarness();

    await expect(WebGpuEngine.prototype.transformSelection.call(engine, {
      a: 1, b: 0, c: 0, d: 1, tx: 4, ty: -2
    })).resolves.toBe(true);

    expect(device.pushErrorScope).toHaveBeenCalledWith('validation');
    expect(device.popErrorScope).toHaveBeenCalledTimes(1);
    expect(renderer.transformSelection).toHaveBeenCalledTimes(1);
  });

  it('drops a drag update when zoom or document work replaced its renderer', async () => {
    const { device, engine, renderer } = engineHarness();
    let releaseQueue!: () => void;
    (engine as unknown as { selectionQueue: Promise<void> }).selectionQueue = new Promise((resolve) => {
      releaseQueue = resolve;
    });

    const task = WebGpuEngine.prototype.transformSelection.call(engine, {
      a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 1
    });
    (engine as unknown as { documentRenderer: object }).documentRenderer = {};
    releaseQueue();

    await expect(task).resolves.toBe(false);
    expect(renderer.transformSelection).not.toHaveBeenCalled();
    expect(device.pushErrorScope).not.toHaveBeenCalled();
  });

  it('contains an invalid transform command instead of emitting an uncaptured runtime error', async () => {
    const validationError = { message: 'invalid command buffer' } as GPUError;
    const { engine, onDeviceLost } = engineHarness(validationError);

    await expect(WebGpuEngine.prototype.transformSelection.call(engine, {
      a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 1
    })).resolves.toBe(false);
    expect(onDeviceLost).toHaveBeenCalledWith(
      'LightTable selection transform validation failed: invalid command buffer'
    );
  });

  it('drops a queued selection replay when the active document renderer changes', async () => {
    const { engine } = engineHarness();
    const originalRenderer = {
      captureSelectionSnapshot: vi.fn(),
      clearSelection: vi.fn()
    };
    const replacementRenderer = {
      captureSelectionSnapshot: vi.fn(),
      clearSelection: vi.fn()
    };
    (engine as unknown as { documentRenderer: object }).documentRenderer = originalRenderer;
    let releaseQueue!: () => void;
    (engine as unknown as { selectionQueue: Promise<void> }).selectionQueue = new Promise((resolve) => {
      releaseQueue = resolve;
    });

    const task = WebGpuEngine.prototype.replaceSelection.call(engine, []);
    (engine as unknown as { documentRenderer: object }).documentRenderer = replacementRenderer;
    (engine as unknown as { imageDocument: { id: string } }).imageDocument = { id: 'document-2' };
    releaseQueue();

    await expect(task).resolves.toBe(false);
    expect(originalRenderer.captureSelectionSnapshot).not.toHaveBeenCalled();
    expect(originalRenderer.clearSelection).not.toHaveBeenCalled();
    expect(replacementRenderer.captureSelectionSnapshot).not.toHaveBeenCalled();
    expect(replacementRenderer.clearSelection).not.toHaveBeenCalled();
  });

  it('does not replay or restore an old selection after capture crosses a document switch', async () => {
    const { engine } = engineHarness();
    let finishCapture!: (snapshot: object) => void;
    const renderer = {
      captureSelectionSnapshot: vi.fn(() => new Promise((resolve) => {
        finishCapture = resolve;
      })),
      clearSelection: vi.fn(),
      restoreSelectionSnapshot: vi.fn()
    };
    (engine as unknown as { documentRenderer: object }).documentRenderer = renderer;

    const task = WebGpuEngine.prototype.replaceSelection.call(engine, []);
    await vi.waitFor(() => expect(renderer.captureSelectionSnapshot).toHaveBeenCalledOnce());
    (engine as unknown as { imageDocument: { id: string } }).imageDocument = { id: 'document-2' };
    finishCapture({ width: 1, height: 1, values: new Uint16Array(1) });

    await expect(task).resolves.toBe(false);
    expect(renderer.clearSelection).not.toHaveBeenCalled();
    expect(renderer.restoreSelectionSnapshot).not.toHaveBeenCalled();
  });
});
