import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createDefaultAdjustments } from '../../types';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { resolveBasicAdjustmentTarget } from './basicAdjustmentTarget';
import { executeSemanticGradePatch } from './executeSemanticGradePatch';

const setup = () => {
  let document: ImageDocument = createRasterLayer(
    createImageDocument('Fixture', 80, 60, 'source')
  );
  const documentAdjustments = createDefaultAdjustments();
  const documentHistory: Array<{ undo(): void; redo(): void }> = [];
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: (entry) => documentHistory.push(entry)
  }));
  return {
    documentAdjustments,
    documentHistory,
    mutation,
    get document() { return document; }
  };
};

describe('semantic Grade patch executor', () => {
  it('publishes one reversible processing snapshot only when values change', () => {
    const state = setup();
    const publish = vi.fn();
    const history = vi.fn();
    const execute = (sharpeningAmount: number) => executeSemanticGradePatch({
      assertMutationAllowed: vi.fn(),
      document: state.document,
      documentAdjustments: state.documentAdjustments,
      target: { kind: 'document' },
      values: { sharpeningAmount },
      historyType: 'adjustment.detail',
      historyLabel: 'Set Detail',
      mutate: (snapshot, values: { sharpeningAmount: number }) => {
        snapshot.detail.sharpeningAmount = values.sharpeningAmount;
      },
      changeDocument: state.mutation.change,
      publishDocumentProcessing: publish,
      pushProcessingHistoryEntry: history
    });
    expect(execute(45).changed).toBe(true);
    const entry = history.mock.calls[0]?.[0];
    entry.undo(); entry.redo();
    expect(publish).toHaveBeenCalledTimes(3);
    publish.mockClear(); history.mockClear();
    expect(execute(0).changed).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('restores document processing when its history publication rejects', () => {
    const state = setup();
    let published = state.documentAdjustments;
    expect(() => executeSemanticGradePatch({
      assertMutationAllowed: vi.fn(),
      document: state.document,
      documentAdjustments: state.documentAdjustments,
      target: { kind: 'document' },
      values: { sharpeningAmount: 45 },
      historyType: 'adjustment.detail',
      historyLabel: 'Set Detail',
      mutate: (snapshot, values: { sharpeningAmount: number }) => {
        snapshot.detail.sharpeningAmount = values.sharpeningAmount;
      },
      changeDocument: state.mutation.change,
      publishDocumentProcessing: (snapshot) => { published = snapshot; },
      pushProcessingHistoryEntry: () => { throw new Error('History rejected the patch.'); }
    })).toThrow('History rejected the patch.');
    expect(published.detail.sharpeningAmount).toBe(0);
  });

  it('routes layer Grade through the shared document mutation history', () => {
    const state = setup();
    const layerId = state.document.activeLayerId!;
    const processingPublish = vi.fn();
    const processingHistory = vi.fn();
    const result = executeSemanticGradePatch({
      assertMutationAllowed: vi.fn(),
      document: state.document,
      documentAdjustments: state.documentAdjustments,
      target: { kind: 'layer', layerId },
      values: { exposureEV: 2 },
      historyType: 'adjustment.basic',
      historyLabel: 'Set Basic Grade',
      mutate: (snapshot, values: { exposureEV: number }) => {
        snapshot.exposureEV = values.exposureEV;
      },
      changeDocument: state.mutation.change,
      publishDocumentProcessing: processingPublish,
      pushProcessingHistoryEntry: processingHistory
    });
    expect(result.changed).toBe(true);
    expect(state.documentHistory).toHaveLength(1);
    expect(processingPublish).not.toHaveBeenCalled();
    expect(processingHistory).not.toHaveBeenCalled();
    expect(resolveBasicAdjustmentTarget(
      state.document, state.documentAdjustments, { kind: 'layer', layerId }
    )).toMatchObject({ adjustments: { exposureEV: 2 } });
  });
});
