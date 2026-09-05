import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { createRasterLayer, setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_TOPOLOGY_ID,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from '../../../effects/faceWarp/canonicalFaceTopology';
import {
  createDefaultFaceWarpParameters,
  createFaceWarpModuleInstance,
  findFaceWarpModuleInstance,
  readFaceWarpNodeSettings
} from '../../../effects/faceWarp/faceWarpTypes';
import { createDocumentMutationController } from '../../documents/useDocumentMutationController';
import { executeSemanticFaceWarpCommand } from './semanticFaceWarpCommandExecutor';

const documentWithFaceWarp = () => {
  let document = createRasterLayer(createImageDocument('Portrait', 128, 128, 'fixture'));
  const layerId = document.activeLayerId!;
  const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
    x: index % 26, y: Math.floor(index / 26), z: 0
  }));
  const point = mesh[0]!;
  const instance = createFaceWarpModuleInstance('face-warp', {
    version: 2, opacity: 1, sourceRevision: 1,
    detector: { id: 'fixture', version: '1' },
    topology: { id: MEDIAPIPE_FACE_TOPOLOGY_ID, vertexCount: MEDIAPIPE_FACE_VERTEX_COUNT,
      triangleIndices: MEDIAPIPE_FACE_TRIANGLE_INDICES,
      canonicalPositions: MEDIAPIPE_FACE_CANONICAL_POSITIONS,
      canonicalUvs: MEDIAPIPE_FACE_CANONICAL_UVS },
    faces: [{ id: 'face-1', confidence: 1, parameters: createDefaultFaceWarpParameters(),
      landmarks: { mesh, faceTop: point, chin: point, leftCheek: point, rightCheek: point,
        leftEye: point, rightEye: point, noseTop: point, noseTip: point, noseLeft: point,
        noseRight: point, mouthLeft: point, mouthRight: point, mouthTop: point, mouthBottom: point } }]
  });
  document = setRasterLayerAdjustmentStack(document, layerId, {
    id: 'stack', revision: 0, modules: [instance]
  });
  return { document, layerId };
};

describe('semantic Face Warp command executor', () => {
  it('applies the same canonical operation and records exactly one history entry', () => {
    const fixture = documentWithFaceWarp();
    let current = fixture.document;
    const pushHistoryEntry = vi.fn();
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => current,
      applySnapshot: (document) => { current = document; },
      previewSnapshot: () => undefined,
      discardPreview: () => undefined,
      pushHistoryEntry
    }));
    const result = executeSemanticFaceWarpCommand({ layerId: fixture.layerId, operation: {
      kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { smile: 0.45 }
    } }, { getDocument: () => current, changeDocument: mutations.change });
    const layer = current.layers.find(({ id }) => id === fixture.layerId);
    const instance = layer?.type === 'raster' ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
    expect(result).toEqual({ layerId: fixture.layerId, faceId: 'face-1', operation: 'set-semantic' });
    expect(readFaceWarpNodeSettings(instance!).faces[0]!.parameters.smile).toBe(0.45);
    expect(pushHistoryEntry).toHaveBeenCalledOnce();
    expect(pushHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Face Warp', type: 'face-warp.operation', layerIds: [fixture.layerId]
    }));
  });
});
