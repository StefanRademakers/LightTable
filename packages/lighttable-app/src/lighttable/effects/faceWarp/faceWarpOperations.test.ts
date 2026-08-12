import { describe, expect, it } from 'vitest';
import { applyFaceWarpOperation } from './faceWarpOperations';
import { deformFaceMesh } from './faceWarpDeformer';
import { createDefaultFaceWarpParameters, type FaceWarpNodeSettings } from './faceWarpTypes';

const mesh = [
  { x: 0, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 },
  { x: 35, y: 40 }, { x: 65, y: 40 }, { x: 50, y: 55 },
  { x: 50, y: 75 }, { x: 50, y: 100 }
];
const face = (id: string, offset: number) => ({
  id, confidence: 1, parameters: createDefaultFaceWarpParameters(),
  landmarks: {
    mesh: mesh.map(({ x, y }) => ({ x: x + offset, y })),
    faceTop: { x: 50 + offset, y: 0 }, chin: { x: 50 + offset, y: 100 },
    leftCheek: { x: offset, y: 50 }, rightCheek: { x: 100 + offset, y: 50 },
    leftEye: { x: 35 + offset, y: 40 }, rightEye: { x: 65 + offset, y: 40 },
    noseTop: { x: 50 + offset, y: 55 }, noseTip: { x: 50 + offset, y: 55 },
    noseLeft: { x: 45 + offset, y: 55 }, noseRight: { x: 55 + offset, y: 55 },
    mouthLeft: { x: 35 + offset, y: 75 }, mouthRight: { x: 65 + offset, y: 75 },
    mouthTop: { x: 50 + offset, y: 75 }, mouthBottom: { x: 50 + offset, y: 82 }
  }
});
const triangles = [0, 1, 5, 1, 2, 5, 0, 5, 6, 2, 6, 5, 0, 6, 7, 2, 7, 6];
const settings = (): FaceWarpNodeSettings => ({
  version: 2, opacity: 1, sourceRevision: 1,
  detector: { id: 'fixture', version: '1' },
  topology: {
    id: 'fixture', vertexCount: 8, triangleIndices: triangles,
    canonicalPositions: [], canonicalUvs: []
  },
  faces: [face('left-person', 0), face('right-person', 200)]
});

describe('canonical Face Warp operations', () => {
  it('edits only the addressed face in a multi-face document', () => {
    const before = settings();
    const untouchedBefore = deformFaceMesh(before.faces[1]!, triangles);
    const after = applyFaceWarpOperation(before, {
      kind: 'set-semantic', faceId: 'left-person', target: 'left',
      change: { eyeTilt: 0.7 }
    });
    expect(after.faces[0]).not.toEqual(before.faces[0]);
    expect(after.faces[1]).toBe(before.faces[1]);
    expect(deformFaceMesh(after.faces[1]!, triangles)).toEqual(untouchedBefore);
    expect(after.faces[0]!.featureOverrides?.left?.eyeTilt).toBe(0.7);
    expect(after.faces[0]!.featureOverrides?.right?.eyeTilt).toBeUndefined();
  });

  it('fails closed when an automation addresses an unknown face', () => {
    const before = settings();
    expect(applyFaceWarpOperation(before, {
      kind: 'set-semantic', faceId: 'missing', target: 'both', change: { smile: 1 }
    })).toBe(before);
  });
});
