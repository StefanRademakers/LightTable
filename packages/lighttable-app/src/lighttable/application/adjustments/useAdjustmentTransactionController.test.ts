import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { findRasterLayer } from '../../editor/document/layerTree';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createAdjustmentInteractionCoordinator } from './AdjustmentInteractionCoordinator';
import {
  createAdjustmentTransactionController,
  type AdjustmentHistoryEntry,
  type AdjustmentTransactionDependencies
} from './useAdjustmentTransactionController';

const firstDocument = createImageDocument('First', 32, 24, 'first');
const secondDocument = createImageDocument('Second', 32, 24, 'second');

const setup = (documentWide = false) => {
  let document: ImageDocument = firstDocument;
  let projectedDocument = document;
  let adjustments = createDefaultAdjustments();
  let targetLayerId = documentWide ? null : firstDocument.activeLayerId;
  let targetIdentity = documentWide ? 'document:grade' : `layer:${targetLayerId}:grade`;
  const history: Array<Pick<AdjustmentHistoryEntry, 'undo' | 'redo'>> = [];
  const renderer = {
    setScopeInteractionActive: vi.fn(),
    setLensBlurInteractionActive: vi.fn()
  };
  let currentRenderer = renderer;
  let rendererGeneration = 1;
  let mutationBlocked = false;
  let rejectHistory = false;
  const previewDocument = vi.fn((next: ImageDocument) => { projectedDocument = next; });
  const applyDocument = vi.fn((next: ImageDocument) => {
    document = next;
    projectedDocument = next;
  });
  const discardDocument = vi.fn(() => { projectedDocument = document; });
  const documentMutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    previewSnapshot: previewDocument,
    applySnapshot: applyDocument,
    discardPreview: discardDocument,
    pushHistoryEntry: (entry) => {
      if (rejectHistory) throw new Error('History rejected adjustment.');
      history.push(entry);
    },
    isMutationBlocked: () => mutationBlocked
  }));
  const previewDocumentProcessing = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const commitDocumentProcessing = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const onCommitted = vi.fn();
  const discardPreview = vi.fn(() => { projectedDocument = document; });
  const restoreStagedSnapshot = vi.fn((next: BasicAdjustments) => {
    adjustments = next;
  });
  const dependencies: AdjustmentTransactionDependencies = {
    getDocumentId: () => document.id,
    getDocument: () => document,
    getDocumentAdjustments: () => createDefaultAdjustments(),
    getCanonicalAdjustments: () => {
      if (!targetLayerId) return adjustments;
      const layer = findRasterLayer(document, targetLayerId);
      return layer?.adjustmentStack
        ? materializeBasicAdjustments(layer.adjustmentStack, undefined, undefined, true)
        : createDefaultAdjustments();
    },
    getActiveTargetLayerId: () => targetLayerId,
    getActiveTargetIdentity: () => targetIdentity,
    getRenderer: () => currentRenderer,
    getRendererGeneration: () => rendererGeneration,
    isMutationBlocked: () => mutationBlocked,
    documentMutations,
    previewDocumentProcessing,
    commitDocumentProcessing,
    stageEditorAdjustments: (next) => { adjustments = next; },
    restoreStagedSnapshot,
    discardPreview,
    pushProcessingHistoryEntry: (entry) => history.push(entry),
    onCommitted
  };
  const controller = createAdjustmentTransactionController(() => dependencies);
  const layerAdjustments = () => {
    const layer = findRasterLayer(document, document.activeLayerId)!;
    return layer.adjustmentStack
      ? materializeBasicAdjustments(layer.adjustmentStack, undefined, undefined, true)
      : createDefaultAdjustments();
  };
  return {
    controller, renderer, previewDocument, applyDocument, previewDocumentProcessing,
    commitDocumentProcessing, onCommitted, restoreStagedSnapshot, discardPreview,
    history, layerAdjustments,
    documentMutations,
    get adjustments() { return adjustments; },
    get document() { return document; },
    get projectedDocument() { return projectedDocument; },
    switchDocument: () => { document = secondDocument; projectedDocument = document; },
    switchTarget: () => {
      targetLayerId = secondDocument.activeLayerId;
      targetIdentity = `layer:${targetLayerId}:grade`;
    },
    switchSubOwner: () => { targetIdentity = `layer:${targetLayerId}:lens-fx`; }
    ,replaceRenderer: () => {
      currentRenderer = {
        setScopeInteractionActive: vi.fn(),
        setLensBlurInteractionActive: vi.fn()
      };
    },
    replaceRendererGeneration: () => { rendererGeneration += 1; },
    rejectAdmission: () => { mutationBlocked = true; },
    allowAdmission: () => { mutationBlocked = false; },
    rejectHistory: () => { rejectHistory = true; },
    setPresentationAdjustments: (next: BasicAdjustments) => { adjustments = next; }
  };
};

describe('adjustment transaction controller', () => {
  it('reports a rejected warm UI terminal visibly without throwing from pointer-up', async () => {
    const state = setup(); const report = vi.fn();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), report);
    const handle = coordinator.begin('exposure'); await Promise.resolve();
    coordinator.change(handle, value => ({ ...value, exposureEV: 2 }));
    state.rejectAdmission();
    expect(() => coordinator.end(handle)).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('rejected') }));
    expect(state.history).toHaveLength(0);
  });

  it('keeps prerequisite finish strict so a rejected edit prevents the successor command', async () => {
    const state = setup(); const report = vi.fn(); const successor = vi.fn();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), report);
    const handle = coordinator.begin('exposure'); await Promise.resolve();
    coordinator.change(handle, value => ({ ...value, exposureEV: 2 }));
    state.rejectAdmission();
    expect(() => { coordinator.finish(); successor(); }).toThrow('rejected');
    expect(successor).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });

  it.each(['blocked', 'stale-target', 'canceled'] as const)('rejects file completion of a changed local edit when %s', async reason => {
    const state = setup();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), vi.fn());
    const handle = coordinator.begin('exposure');
    await Promise.resolve();
    expect(coordinator.change(handle, value => ({ ...value, exposureEV: 2 }))).toBe(true);
    const before = state.document;
    if (reason === 'blocked') state.rejectAdmission();
    if (reason === 'stale-target') state.switchSubOwner();
    if (reason === 'canceled') state.controller.reset();
    await expect(coordinator.finishForFile()).rejects.toThrow('rejected');
    expect(state.document).toBe(before);
    expect(state.history).toHaveLength(0);
    expect(state.onCommitted).not.toHaveBeenCalled();
  });

  it('rejects a pending discrete change whose document mutation admission fails', async () => {
    const state = setup();
    const report = vi.fn();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), report);
    coordinator.discreteChange(value => ({ ...value, exposureEV: 2 }));
    state.rejectAdmission();
    await expect(coordinator.finishForFile()).rejects.toThrow('rejected its discrete edit');
    expect(state.history).toHaveLength(0);
    expect(report).toHaveBeenCalledOnce();
  });

  it('rejects a queued gesture sample if document admission closes after the gesture begins', async () => {
    const state = setup();
    const report = vi.fn();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), report);
    const handle = coordinator.begin('exposure');
    coordinator.change(handle, value => {
      state.rejectAdmission();
      return { ...value, exposureEV: 2 };
    });
    await expect(coordinator.finishForFile()).rejects.toThrow('rejected its pending edit');
    expect(state.history).toHaveLength(0);
    expect(state.controller.active).toBe(false);
    expect(report).toHaveBeenCalledOnce();
  });

  it('remembers rejection of an active sample until the file terminal', async () => {
    const state = setup();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), vi.fn());
    const handle = coordinator.begin('exposure'); await Promise.resolve();
    state.switchSubOwner();
    expect(coordinator.change(handle, value => ({ ...value, exposureEV: 2 }))).toBe(false);
    await expect(coordinator.finishForFile()).rejects.toThrow('rejected its active edit');
    expect(state.history).toHaveLength(0);
  });

  it.each(['gesture', 'discrete'] as const)('allows a legitimate %s no-op through file preparation without history', async kind => {
    const state = setup();
    const coordinator = createAdjustmentInteractionCoordinator(state.controller,
      async () => ({ status: 'admitted' }), () => ({ isCurrent: () => true }), vi.fn());
    if (kind === 'discrete') coordinator.discreteChange(value => ({ ...value }));
    else {
      const handle = coordinator.begin('exposure'); await Promise.resolve();
      coordinator.change(handle, value => ({ ...value, exposureEV: 2 }));
      coordinator.change(handle, value => ({ ...value, exposureEV: 0 }));
    }
    await expect(coordinator.finishForFile()).resolves.toBeUndefined();
    expect(state.history).toHaveLength(0);
    expect(state.onCommitted).not.toHaveBeenCalled();
    expect(state.controller.active).toBe(false);
  });

  it('coalesces a layer slider gesture through one document history command', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 1 }), 'grade', gesture);
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    state.controller.change((current) => ({ ...current, exposureEV: 3 }), 'grade', gesture);
    state.controller.end(gesture);
    expect(state.layerAdjustments().exposureEV).toBe(3);
    expect(state.previewDocument).toHaveBeenCalledTimes(3);
    expect(state.applyDocument).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
    expect(state.onCommitted).toHaveBeenCalledOnce();
    expect(state.renderer.setScopeInteractionActive).toHaveBeenNthCalledWith(1, true);
    expect(state.renderer.setScopeInteractionActive).toHaveBeenLastCalledWith(false);
  });

  it('uses the explicit processing owner for a document-wide gesture', () => {
    const state = setup(true);
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 3 }), 'grade', gesture);
    state.controller.end(gesture);
    expect(state.previewDocument).not.toHaveBeenCalled();
    expect(state.previewDocumentProcessing).toHaveBeenCalledOnce();
    expect(state.commitDocumentProcessing).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(1);
    state.history[0]!.undo();
    expect(state.adjustments.exposureEV).toBe(0);
  });

  it('creates one immediate document mutation outside a layer interaction', () => {
    const state = setup();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 1 }))).toBe(true);
    expect(state.applyDocument).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(1);
    expect(state.layerAdjustments().exposureEV).toBe(1);
    state.history[0]!.undo();
    expect(state.layerAdjustments().exposureEV).toBe(0);
  });

  it('cancels a layer preview without publishing document state or history', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    state.controller.cancel(gesture);
    expect(state.document).toBe(firstDocument);
    expect(state.restoreStagedSnapshot).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(0);
    expect(state.controller.active).toBe(false);
  });

  it('rejects a pending layer interaction after document replacement', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.switchDocument();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture)).toBe(false);
    state.controller.end(gesture);
    expect(state.applyDocument).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });

  it('does not let an equal layer id hide a contextual owner switch', () => {
    const state = setup();
    const firstGesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 1 }), 'grade', firstGesture);
    state.switchSubOwner();
    const secondGesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, contrast: 20 }), 'lens-fx', secondGesture);
    state.controller.end(secondGesture);
    expect(state.history).toHaveLength(1);
    expect(state.onCommitted).toHaveBeenCalledWith(expect.objectContaining({ domain: 'lens-fx' }));
  });

  it('restores staged layer values when another document command supersedes the gesture', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    expect(state.adjustments.exposureEV).toBe(2);
    state.documentMutations.change((document) => ({ ...document, name: 'external' }));
    expect(state.controller.active).toBe(false);
    expect(state.adjustments.exposureEV).toBe(0);
    expect(state.history).toHaveLength(1);
    expect(state.controller.change(
      (current) => ({ ...current, exposureEV: 3 }),
      'grade',
      gesture
    )).toBe(false);
    state.controller.end(gesture);
    const nextGesture = state.controller.begin();
    expect(nextGesture).not.toBeNull();
    state.controller.cancel(nextGesture!);
  });

  it('cancels against the opening renderer when renderer ownership changes', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    state.replaceRenderer();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 3 }), 'grade', gesture)).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.renderer.setScopeInteractionActive).toHaveBeenLastCalledWith(false);
    expect(state.history).toHaveLength(0);
  });

  it('rejects an opening renderer generation after device rebind', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    state.replaceRendererGeneration();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 3 }), 'grade', gesture)).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('fails a rejected gesture closed instead of falling back to immediate commits', () => {
    const state = setup();
    state.rejectAdmission();
    expect(state.controller.begin()).toBeNull();
    state.allowAdmission();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 1 }))).toBe(false);
    expect(state.controller.change((current) => ({ ...current, exposureEV: 2 }))).toBe(false);
    expect(state.applyDocument).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
    state.controller.reset();
    expect(state.controller.change((current) => ({ ...current, exposureEV: 3 }))).toBe(true);
  });

  it('starts layer mutations from canonical owner state rather than stale presentation', () => {
    const state = setup();
    state.controller.change((current) => ({ ...current, contrast: 25 }));
    state.setPresentationAdjustments({
      ...createDefaultAdjustments(),
      exposureEV: 9,
      contrast: -50
    });
    state.controller.change((current) => ({ ...current, exposureEV: 1 }));
    expect(state.layerAdjustments()).toMatchObject({ exposureEV: 1, contrast: 25 });
  });

  it('rolls a layer commit back when history admission fails', () => {
    const state = setup();
    const gesture = state.controller.begin()!;
    state.controller.change((current) => ({ ...current, exposureEV: 2 }), 'grade', gesture);
    state.rejectHistory();
    expect(() => state.controller.end(gesture)).toThrow('History rejected adjustment.');
    expect(state.document).toBe(firstDocument);
    expect(state.history).toHaveLength(0);
    expect(state.controller.active).toBe(false);
  });
});
