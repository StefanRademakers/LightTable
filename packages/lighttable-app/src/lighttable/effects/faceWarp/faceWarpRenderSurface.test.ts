import { describe, expect, it } from 'vitest';
import { createDefaultFaceWarpParameters, type FaceWarpNodeSettings } from './faceWarpTypes';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_TOPOLOGY_ID,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from './canonicalFaceTopology';
import { applyFaceWarpBrush } from './faceWarpDeformer';
import { semanticLandmarksFromMesh } from './faceWarpLandmarks';
import { buildFaceWarpRenderSurface } from './faceWarpRenderSurface';

const settings = (): FaceWarpNodeSettings => {
  const mesh = [
    { x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 70 }, { x: 30, y: 70 }
  ];
  const point = mesh[0]!;
  return {
    version: 2, opacity: 1, sourceRevision: 4,
    detector: { id: 'fixture', version: '1' },
    topology: {
      id: 'test-4', vertexCount: 4,
      triangleIndices: [0, 1, 2, 0, 2, 3],
      canonicalPositions: Array(12).fill(0),
      canonicalUvs: Array(8).fill(0)
    },
    faces: [{
      id: 'face', confidence: 1, parameters: createDefaultFaceWarpParameters(),
      displacements: [{ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
      landmarks: {
        mesh, faceTop: point, chin: point, leftCheek: point, rightCheek: point,
        leftEye: point, rightEye: point, noseTop: point, noseTip: point,
        noseLeft: point, noseRight: point, mouthLeft: point, mouthRight: point,
        mouthTop: point, mouthBottom: point
      }
    }]
  };
};

describe('face warp render cage', () => {
  it('keeps deformation local to the canonical face and its pinned collar', () => {
    const surface = buildFaceWarpRenderSurface(settings(), 100, 100);
    expect(surface.indices.length).toBeGreaterThan(6);
    expect(surface.source).not.toContainEqual({ x: 0, y: 0 });
    expect(surface.source).not.toContainEqual({ x: 100, y: 100 });
    const vertex = surface.source.findIndex(({ x, y }) => x === 30 && y === 30);
    expect(surface.target[vertex]!.x).toBeGreaterThan(30);
    const collarStart = settings().faces[0]!.landmarks.mesh.length;
    expect(surface.target.slice(collarStart)).toEqual(surface.source.slice(collarStart));
  });

  it('is exactly identity when no edit is authored', () => {
    const fixture = settings();
    const surface = buildFaceWarpRenderSurface({
      ...fixture,
      faces: fixture.faces.map((face) => ({ ...face, displacements: [] }))
    }, 100, 100);
    expect(surface.target).toEqual(surface.source);
  });

  it('keeps the pinned transition collar valid under an extreme boundary drag', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 22,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 22,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 22
    }));
    const baseFace = {
      id: 'canonical-face', confidence: 1,
      parameters: createDefaultFaceWarpParameters(),
      landmarks: semanticLandmarksFromMesh(mesh)
    };
    const displacements = applyFaceWarpBrush(
      baseFace,
      MEDIAPIPE_FACE_TRIANGLE_INDICES,
      mesh[10]!,
      { x: 500, y: -350 },
      240,
      1
    );
    const surface = buildFaceWarpRenderSurface({
      version: 2, opacity: 1, sourceRevision: 1,
      detector: { id: 'fixture', version: '1' },
      topology: {
        id: MEDIAPIPE_FACE_TOPOLOGY_ID,
        vertexCount: MEDIAPIPE_FACE_VERTEX_COUNT,
        triangleIndices: MEDIAPIPE_FACE_TRIANGLE_INDICES,
        canonicalPositions: MEDIAPIPE_FACE_CANONICAL_POSITIONS,
        canonicalUvs: MEDIAPIPE_FACE_CANONICAL_UVS
      },
      faces: [{ ...baseFace, displacements }]
    }, 640, 640);
    const area = (points: typeof surface.source, offset: number) => {
      const a = points[surface.indices[offset]!]!;
      const b = points[surface.indices[offset + 1]!]!;
      const c = points[surface.indices[offset + 2]!]!;
      return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    };
    for (let index = 0; index < surface.indices.length; index += 3) {
      const sourceArea = area(surface.source, index);
      if (Math.abs(sourceArea) < 1e-5) continue;
      expect(Math.sign(area(surface.target, index))).toBe(Math.sign(sourceArea));
    }
  });
});
