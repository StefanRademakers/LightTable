import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../../editor/document/documentTypes';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { createDocumentMutationController } from '../../documents/useDocumentMutationController';
import { MEDIAPIPE_FACE_VERTEX_COUNT } from '../../../effects/faceWarp/canonicalFaceTopology';
import type { FaceWarpDetector } from '../../../effects/faceWarp/FaceWarpDetector';
import { findFaceWarpModuleInstance } from '../../../effects/faceWarp/faceWarpTypes';
import type { LayerThumbnailBlob } from '../../../editor/rendering/LayerThumbnailService';
import { FaceWarpDetectionReviewController } from './FaceWarpDetectionReviewController';

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => {
  const angle = index / MEDIAPIPE_FACE_VERTEX_COUNT * Math.PI * 2;
  return { x: 50 + Math.cos(angle) * 30, y: 50 + Math.sin(angle) * 40, z: 0 };
});
const result = {
  meshes: [mesh],
  poseMatrices: [pose],
  observations: [{
    score: 0.95,
    bounds: { x: 10, y: 5, width: 80, height: 90 },
    keypoints: [33, 263, 1, 13, 234, 454].map((index) => ({
      x: mesh[index]!.x, y: mesh[index]!.y
    }))
  }],
  detectorMemory: { beforeBytes: null, afterBytes: null, deltaBytes: null }
};

const harness = () => {
  let document: ImageDocument = createImageDocument('Face review', 100, 100, 'asset');
  let rendererGeneration = 1;
  let rendererLifecycle = {};
  const history = vi.fn();
  const status = vi.fn();
  const error = vi.fn();
  const detect = vi.fn(async () => result);
  const dispose = vi.fn();
  let resolveThumbnail: ((value: LayerThumbnailBlob) => void) | null = null;
  let rejectThumbnail: ((reason: unknown) => void) | null = null;
  let deferThumbnail = false;
  const renderer = {
    exportLayerThumbnail: vi.fn((): Promise<LayerThumbnailBlob> => deferThumbnail
      ? new Promise<LayerThumbnailBlob>((resolve, reject) => { resolveThumbnail = resolve; rejectThumbnail = reject; })
      : Promise.resolve({
        blob: new Blob(), width: 100, height: 100,
        sourceToOutput: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
      }))
  };
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: history
  }));
  let id = 0;
  const controller = new FaceWarpDetectionReviewController(() => ({
    getDocument: () => document,
    getRenderer: () => renderer,
    captureScope: () => {
      const openingGeneration = rendererGeneration;
      const openingLifecycle = rendererLifecycle;
      return { isCurrent: () => rendererGeneration === openingGeneration && rendererLifecycle === openingLifecycle };
    },
    changeDocument: mutation.change,
    createDetector: () => ({ detect, dispose } as unknown as FaceWarpDetector),
    createId: (kind) => `${kind}-${++id}`,
    setStatus: status,
    setError: error
  }));
  return {
    controller, history, status, error, detect, dispose, renderer,
    get document() { return document; },
    replaceDocument() { document = { ...document }; },
    switchLayer() { document = createRasterLayer(document, 'Other layer'); },
    replaceRenderer() { rendererGeneration += 1; },
    replaceLifecycle() { rendererLifecycle = {}; },
    deferThumbnail() { deferThumbnail = true; },
    rejectThumbnail() { rejectThumbnail?.(new Error('readback failed')); },
    resolveThumbnail() {
      resolveThumbnail?.({
        blob: new Blob(), width: 100, height: 100,
        sourceToOutput: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
      });
    }
  };
};

describe('FaceWarpDetectionReviewController', () => {
  it('rejects review acceptance after active-layer change before synchronization', async () => {
    const state = harness(); expect(await state.controller.detect()).toBe(true);
    state.switchLayer();
    expect(state.controller.accept()).toBe(false);
    expect(state.history).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenLastCalledWith(expect.stringMatching(/layer changed/));
  });
  it('reports a current readback failure but not a retired request failure', async () => {
    const current = harness(); current.deferThumbnail();
    const first = current.controller.detect(); current.rejectThumbnail();
    expect(await first).toBe(false);
    expect(current.error).toHaveBeenLastCalledWith('readback failed');
    expect(current.controller.getSnapshot().busy).toBe(false);
    const retired = harness(); retired.deferThumbnail();
    const second = retired.controller.detect(); retired.replaceLifecycle();
    retired.controller.reset(); retired.error.mockClear();
    const snapshot = retired.controller.getSnapshot(); retired.rejectThumbnail();
    expect(await second).toBe(false);
    expect(retired.error).not.toHaveBeenCalled();
    expect(retired.controller.getSnapshot()).toBe(snapshot);
  });

  it('cannot accept an equal-source review after the exact opening scope retired', async () => {
    const state = harness(); expect(await state.controller.detect()).toBe(true);
    state.replaceLifecycle();
    expect(state.controller.accept()).toBe(false);
    expect(state.history).not.toHaveBeenCalled();
    state.controller.synchronize(state.controller.getSnapshot().pending!.source);
    expect(state.controller.getSnapshot().pending).toBeNull();
  });
  it('rejects a same-renderer same-generation result from a retired lifecycle', async () => {
    const state = harness();
    state.deferThumbnail();
    const pending = state.controller.detect();
    state.replaceLifecycle();
    state.resolveThumbnail();
    expect(await pending).toBe(false);
    expect(state.detect).not.toHaveBeenCalled();
    expect(state.controller.getSnapshot().pending).toBeNull();
  });
  it('detects, reviews and accepts through one document mutation history entry', async () => {
    const state = harness();
    expect(await state.controller.detect()).toBe(true);
    expect(state.controller.getSnapshot()).toMatchObject({
      busy: false, selectedFaceId: 'face-1', meshVisible: true
    });
    expect(state.controller.accept()).toBe(true);
    expect(state.history).toHaveBeenCalledOnce();
    const layer = findRasterLayer(state.document, state.document.activeLayerId)!;
    expect(findFaceWarpModuleInstance(layer.adjustmentStack)).not.toBeNull();
  });

  it('ignores a late thumbnail after the opening document is replaced', async () => {
    const state = harness();
    state.deferThumbnail();
    const pending = state.controller.detect();
    state.replaceDocument();
    state.resolveThumbnail();
    expect(await pending).toBe(false);
    expect(state.detect).not.toHaveBeenCalled();
    expect(state.controller.getSnapshot().pending).toBeNull();
  });

  it('ignores a late thumbnail after renderer generation replacement', async () => {
    const state = harness();
    state.deferThumbnail();
    const pending = state.controller.detect();
    state.replaceRenderer();
    state.resolveThumbnail();
    expect(await pending).toBe(false);
    expect(state.detect).not.toHaveBeenCalled();
  });

  it('disposes detection ownership and rejects late publication', async () => {
    const state = harness();
    state.deferThumbnail();
    const pending = state.controller.detect();
    state.controller.dispose();
    state.resolveThumbnail();
    expect(await pending).toBe(false);
    expect(state.controller.getSnapshot().pending).toBeNull();
  });
});
