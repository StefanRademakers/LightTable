import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { createDocumentMutationController } from '../../documents/useDocumentMutationController';
import { transformPoint } from '../../../editor/geometry/affine';
import { MEDIAPIPE_FACE_CANONICAL_POSITIONS as positions, MEDIAPIPE_FACE_CANONICAL_UVS as uvs,
  MEDIAPIPE_FACE_TRIANGLE_INDICES as triangles, MEDIAPIPE_FACE_VERTEX_COUNT as count
} from '../../../effects/faceWarp/canonicalFaceTopology';
import { semanticLandmarksFromMesh } from '../../../effects/faceWarp/faceWarpLandmarks';
import { applyFaceWarpBrush, findDeformedFaceHit } from '../../../effects/faceWarp/faceWarpDeformer';
import { createDefaultFaceWarpParameters, createFaceWarpModuleInstance, type FaceWarpFace
} from '../../../effects/faceWarp/faceWarpTypes';
import { createFaceWarpInteractionSessionController } from './FaceWarpInteractionSessionController';
import type { FaceWarpDetectionSnapshot } from './FaceWarpDetectionReviewController';
import { FaceWarpGestureIntents } from './FaceWarpGestureIntents';
import { FaceWarpPropertyIntents } from './FaceWarpPropertyIntents';
import { FaceWarpMeshPresentationBinding } from './FaceWarpMeshPresentationBinding';
import { resolveFaceWarpView } from './faceWarpView';

const harness = () => {
  const mesh = Array.from({ length: count }, (_, i) => ({
    x: 100 + positions[i * 3]! * 10, y: 100 - positions[i * 3 + 1]! * 10
  }));
  const face: FaceWarpFace = { id: 'face-a', confidence: 1,
    parameters: createDefaultFaceWarpParameters(), landmarks: semanticLandmarksFromMesh(mesh) };
  let current = createImageDocument('Face', 256, 256, 'asset');
  const layer = findRasterLayer(current, current.activeLayerId)!;
  current = setRasterLayerAdjustmentStack(current, layer.id, { id: 'stack', revision: 0, modules: [
    createFaceWarpModuleInstance('face-warp', { version: 2, opacity: 1, sourceRevision: layer.pixelRevision,
      detector: { id: 'test', version: '1' }, topology: { id: 'test', vertexCount: count,
        triangleIndices: triangles, canonicalPositions: positions, canonicalUvs: uvs },
      faces: [face, { ...face, id: 'face-b' }] })
  ] });
  current = { ...current, layers: current.layers.map(layer => ({ ...layer,
    transform: { a: 2, b: 0, c: 0, d: 2, tx: 15, ty: 10 } })) };
  let preview = current;
  let scopeCurrent = true;
  let brush = { size: 100, opacity: 0.6 };
  let review: FaceWarpDetectionSnapshot = { busy: false, pending: null,
    selectedFaceId: 'face-b', meshVisible: true };
  const history = vi.fn(); const error = vi.fn(); const modes = vi.fn();
  const mutations = createDocumentMutationController(() => ({ getDocument: () => current,
    applySnapshot: next => { current = next; preview = next; }, previewSnapshot: next => { preview = next; },
    discardPreview: () => { preview = current; }, pushHistoryEntry: history }));
  const controller = createFaceWarpInteractionSessionController(() => ({ getDocument: () => current,
    documentMutations: mutations, acquireRendererBinding: () => ({
      isCurrent: () => scopeCurrent, setMode: modes }), setError: error }));
  const detection = { getSnapshot: () => review,
    setSelectedFaceId: (selectedFaceId: string | null) => { review = { ...review, selectedFaceId }; } };
  const gesture = new FaceWarpGestureIntents(controller, detection, () => current,
    () => brush, () => scopeCurrent, error);
  const properties = new FaceWarpPropertyIntents(controller, () => ({
    document: current, selectedFaceId: review.selectedFaceId, target: 'both'
  }), () => scopeCurrent, error);
  const sourcePoint = mesh[1]!;
  expect(findDeformedFaceHit(face, triangles, sourcePoint)).not.toBeNull();
  return { controller, gesture, properties, history, error, face, sourcePoint,
    point: transformPoint(findRasterLayer(current, current.activeLayerId)!.transform, sourcePoint),
    get current() { return current; }, get preview() { return preview; },
    get review() { return review; }, set review(value: FaceWarpDetectionSnapshot) { review = value; },
    set current(value: typeof current) { current = value; preview = value; },
    setBrush: (value: typeof brush) => { brush = value; }, retire: () => { scopeCurrent = false; },
    faces: () => resolveFaceWarpView(current, review).acceptedFaces
  };
};

describe('Face Warp domain intents', () => {
  it('prioritizes the live selected face and converts transformed pointer coordinates once', () => {
    const f = harness();
    expect(f.gesture.begin(7, f.point)).toBe(true);
    expect(f.controller.gesture?.faceId).toBe('face-b');
    expect(f.controller.gesture?.startPointerSource).toEqual(f.sourcePoint);
    expect(f.history).not.toHaveBeenCalled();
    f.gesture.cancel(7);
    f.review = { ...f.review, selectedFaceId: 'face-a' };
    expect(f.gesture.begin(8, f.point)).toBe(true);
    expect(f.controller.gesture?.faceId).toBe('face-a');
  });
  it('uses live brush settings and immutable opening displacements for repeated sculpt samples', () => {
    const f = harness(); f.gesture.begin(7, f.point);
    f.gesture.move(7, { x: f.point.x + 4, y: f.point.y }, 'sculpt');
    f.setBrush({ size: 160, opacity: 0.8 });
    f.gesture.move(7, { x: f.point.x + 8, y: f.point.y }, 'sculpt');
    const context = f.controller.gesture!;
    expect(context.latestRadius).toBe(40);
    const preview = resolveFaceWarpView(f.preview, f.review).acceptedFaces[1]!;
    expect(preview.displacements).toEqual(applyFaceWarpBrush(f.face, triangles,
      context.seedSource, { x: 4, y: 0 }, 40, 0.8));
    expect(f.history).not.toHaveBeenCalled();
    expect(f.gesture.finish(7)).toBe(true);
    expect(f.history).toHaveBeenCalledOnce();
    const committed = f.current;
    f.controller.reset(); expect(f.current).toBe(committed);
    expect(f.gesture.finish(7)).toBe(false);
  });
  it.each(['relax', 'restore'] as const)('uses the existing %s mode and one terminal transaction', mode => {
    const f = harness(); f.gesture.begin(3, f.point);
    expect(f.gesture.move(3, { x: f.point.x + 5, y: f.point.y }, mode)).toBe(true);
    expect(f.controller.gesture?.mode).toBe(mode);
    expect(f.gesture.finish(3)).toBe(true);
    expect(f.history).toHaveBeenCalledOnce();
  });
  it('blocks current pending review but ignores a review belonging to another source', () => {
    const f = harness(); const view = resolveFaceWarpView(f.current, f.review);
    f.review = { ...f.review, pending: { source: view.source!, settings: view.settings! } };
    expect(f.gesture.begin(1, f.point)).toBe(false);
    expect(f.error).not.toHaveBeenCalled();
    f.review = { ...f.review, pending: { ...f.review.pending!,
      source: { ...view.source!, pixelRevision: view.source!.pixelRevision + 1 } } };
    expect(f.gesture.begin(1, f.point)).toBe(true);
  });
  it('delegates layer invalidation to the admitted controller and refuses stale callbacks', () => {
    const f = harness(); f.gesture.begin(1, f.point);
    f.current = { ...f.current, activeLayerId: null };
    expect(f.gesture.move(1, f.point, 'sculpt')).toBe(false);
    expect(f.controller.active).toBe(false);
    expect(f.history).not.toHaveBeenCalled();
    f.retire();
    expect(f.gesture.begin(2, f.point)).toBe(false);
    expect(f.gesture.finish(1)).toBe(false);
    expect(f.properties.parameters({ faceWidth: 0.5 })).toBe(false);
  });
  it('routes parameter/protection/reset through the existing property transaction', () => {
    const f = harness(); f.properties.begin();
    expect(f.properties.parameters({ faceWidth: 0.5 })).toBe(true);
    expect(f.properties.protection('eyes', true)).toBe(true);
    expect(f.history).not.toHaveBeenCalled();
    f.properties.commit(); expect(f.history).toHaveBeenCalledOnce();
    expect(f.faces()[1]!.parameters.faceWidth).toBe(0.5);
    expect(f.faces()[1]!.protection?.eyes).toBe(true);
    expect(f.properties.reset()).toBe(true);
    expect(f.faces()[1]!.parameters).toEqual(createDefaultFaceWarpParameters());
    expect(f.faces()[1]!.displacements).toEqual([]);
    expect(f.faces()[1]!.protection?.eyes).toBe(true);
  });
  it('holds the opening face throughout a slider gesture while subsequent gestures read the new selection', () => {
    const f = harness(); expect(f.properties.begin()).toBe(true);
    f.review = { ...f.review, selectedFaceId: 'face-a' };
    f.properties.parameters({ faceWidth: 0.5 }); f.properties.commit();
    expect(f.faces()[1]!.parameters.faceWidth).toBe(0.5);
    expect(f.faces()[0]!.parameters.faceWidth).toBe(0);
    f.properties.begin(); f.properties.parameters({ faceWidth: 0.25 }); f.properties.commit();
    expect(f.faces()[0]!.parameters.faceWidth).toBe(0.25);
    expect(f.history).toHaveBeenCalledTimes(2);
  });
  it('rejects late slider samples after external reset while allowing deliberate Reset/Protection', () => {
    const f = harness(); f.properties.begin(); f.properties.parameters({ faceWidth: 0.5 });
    f.controller.reset();
    expect(f.properties.parameters({ faceWidth: 0.9 })).toBe(false);
    expect(f.properties.protection('nose', true)).toBe(true);
    expect(f.properties.reset()).toBe(true);
    expect(f.properties.parameters({ faceWidth: 0.9 })).toBe(false);
    expect(f.properties.begin()).toBe(true);
    expect(f.properties.parameters({ faceWidth: 0.25 })).toBe(true);
    expect(f.properties.commit()).toBe(true);
    expect(f.faces()[1]!.parameters.faceWidth).toBe(0.25);
  });
  it('does not turn a rejected slider admission into a discrete mutation', () => {
    const f = harness(); f.gesture.begin(5, f.point);
    expect(f.properties.begin()).toBe(false);
    expect(f.properties.parameters({ faceWidth: 0.9 })).toBe(false);
    expect(f.history).not.toHaveBeenCalled();
    expect(f.controller.gesture?.pointerId).toBe(5);
    f.properties.cancel();
    expect(f.controller.gesture?.pointerId).toBe(5);
    f.gesture.cancel(5);
  });
  it('resolves a removed selected face to the same face shown in controls and rejects changed source pixels', () => {
    const f = harness(); f.review = { ...f.review, selectedFaceId: 'removed' };
    expect(resolveFaceWarpView(f.current, f.review).selectedFaceId).toBe('face-a');
    f.properties.protection('nose', true);
    expect(f.faces()[0]!.protection?.nose).toBe(true);
    f.current = { ...f.current, layers: f.current.layers.map(layer => layer.type === 'raster'
      ? { ...layer, pixelRevision: layer.pixelRevision + 1 } : layer) };
    expect(f.properties.reset()).toBe(false);
    expect(f.error).toHaveBeenCalledWith(expect.stringMatching(/pixels changed/));
  });
  it('keeps mesh output renderer-scoped, clears on tool exit and survives StrictMode replay', () => {
    const f = harness(); let current = true;
    let input = { active: true, visible: true, view: resolveFaceWarpView(f.current, f.review) };
    const renderer = { setFaceWarpEditingOverlay: vi.fn() };
    const binding = new FaceWarpMeshPresentationBinding(renderer, () => current, () => input);
    binding.mount(); expect(renderer.setFaceWarpEditingOverlay.mock.lastCall?.[0].anchors.length).toBeGreaterThan(0);
    input = { ...input, active: false }; binding.present();
    expect(renderer.setFaceWarpEditingOverlay).toHaveBeenLastCalledWith(null);
    binding.unmount(); input = { ...input, active: true }; binding.mount();
    expect(renderer.setFaceWarpEditingOverlay.mock.lastCall?.[0]).not.toBeNull();
    renderer.setFaceWarpEditingOverlay.mockClear(); current = false;
    binding.present(); binding.unmount();
    expect(renderer.setFaceWarpEditingOverlay).not.toHaveBeenCalled();
  });
});
