import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { autoAlignPreviewMatchesCommand, executeAutoAlignOperation, reuseAutoAlignPreview,
  type AutoAlignRendererPort } from './executeAutoAlignOperation';

const setup = () => {
  let document = createRasterLayer(createImageDocument('Align', 40, 30, 'asset'));
  const referenceLayerId = document.activeLayerId!;
  document = createRasterLayer(document);
  const targetLayerId = document.activeLayerId!;
  const result = { model: 'translation' as const, referenceLayerId, targetLayerId,
    correctionMatrix: { a: 1, b: 0, c: 0, d: 1, tx: -4, ty: 3 }, confidence: 0.9,
    overlap: 0.8, residualError: 0.1, diagnostics: { bestError: 0.1, secondBestError: 0.2,
      identityError: 0.3, improvementFromIdentity: 0.2, separation: 0.1, overlap: 0.8,
      validPixelCount: 100 } };
  const renderer: AutoAlignRendererPort = {
    alignLayersTranslation: vi.fn(async () => result),
    previewTranslationAlignment: vi.fn(() => true), clearTranslationAlignmentPreview: vi.fn(() => true)
  };
  return { get document() { return document; },
    change: () => { document = { ...document, revision: document.revision + 1 }; },
    referenceLayerId, targetLayerId, result, renderer };
};

describe('executeAutoAlignOperation', () => {
  it('reuses a preview only for the same command and exact document revision', () => {
    const state = setup();
    const command = { referenceLayerId: state.referenceLayerId, targetLayerId: state.targetLayerId };
    expect(autoAlignPreviewMatchesCommand(state.result,
      { documentId: state.document.id, revision: state.document.revision }, state.document, command)).toBe(true);
    state.change();
    expect(autoAlignPreviewMatchesCommand(state.result,
      { documentId: state.document.id, revision: state.document.revision - 1 }, state.document, command)).toBe(false);
  });

  it('commits a matching preview without invoking another analysis boundary', () => {
    const state = setup();
    const commit = vi.fn(() => ({ changed: true }));
    expect(reuseAutoAlignPreview(state.result,
      { documentId: state.document.id, revision: state.document.revision }, state.document,
      { referenceLayerId: state.referenceLayerId, targetLayerId: state.targetLayerId }, commit))
      .toEqual({ reused: true, value: { changed: true } });
    expect(commit).toHaveBeenCalledOnce();
    expect(state.renderer.alignLayersTranslation).not.toHaveBeenCalled();
  });

  it('analyzes explicit layers and commits the returned geometry once', async () => {
    const state = setup();
    const commit = vi.fn(() => ({ changed: true }));
    await expect(executeAutoAlignOperation({ document: state.document, renderer: state.renderer,
      command: { referenceLayerId: state.referenceLayerId, targetLayerId: state.targetLayerId },
      signal: new AbortController().signal, getDocument: () => state.document, commit }))
      .resolves.toEqual({ changed: true });
    expect(state.renderer.alignLayersTranslation).toHaveBeenCalledWith(
      state.referenceLayerId, state.targetLayerId, {}, expect.any(AbortSignal)
    );
    expect(commit).toHaveBeenCalledWith(state.result);
  });

  it('does not commit an analysis produced for a stale document', async () => {
    const state = setup();
    vi.mocked(state.renderer.alignLayersTranslation).mockImplementation(async () => {
      state.change(); return state.result;
    });
    const commit = vi.fn();
    await expect(executeAutoAlignOperation({ document: state.document, renderer: state.renderer,
      command: { referenceLayerId: state.referenceLayerId, targetLayerId: state.targetLayerId },
      signal: new AbortController().signal, getDocument: () => state.document, commit }))
      .rejects.toThrow('document changed');
    expect(commit).not.toHaveBeenCalled();
  });
});
