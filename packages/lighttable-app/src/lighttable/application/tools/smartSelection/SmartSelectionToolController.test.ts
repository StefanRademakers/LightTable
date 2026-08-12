import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { createDefaultSmartSelectionOptions } from '../../../editor/selection/selectionTypes';
import type { SelectionSessionController } from '../selection/useSelectionSessionController';
import type { SmartSelectionBackend, SmartSelectionCandidate } from './SmartSelectionBackend';
import { SmartSelectionToolController } from './SmartSelectionToolController';

const mask = { width: 8, height: 6, data: new Uint8Array(48).fill(255) };

const harness = () => {
  const document = createImageDocument('Object selection', 8, 6, 'background');
  const renderer = {
    exportPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    setSmartSelectionPreview: vi.fn()
  };
  const rasterMask = vi.fn(async () => true);
  const selection = { rasterMask } as unknown as SelectionSessionController;
  const backend: SmartSelectionBackend = {
    prepare: vi.fn(async (source) => ({
      id: source.key, sourceKey: source.key, documentRevision: source.documentRevision,
      width: source.width, height: source.height
    })),
    selectPoint: vi.fn(async () => [{ id: 'candidate', score: 0.9, mask }]),
    selectBox: vi.fn(async () => [{ id: 'box', score: 0.8, mask }]),
    selectSubject: vi.fn(async () => [{ id: 'subject', score: 0.95, mask }]),
    disposePreparedSource: vi.fn(),
    dispose: vi.fn()
  };
  const options = createDefaultSmartSelectionOptions();
  let rendererReady = true;
  const setDraft = vi.fn();
  const controller = new SmartSelectionToolController({
    getDocument: () => document,
    getRenderer: () => renderer,
    isRendererReady: () => rendererReady,
    getOptions: () => options,
    selection,
    setStatus: vi.fn(),
    setDraft
  }, backend);
  return {
    backend, controller, options, rasterMask, renderer, setDraft,
    setRendererReady: (ready: boolean) => { rendererReady = ready; }
  };
};

describe('SmartSelectionToolController', () => {
  it('reuses one prepared source and commits the preview as a normal selection mask', async () => {
    const { backend, controller, rasterMask, renderer } = harness();
    await controller.prepare();
    await controller.commitPoint({ x: 3, y: 2 }, 'add');
    expect(renderer.exportPng).toHaveBeenCalledTimes(1);
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    expect(rasterMask).toHaveBeenCalledWith(mask, 'add');
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(null);
  });

  it('coalesces concurrent source preparation before image export and inference', async () => {
    const { backend, controller, renderer } = harness();
    const [first, second] = await Promise.all([controller.prepare(), controller.prepare()]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(renderer.exportPng).toHaveBeenCalledTimes(1);
    expect(backend.prepare).toHaveBeenCalledTimes(1);
  });

  it('does not export an inference source before the document renderer is ready', async () => {
    const { backend, controller, renderer, setRendererReady } = harness();
    setRendererReady(false);

    await expect(controller.prepare()).resolves.toBe(false);
    expect(renderer.exportPng).not.toHaveBeenCalled();
    expect(backend.prepare).not.toHaveBeenCalled();
  });

  it('turns rectangle interaction into a box prompt rather than a geometric selection', async () => {
    const { backend, controller, options, rasterMask, setDraft } = harness();
    options.mode = 'rectangle';
    expect(controller.beginRegion(7, { x: 1, y: 1 }, 'replace')).toBe(true);
    controller.moveRegion(7, { x: 6, y: 5 });
    controller.finishRegion(7);
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledWith(mask, 'replace'));
    expect(backend.selectBox).toHaveBeenCalledWith(
      expect.anything(),
      { x: 1, y: 1, width: 5, height: 4 },
      expect.objectContaining({ hardEdge: false })
    );
    expect(setDraft).toHaveBeenLastCalledWith(null);
  });

  it('commits Select Subject through the same raster selection path', async () => {
    const { backend, controller, rasterMask } = harness();
    await expect(controller.selectSubject()).resolves.toBe(true);
    expect(backend.selectSubject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hardEdge: false })
    );
    expect(rasterMask).toHaveBeenCalledWith(mask, 'replace');
  });

  it('keeps the GPU candidate preview visible until the persistent mask commit succeeds', async () => {
    const { controller, rasterMask, renderer } = harness();
    let finishCommit!: (value: boolean) => void;
    rasterMask.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishCommit = resolve;
    }));

    const commit = controller.commitPoint({ x: 3, y: 2 }, 'replace');
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledOnce());
    expect(renderer.setSmartSelectionPreview).not.toHaveBeenCalledWith(null);

    finishCommit(true);
    await expect(commit).resolves.toBe(true);
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(null);
  });

  it('does not discard the candidate preview when the persistent mask commit fails', async () => {
    const { controller, rasterMask, renderer } = harness();
    rasterMask.mockResolvedValueOnce(false);

    await expect(controller.commitPoint({ x: 3, y: 2 }, 'replace')).resolves.toBe(false);
    expect(renderer.setSmartSelectionPreview).not.toHaveBeenCalledWith(null);
  });

  it('does not let a hover request supersede an in-flight click commit', async () => {
    const { backend, controller, rasterMask } = harness();
    let finishPoint!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectPoint).mockImplementationOnce(() => new Promise((resolve) => {
      finishPoint = resolve;
    }));

    const commit = controller.commitPoint({ x: 3, y: 2 }, 'replace');
    await vi.waitFor(() => expect(backend.selectPoint).toHaveBeenCalledOnce());
    controller.hover({ x: 4, y: 3 });
    expect(backend.selectPoint).toHaveBeenCalledOnce();
    finishPoint([{ id: 'candidate', score: 0.9, mask }]);
    await expect(commit).resolves.toBe(true);
    expect(rasterMask).toHaveBeenCalledOnce();
  });

  it('keeps one hover inference active and decodes only the newest pending point', async () => {
    const { backend, controller } = harness();
    let finishFirst!: (value: SmartSelectionCandidate[]) => void;
    const emptyMask = { width: 8, height: 6, data: new Uint8Array(48) };
    vi.mocked(backend.selectPoint)
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirst = resolve;
      }))
      .mockResolvedValue([{ id: 'latest', score: 0.9, mask: emptyMask }]);

    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPoint).toHaveBeenCalledOnce());
    controller.hover({ x: 2, y: 2 });
    controller.hover({ x: 3, y: 3 });
    controller.hover({ x: 4, y: 4 });
    expect(backend.selectPoint).toHaveBeenCalledOnce();

    finishFirst([{ id: 'first', score: 0.8, mask: emptyMask }]);
    await vi.waitFor(() => expect(backend.selectPoint).toHaveBeenCalledTimes(2));
    expect(backend.selectPoint).toHaveBeenLastCalledWith(
      expect.anything(),
      { x: 4, y: 4 },
      expect.anything()
    );
  });
});
