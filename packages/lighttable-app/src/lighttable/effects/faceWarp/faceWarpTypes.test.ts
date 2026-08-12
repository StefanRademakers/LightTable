import { describe, expect, it } from 'vitest';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_TOPOLOGY_ID,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from './canonicalFaceTopology';
import {
  createDefaultFaceWarpParameters,
  createFaceWarpModuleInstance,
  readFaceWarpNodeSettings,
  type FaceWarpLandmarks,
  type FaceWarpNodeSettings
} from './faceWarpTypes';

const fixtureSettings = (): FaceWarpNodeSettings => {
  const mesh = Array.from({ length: 468 }, (_, index) => ({
    x: index % 26, y: Math.floor(index / 26), z: index / 468
  }));
  const point = mesh[0]!;
  const landmarks: FaceWarpLandmarks = {
    mesh, faceTop: point, chin: point, leftCheek: point, rightCheek: point,
    leftEye: point, rightEye: point, noseTop: point, noseTip: point,
    noseLeft: point, noseRight: point, mouthLeft: point, mouthRight: point,
    mouthTop: point, mouthBottom: point
  };
  return {
    version: 2, opacity: 1, sourceRevision: 7,
    detector: { id: 'mediapipe-face-landmarker', version: '1.0.1' },
    topology: {
      id: MEDIAPIPE_FACE_TOPOLOGY_ID,
      vertexCount: MEDIAPIPE_FACE_VERTEX_COUNT,
      triangleIndices: MEDIAPIPE_FACE_TRIANGLE_INDICES,
      canonicalPositions: MEDIAPIPE_FACE_CANONICAL_POSITIONS,
      canonicalUvs: MEDIAPIPE_FACE_CANONICAL_UVS
    },
    faces: [{
      id: 'face-1', confidence: 1, landmarks,
      parameters: createDefaultFaceWarpParameters(),
      poseMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    }]
  };
};

describe('Face Warp document settings', () => {
  it('round-trips source XYZ, canonical geometry and pose without detector state', () => {
    const base = fixtureSettings();
    const settings: FaceWarpNodeSettings = {
      ...base,
      faces: [{
        ...base.faces[0]!,
        featureOverrides: { left: { eyeSize: 0.35 }, right: { smile: -0.2 } }
      }]
    };
    const serialized = JSON.parse(JSON.stringify(createFaceWarpModuleInstance('face-warp', settings)));
    const restored = readFaceWarpNodeSettings(serialized);
    expect(restored).toEqual(settings);
    expect(restored.faces[0]!.landmarks.mesh[31]!.z).toBe(settings.faces[0]!.landmarks.mesh[31]!.z);
    expect(restored.topology.triangleIndices).toHaveLength(898 * 3);
  });

  it('rejects incomplete source meshes and invalid pose matrices', () => {
    const settings = fixtureSettings();
    const incomplete = createFaceWarpModuleInstance('face-warp', {
      ...settings,
      faces: [{ ...settings.faces[0]!, landmarks: {
        ...settings.faces[0]!.landmarks, mesh: settings.faces[0]!.landmarks.mesh.slice(1)
      }}]
    });
    expect(() => readFaceWarpNodeSettings(incomplete)).toThrow(/invalid/i);
    const invalidPose = createFaceWarpModuleInstance('face-warp', {
      ...settings, faces: [{ ...settings.faces[0]!, poseMatrix: [1, 0] }]
    });
    expect(() => readFaceWarpNodeSettings(invalidPose)).toThrow(/invalid/i);
  });
});
