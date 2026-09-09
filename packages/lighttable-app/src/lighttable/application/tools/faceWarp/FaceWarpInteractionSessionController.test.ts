import { describe, expect, it, vi } from 'vitest';
import { createDocumentMutationController } from '../../documents/useDocumentMutationController';
import { createImageDocument, type ImageDocument } from '../../../editor/document/documentTypes';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import {
  createFaceWarpInteractionSessionController,
  type FaceWarpGestureContext
} from './FaceWarpInteractionSessionController';

const document = (): ImageDocument => createRasterLayer(
  createImageDocument('Face Warp', 32, 32, 'asset'),
  'Second'
);

const gesture = (pointerId = 7): FaceWarpGestureContext => ({
  pointerId,
  faceId: 'face-a',
  seedSource: { x: 2, y: 3 },
  startPointerSource: { x: 2, y: 3 },
  originalDisplacements: [],
  latestRadius: 0,
  mode: 'sculpt'
});

const harness = () => {
  let current = document();
  let preview = current;
  let bindingCurrent = true;
  let scheduled: (() => void) | null = null;
  const modes: Array<string | null> = [];
  const history: unknown[] = [];
  const errors: string[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => current,
    applySnapshot: (next) => { current = next; preview = next; },
    previewSnapshot: (next) => { preview = next; },
    discardPreview: () => { preview = current; },
    pushHistoryEntry: (entry) => { history.push(entry); },
    isMutationBlocked: () => false
  }));
  const controller = createFaceWarpInteractionSessionController(() => ({
    getDocument: () => current,
    documentMutations: mutations,
    acquireRendererBinding: () => ({
      isCurrent: () => bindingCurrent,
      setMode: (mode) => { modes.push(mode); }
    }),
    refinementScheduler: {
      schedule: (run) => { scheduled = run; return run; },
      cancel: (handle) => { if (scheduled === handle) scheduled = null; }
    },
    setError: (message) => { errors.push(message); }
  }));
  return {
    controller,
    get current() { return current; },
    set current(next: ImageDocument) { current = next; preview = next; },
    get preview() { return preview; },
    get scheduled() { return scheduled; },
    set bindingCurrent(value: boolean) { bindingCurrent = value; },
    history,
    modes,
    errors,
    get documentId() { return current.id; },
    get activeLayerId() { return current.activeLayerId!; },
    get otherLayerId() { return current.layers.find(({ id }) => id !== current.activeLayerId)!.id; }
  };
};

describe('FaceWarpInteractionSessionController', () => {
  it('groups control previews into one document history entry', () => {
    const state = harness();
    expect(state.controller.beginEdit()).toBe(true);
    expect(state.controller.changeDocument((current) => ({ ...current, name: 'preview-1' }))).toBe(true);
    expect(state.controller.changeDocument((current) => ({ ...current, name: 'preview-2' }))).toBe(true);
    expect(state.controller.commitEdit()).toBe(true);
    expect(state.current.name).toBe('preview-2');
    expect(state.history).toHaveLength(1);
  });

  it('binds one gesture to its admitted layer and renderer generation', () => {
    const state = harness();
    expect(state.controller.beginGesture(state.documentId, state.activeLayerId, gesture())).toBe(true);
    expect(state.modes).toEqual(['sculpt']);
    state.current = { ...state.current, activeLayerId: state.otherLayerId };
    expect(state.controller.changeGesture(7, 'relax', (current) => current)).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.modes.at(-1)).toBe(null);
  });

  it('cancels a gesture when its opening renderer is replaced', () => {
    const state = harness();
    expect(state.controller.beginGesture(state.documentId, state.activeLayerId, gesture())).toBe(true);
    state.bindingCurrent = false;
    expect(state.controller.changeGesture(7, 'sculpt', (current) => current)).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('refuses a terminal commit after renderer replacement', () => {
    const state = harness();
    expect(state.controller.beginGesture(state.documentId, state.activeLayerId, gesture())).toBe(true);
    expect(state.controller.changeGesture(7, 'relax', (current) => ({
      ...current, name: 'preview'
    }))).toBe(true);
    state.bindingCurrent = false;
    expect(state.controller.finishGesture(7)).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('refines the latest preview before committing exactly once', () => {
    const state = harness();
    const context = gesture();
    expect(state.controller.beginGesture(state.documentId, state.activeLayerId, context)).toBe(true);
    expect(state.controller.changeGesture(7, 'sculpt', (current, active) => {
      active.latestRadius = 9;
      return { ...current, name: 'drag-preview' };
    })).toBe(true);
    expect(state.controller.finishGesture(7, (current) => ({ ...current, name: 'refined' }))).toBe(true);
    expect(state.controller.active).toBe(true);
    expect(state.history).toHaveLength(0);
    state.scheduled?.();
    expect(state.current.name).toBe('refined');
    expect(state.controller.active).toBe(false);
    expect(state.history).toHaveLength(1);
  });

  it('flushes pending refinement before history restoration', () => {
    const state = harness();
    const context = gesture();
    state.controller.beginGesture(state.documentId, state.activeLayerId, context);
    state.controller.changeGesture(7, 'sculpt', (current, active) => {
      active.latestRadius = 4;
      return { ...current, name: 'preview' };
    });
    state.controller.finishGesture(7, (current) => ({ ...current, name: 'flushed' }));
    expect(state.controller.flushPendingRefinement()).toBe(true);
    expect(state.current.name).toBe('flushed');
    expect(state.history).toHaveLength(1);
    expect(state.scheduled).toBe(null);
  });

  it('contains renderer failures and cancels the transaction', () => {
    const state = harness();
    const original = state.controller;
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => state.current,
      applySnapshot: () => undefined,
      previewSnapshot: () => undefined,
      discardPreview: () => undefined,
      pushHistoryEntry: vi.fn()
    }));
    const failing = createFaceWarpInteractionSessionController(() => ({
      getDocument: () => state.current,
      documentMutations: mutations,
      acquireRendererBinding: () => ({
        isCurrent: () => true,
        setMode: () => { throw new Error('renderer lost'); }
      }),
      refinementScheduler: { schedule: vi.fn(), cancel: vi.fn() },
      setError: (message) => { state.errors.push(message); }
    }));
    expect(failing.beginGesture(state.documentId, state.activeLayerId, gesture())).toBe(false);
    expect(failing.active).toBe(false);
    expect(state.errors).toContain('renderer lost');
    expect(original.active).toBe(false);
  });
});
