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
    identity: {
      modelId: 'test', artifactRevision: 'test', precision: 'test',
      preprocessingRevision: 'test'
    },
    capabilities: {
      positivePoints: true, negativePoints: true, boxes: true,
      previousMask: false, automaticSubject: true
    },
    prepare: vi.fn(async (source) => ({
      id: source.key, sourceKey: source.key, documentRevision: source.documentRevision,
      width: source.width, height: source.height
    })),
    selectPrompt: vi.fn(async (_source, prompt) => [{
      id: prompt.box ? 'box' : 'candidate', score: prompt.box ? 0.8 : 0.9, mask
    }]),
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
  it('reuses one prepared source and applies the refined preview through the normal selection path', async () => {
    const { backend, controller, rasterMask, renderer } = harness();
    await controller.prepare();
    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    await controller.apply('add');
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
    const { backend, controller, options, rasterMask, renderer, setDraft } = harness();
    options.mode = 'rectangle';
    expect(controller.beginRegion(7, { x: 1, y: 1 }, 'replace')).toBe(true);
    controller.moveRegion(7, { x: 6, y: 5 });
    controller.finishRegion(7);
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    await expect(controller.apply('replace')).resolves.toBe(true);
    expect(rasterMask).toHaveBeenCalledWith(mask, 'replace');
    expect(backend.selectPrompt).toHaveBeenCalledWith(
      expect.anything(),
      { points: [], box: { x: 1, y: 1, width: 5, height: 4 } },
      expect.objectContaining({ hardEdge: false })
    );
    expect(setDraft).toHaveBeenLastCalledWith(null);
  });

  it('previews Select Subject and only commits it after Apply', async () => {
    const { backend, controller, rasterMask, renderer } = harness();
    await expect(controller.selectSubject()).resolves.toBe(true);
    expect(backend.selectSubject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hardEdge: false })
    );
    expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask);
    controller.clearHoverPreview();
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(mask);
    expect(rasterMask).not.toHaveBeenCalled();
    await expect(controller.apply('replace')).resolves.toBe(true);
    expect(rasterMask).toHaveBeenCalledWith(mask, 'replace');
  });

  it('combines positive and negative clicks in one cached refinement session', async () => {
    const { backend, controller, renderer } = harness();
    controller.refinePoint({ x: 2, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    controller.refinePoint({ x: 6, y: 4 }, 'negative');
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledTimes(2));
    expect(backend.selectPrompt).toHaveBeenLastCalledWith(
      expect.anything(),
      { points: [
        { point: { x: 2, y: 2 }, label: 'positive' },
        { point: { x: 6, y: 4 }, label: 'negative' }
      ], box: undefined },
      expect.anything()
    );
    expect(backend.prepare).toHaveBeenCalledTimes(1);
  });

  it('undoes the newest prompt and reset invalidates an in-flight stale candidate', async () => {
    const { backend, controller, renderer } = harness();
    let finishSecond!: (value: SmartSelectionCandidate[]) => void;
    controller.refinePoint({ x: 2, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    vi.mocked(backend.selectPrompt).mockImplementationOnce(() => new Promise((resolve) => {
      finishSecond = resolve;
    }));
    controller.refinePoint({ x: 6, y: 4 }, 'negative');
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledTimes(2));
    expect(controller.undoPrompt()).toBe(true);
    controller.resetPrompts();
    finishSecond([{ id: 'stale', score: 1, mask }]);
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(null));
    expect(vi.mocked(renderer.setSmartSelectionPreview).mock.calls.at(-1)).toEqual([null]);
  });

  it('keeps the GPU candidate preview visible until the persistent mask commit succeeds', async () => {
    const { controller, rasterMask, renderer } = harness();
    let finishCommit!: (value: boolean) => void;
    rasterMask.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishCommit = resolve;
    }));

    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    const commit = controller.apply('replace');
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledOnce());
    expect(renderer.setSmartSelectionPreview).not.toHaveBeenCalledWith(null);

    finishCommit(true);
    await expect(commit).resolves.toBe(true);
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(null);
  });

  it('does not discard the candidate preview when the persistent mask commit fails', async () => {
    const { controller, rasterMask, renderer } = harness();
    rasterMask.mockResolvedValueOnce(false);

    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    await expect(controller.apply('replace')).resolves.toBe(false);
    expect(renderer.setSmartSelectionPreview).not.toHaveBeenCalledWith(null);
  });

  it('does not let hover inference supersede an explicit prompt refinement', async () => {
    const { backend, controller, rasterMask, renderer } = harness();
    let finishPoint!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectPrompt).mockImplementationOnce(() => new Promise((resolve) => {
      finishPoint = resolve;
    }));

    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.hover({ x: 4, y: 3 });
    expect(backend.selectPrompt).toHaveBeenCalledOnce();
    finishPoint([{ id: 'candidate', score: 0.9, mask }]);
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    expect(rasterMask).not.toHaveBeenCalled();
  });

  it('drops a late hover result after an explicit click starts refinement', async () => {
    const { backend, controller, renderer } = harness();
    let finishHover!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectPrompt)
      .mockImplementationOnce(() => new Promise((resolve) => { finishHover = resolve; }))
      .mockResolvedValueOnce([{ id: 'explicit', score: 0.9, mask }]);
    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    finishHover([{ id: 'stale-hover', score: 1, mask }]);
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    expect(vi.mocked(renderer.setSmartSelectionPreview).mock.calls).toHaveLength(1);
  });

  it('keeps an explicit refinement visible when the pointer leaves the canvas', async () => {
    const { controller, renderer } = harness();
    controller.refinePoint({ x: 3, y: 2 }, 'positive');
    await vi.waitFor(() => expect(renderer.setSmartSelectionPreview).toHaveBeenCalledWith(mask));
    controller.clearHoverPreview();
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(mask);
  });

  it('keeps one hover inference active and decodes only the newest pending point', async () => {
    const { backend, controller } = harness();
    let finishFirst!: (value: SmartSelectionCandidate[]) => void;
    const emptyMask = { width: 8, height: 6, data: new Uint8Array(48) };
    vi.mocked(backend.selectPrompt)
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirst = resolve;
      }))
      .mockResolvedValue([{ id: 'latest', score: 0.9, mask: emptyMask }]);

    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.hover({ x: 2, y: 2 });
    controller.hover({ x: 3, y: 3 });
    controller.hover({ x: 4, y: 4 });
    expect(backend.selectPrompt).toHaveBeenCalledOnce();

    finishFirst([{ id: 'first', score: 0.8, mask: emptyMask }]);
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledTimes(2));
    expect(backend.selectPrompt).toHaveBeenLastCalledWith(
      expect.anything(),
      { points: [{ point: { x: 4, y: 4 }, label: 'positive' }] },
      expect.anything()
    );
  });
});
