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
  const backend: SmartSelectionBackend = {
    identity: {
      modelId: 'test', artifactRevision: 'test', precision: 'fp16',
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
      id: prompt.box ? 'box' : 'candidate', score: 0.9, mask
    }]),
    selectSubject: vi.fn(async () => [{ id: 'subject', score: 0.95, mask }]),
    disposePreparedSource: vi.fn(),
    dispose: vi.fn()
  };
  const options = createDefaultSmartSelectionOptions();
  const setDraft = vi.fn();
  const controller = new SmartSelectionToolController({
    getDocument: () => document,
    getRenderer: () => renderer,
    isRendererReady: () => true,
    getOptions: () => options,
    selection: { rasterMask } as unknown as SelectionSessionController,
    setStatus: vi.fn(),
    setDraft
  }, backend);
  return { backend, controller, document, options, rasterMask, renderer, setDraft };
};

describe('SmartSelectionToolController', () => {
  it('commits an Object Finder click directly through the normal selection path', async () => {
    const { backend, controller, rasterMask, renderer } = harness();
    expect(controller.selectPoint({ x: 3, y: 2 }, 'add')).toBe(true);
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledWith(mask, 'add'));
    expect(backend.selectPrompt).toHaveBeenCalledWith(
      expect.anything(),
      { points: [{ point: { x: 3, y: 2 }, label: 'positive' }] },
      expect.anything()
    );
    expect(renderer.setSmartSelectionPreview).toHaveBeenLastCalledWith(null);
  });

  it('repeats a fast hover prompt at final refinement quality before committing', async () => {
    const { backend, controller, rasterMask } = harness();
    controller.hover({ x: 3, y: 2 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.selectPoint({ x: 3, y: 2 }, 'replace');
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledWith(mask, 'replace'));
    expect(backend.selectPrompt).toHaveBeenCalledTimes(2);
    expect(backend.selectPrompt).toHaveBeenLastCalledWith(
      expect.anything(),
      { points: [{ point: { x: 3, y: 2 }, label: 'positive' }] },
      expect.objectContaining({ refineEdges: true })
    );
  });

  it('turns a rectangle gesture into a box prompt and commits on release', async () => {
    const { backend, controller, options, rasterMask, setDraft } = harness();
    options.mode = 'rectangle';
    expect(controller.beginRegion(7, { x: 1, y: 1 }, 'subtract')).toBe(true);
    controller.moveRegion(7, { x: 6, y: 5 });
    expect(controller.finishRegion(7)).toBe(true);
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledWith(mask, 'subtract'));
    expect(backend.selectPrompt).toHaveBeenCalledWith(
      expect.anything(),
      { points: [], box: { x: 1, y: 1, width: 5, height: 4 } },
      expect.anything()
    );
    expect(setDraft).toHaveBeenLastCalledWith(null);
  });

  it('keeps at most one hover inference active and retains only the newest point', async () => {
    const { backend, controller } = harness();
    let finishFirst!: (value: SmartSelectionCandidate[]) => void;
    const emptyMask = { width: 8, height: 6, data: new Uint8Array(48) };
    vi.mocked(backend.selectPrompt)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue([{ id: 'latest', score: 0.9, mask: emptyMask }]);
    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.hover({ x: 2, y: 2 });
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

  it('invalidates an in-flight hover decode when an explicit click is made', async () => {
    const { backend, controller, rasterMask } = harness();
    let finishHover!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectPrompt)
      .mockImplementationOnce(() => new Promise((resolve) => { finishHover = resolve; }))
      .mockResolvedValueOnce([{ id: 'clicked', score: 1, mask }]);
    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    controller.selectPoint({ x: 5, y: 4 }, 'replace');
    finishHover([{ id: 'stale', score: 1, mask }]);
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledOnce());
    expect(backend.selectPrompt).toHaveBeenLastCalledWith(
      expect.anything(),
      { points: [{ point: { x: 5, y: 4 }, label: 'positive' }] },
      expect.anything()
    );
  });

  it('keeps Select Subject authoritative while hover inference is in flight', async () => {
    const { backend, controller, rasterMask } = harness();
    const hoverMask = { width: 8, height: 6, data: new Uint8Array(48).fill(64) };
    const subjectMask = { width: 8, height: 6, data: new Uint8Array(48).fill(255) };
    let finishHover!: (value: SmartSelectionCandidate[]) => void;
    let finishSubject!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectPrompt).mockImplementationOnce(
      () => new Promise((resolve) => { finishHover = resolve; })
    );
    vi.mocked(backend.selectSubject!).mockImplementationOnce(
      () => new Promise((resolve) => { finishSubject = resolve; })
    );

    controller.hover({ x: 1, y: 1 });
    await vi.waitFor(() => expect(backend.selectPrompt).toHaveBeenCalledOnce());
    const selecting = controller.selectSubject('replace');
    await vi.waitFor(() => expect(backend.selectSubject).toHaveBeenCalledOnce());

    controller.hover({ x: 6, y: 4 });
    finishHover([{ id: 'stale-hover', score: 1, mask: hoverMask }]);
    finishSubject([{ id: 'subject', score: 1, mask: subjectMask }]);

    await expect(selecting).resolves.toBe(true);
    expect(rasterMask).toHaveBeenCalledOnce();
    expect(rasterMask).toHaveBeenCalledWith(subjectMask, 'replace');
  });

  it('rejects a subject mask if the document changes before commit', async () => {
    const { backend, controller, document, rasterMask } = harness();
    let finishSubject!: (value: SmartSelectionCandidate[]) => void;
    vi.mocked(backend.selectSubject!).mockImplementationOnce(
      () => new Promise((resolve) => { finishSubject = resolve; })
    );

    const selecting = controller.selectSubject('replace');
    await vi.waitFor(() => expect(backend.selectSubject).toHaveBeenCalledOnce());
    // Simulate an editor mutation after inference started. The prepared source
    // may no longer be mapped to the current document revision.
    document.revision += 1;
    finishSubject([{ id: 'stale-subject', score: 1, mask }]);

    await expect(selecting).resolves.toBe(false);
    expect(rasterMask).not.toHaveBeenCalled();
  });

  it.each(['replace', 'add', 'subtract', 'intersect'] as const)(
    'commits directly with the existing %s combine mode',
    async (mode) => {
      const { controller, rasterMask } = harness();
      controller.selectPoint({ x: 3, y: 2 }, mode);
      await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledWith(mask, mode));
    }
  );

  it('keeps the preview visible when the persistent selection commit fails', async () => {
    const { controller, rasterMask, renderer } = harness();
    rasterMask.mockResolvedValueOnce(false);
    controller.selectPoint({ x: 3, y: 2 }, 'replace');
    await vi.waitFor(() => expect(rasterMask).toHaveBeenCalledOnce());
    expect(renderer.setSmartSelectionPreview).not.toHaveBeenLastCalledWith(null);
  });

  it('reuses a prepared source and releases it when disposed', async () => {
    const { backend, controller, renderer } = harness();
    await Promise.all([controller.prepare(), controller.prepare()]);
    expect(renderer.exportPng).toHaveBeenCalledOnce();
    expect(backend.prepare).toHaveBeenCalledOnce();
    controller.dispose();
    expect(backend.disposePreparedSource).toHaveBeenCalledOnce();
    expect(backend.dispose).toHaveBeenCalledOnce();
  });
});
