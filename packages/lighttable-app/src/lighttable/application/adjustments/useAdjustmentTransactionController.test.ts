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
  let targetLayerId = firstDocument.activeLayerId;
  const history: AdjustmentHistoryEntry[] = [];
  const renderer = {
    setScopeInteractionActive: vi.fn(),
    setLensBlurInteractionActive: vi.fn()
  };
  const previewSnapshot = vi.fn((
    next: BasicAdjustments,
    _targetLayerId: unknown,
    _domain: unknown
  ) => {
    adjustments = next;
  });
  const commitSnapshot = vi.fn((
    next: BasicAdjustments,
    _targetLayerId: unknown,
    _domain: unknown
  ) => {
    adjustments = next;
  });
  const onCommitted = vi.fn();
  const discardPreview = vi.fn();
  const restoreStagedSnapshot = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const dependencies: AdjustmentTransactionDependencies = {
    getDocumentId: () => documentId,
    getAdjustments: () => adjustments,
    getActiveTargetLayerId: () => targetLayerId,
    getRenderer: () => renderer,
    previewSnapshot,
    commitSnapshot,
    restoreStagedSnapshot,
    discardPreview,
    pushHistoryEntry: (entry) => history.push(entry),
    onCommitted
  };
  const controller = createAdjustmentTransactionController(() => dependencies);
  return {
    controller,
    renderer,
    previewSnapshot,
    commitSnapshot,
    onCommitted,
    restoreStagedSnapshot,
    discardPreview,
    history,
    get adjustments() { return adjustments; },
    switchDocument: () => { documentId = secondDocument.id; },
    switchTarget: () => { targetLayerId = secondDocument.activeLayerId; }
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
    expect(state.onCommitted).toHaveBeenCalledOnce();
    expect(state.onCommitted).toHaveBeenCalledWith(expect.objectContaining({
      targetLayerId: firstDocument.activeLayerId,
      domain: 'grade',
      before: expect.objectContaining({ exposureEV: 0 }),
      after: expect.objectContaining({ exposureEV: 3 })
    }));
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

  it('preserves the owning presentation domain through preview and commit', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => ({
      ...current,
      effects: {
        ...current.effects,
        grain: { ...current.effects.grain, amount: 1.5 }
      }
    }), 'lens-fx');
    state.controller.end();

    expect(state.previewSnapshot.mock.calls[0]?.[2]).toBe('lens-fx');
    expect(state.commitSnapshot.mock.calls[0]?.[2]).toBe('lens-fx');
  });

  it('does not commit a gesture that returns to its starting value', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => ({ ...current, exposureEV: 2 }));
    state.controller.change((current) => ({ ...current, exposureEV: 0 }));
    state.controller.end();

    expect(state.previewSnapshot).toHaveBeenCalledTimes(2);
    expect(state.commitSnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
    expect(state.onCommitted).not.toHaveBeenCalled();
    expect(state.discardPreview).toHaveBeenCalledOnce();
  });

  it('cancels a preview without changing document state or history', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => ({ ...current, exposureEV: 2 }));

    state.controller.cancel();

    expect(state.adjustments.exposureEV).toBe(0);
    expect(state.restoreStagedSnapshot).toHaveBeenCalledOnce();
    expect(state.discardPreview).toHaveBeenCalledOnce();
    expect(state.commitSnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
    expect(state.controller.active).toBe(false);
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

  it('does not let a lost pointer transaction capture a later layer interaction', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => ({ ...current, exposureEV: 1 }));
    state.switchTarget();

    state.controller.begin();
    state.controller.change((current) => ({ ...current, exposureEV: 2 }));
    state.controller.end();

    expect(state.previewSnapshot).toHaveBeenCalledTimes(2);
    expect(state.previewSnapshot.mock.calls[0]?.[1]).toBe(firstDocument.activeLayerId);
    expect(state.previewSnapshot.mock.calls[1]?.[1]).toBe(secondDocument.activeLayerId);
    expect(state.commitSnapshot).toHaveBeenCalledTimes(1);
    expect(state.commitSnapshot.mock.calls[0]?.[1]).toBe(secondDocument.activeLayerId);
    expect(state.history).toHaveLength(1);
  });

  it('rejects a stale target change when no new interaction was begun', () => {
    const state = setup();
    state.controller.begin();
    state.switchTarget();

    expect(state.controller.change((current) => ({ ...current, exposureEV: 2 }))).toBe(false);
    expect(state.previewSnapshot).not.toHaveBeenCalled();
    expect(state.commitSnapshot).not.toHaveBeenCalled();
  });
});
