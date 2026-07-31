import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import {
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import {
  createAdjustmentTransactionController,
  type AdjustmentHistoryEntry,
  type AdjustmentTransactionDependencies
} from './useAdjustmentTransactionController';

const firstDocument = createImageDocument('First', 32, 24, 'first');
const secondDocument = createImageDocument('Second', 32, 24, 'second');

const setup = () => {
  let documentId = firstDocument.id;
  let adjustments = createDefaultAdjustments();
  const targetLayerId = firstDocument.activeLayerId;
  const history: AdjustmentHistoryEntry[] = [];
  const renderer = {
    setScopeInteractionActive: vi.fn(),
    setLensBlurInteractionActive: vi.fn()
  };
  const previewSnapshot = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const commitSnapshot = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const dependencies: AdjustmentTransactionDependencies = {
    getDocumentId: () => documentId,
    getAdjustments: () => adjustments,
    getActiveTargetLayerId: () => targetLayerId,
    getRenderer: () => renderer,
    previewSnapshot,
    commitSnapshot,
    pushHistoryEntry: (entry) => history.push(entry)
  };
  const controller = createAdjustmentTransactionController(() => dependencies);
  return {
    controller,
    renderer,
    previewSnapshot,
    commitSnapshot,
    history,
    get adjustments() { return adjustments; },
    switchDocument: () => { documentId = secondDocument.id; }
  };
};

describe('adjustment transaction controller', () => {
  it('coalesces a complete slider gesture into one history command', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => ({ ...current, exposureEV: 1 }));
    state.controller.change((current) => ({ ...current, exposureEV: 2 }));
    state.controller.change((current) => ({ ...current, exposureEV: 3 }));
    state.controller.end();
    expect(state.adjustments.exposureEV).toBe(3);
    expect(state.previewSnapshot).toHaveBeenCalledTimes(3);
    expect(state.commitSnapshot).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
    expect(state.renderer.setScopeInteractionActive).toHaveBeenNthCalledWith(1, true);
    expect(state.renderer.setScopeInteractionActive).toHaveBeenLastCalledWith(false);
  });

  it('creates one immediate history command outside an interaction', () => {
    const state = setup();
    state.controller.change((current) => ({ ...current, contrast: 12 }));
    expect(state.previewSnapshot).not.toHaveBeenCalled();
    expect(state.commitSnapshot).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
    state.history[0].undo();
    expect(state.adjustments.contrast).toBe(0);
    state.history[0].redo();
    expect(state.adjustments.contrast).toBe(12);
  });

  it('rejects a pending interaction after a document switch', () => {
    const state = setup();
    state.controller.begin();
    state.switchDocument();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 2 }))).toBe(false);
    state.controller.end();
    expect(state.previewSnapshot).not.toHaveBeenCalled();
    expect(state.commitSnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });
});
