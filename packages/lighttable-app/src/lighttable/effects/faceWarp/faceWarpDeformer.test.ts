import { describe, expect, it } from 'vitest';
import {
  applyFaceWarpBrush,
  applyFaceWarpParameterChange,
  deformFaceMesh,
  findDeformedFaceHit,
  hitTestDeformedFace,
  relaxFaceWarpBrush,
  visibleFaceTriangleIndices
} from './faceWarpDeformer';
import { createDefaultFaceWarpParameters, type FaceWarpFace } from './faceWarpTypes';

const face = (): FaceWarpFace => {
  const mesh = [
    { x: 0, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 },
    { x: 35, y: 40 }, { x: 65, y: 40 }, { x: 50, y: 55 },
    { x: 50, y: 75 }, { x: 50, y: 100 }
  ];
  return {
    id: 'face', confidence: 1, parameters: createDefaultFaceWarpParameters(),
    landmarks: {
      mesh, faceTop: mesh[1]!, chin: mesh[7]!, leftCheek: mesh[0]!, rightCheek: mesh[2]!,
      leftEye: mesh[3]!, rightEye: mesh[4]!, noseTop: mesh[5]!, noseTip: mesh[5]!,
      noseLeft: { x: 45, y: 55 }, noseRight: { x: 55, y: 55 },
      mouthLeft: { x: 35, y: 75 }, mouthRight: { x: 65, y: 75 },
      mouthTop: mesh[6]!, mouthBottom: { x: 50, y: 82 }
    }
  };
};

describe('face warp target lattice', () => {
  const triangles = [0, 1, 5, 1, 2, 5, 0, 5, 6, 2, 6, 5, 0, 6, 7, 2, 7, 6];

  it('deforms the debug mesh for semantic controls', () => {
    const source = face();
    const target = deformFaceMesh({
      ...source, parameters: { ...source.parameters, faceWidth: 1 }
    });
    expect(target[0]?.x).toBeLessThan(source.landmarks.mesh[0]!.x);
    expect(target[2]?.x).toBeGreaterThan(source.landmarks.mesh[2]!.x);
  });

  it('stores a fold-safe semantic target instead of snapping it only at render time', () => {
    const source = face();
    const changed = applyFaceWarpParameterChange(source, triangles, { faceWidth: 1 });
    expect(changed.parameters.faceWidth).toBe(1);
    expect(changed.displacements).toHaveLength(source.landmarks.mesh.length);
    expect(deformFaceMesh(changed)).toEqual(deformFaceMesh(changed, triangles));
  });

  it('bounds semantic controls before they enter the authored mesh', () => {
    const changed = applyFaceWarpParameterChange(face(), triangles, {
      faceWidth: 4,
      eyeSize: Number.NaN
    });
    expect(changed.parameters.faceWidth).toBe(1);
    expect(changed.parameters.eyeSize).toBe(0);
  });

  it('uses compact smooth falloff for brush-authored vertex deltas', () => {
    const source = face();
    const displacements = applyFaceWarpBrush(
      source, triangles, { x: 50, y: 50 }, { x: 10, y: 0 }, 30, 1
    );
    const target = deformFaceMesh({ ...source, displacements }, triangles);
    expect(target[5]!.x).toBeGreaterThan(source.landmarks.mesh[5]!.x);
    expect(target[0]!.x).toBe(source.landmarks.mesh[0]!.x);
  });

  it('hit-tests the same target mesh used by the renderer', () => {
    const source = face();
    expect(hitTestDeformedFace(source, [0, 1, 5, 1, 2, 5], { x: 50, y: 30 })).toBe(true);
    expect(hitTestDeformedFace(source, [0, 1, 5, 1, 2, 5], { x: 50, y: 90 })).toBe(false);
  });

  it('anchors an edited target-space hit back onto the immutable source triangle', () => {
    const source = face();
    const edited = {
      ...source,
      displacements: source.landmarks.mesh.map((_, index) => index === 1 || index === 5
        ? { x: 20, y: 0 }
        : { x: 0, y: 0 })
    };
    const hit = findDeformedFaceHit(edited, [0, 1, 5], { x: 50, y: 30 });

    expect(hit).not.toBeNull();
    expect(hit!.triangle).toEqual([0, 1, 5]);
    expect(hit!.barycentric.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(hit!.sourcePoint.x).toBeLessThan(50);
  });

  it('removes far-side profile triangles using detector depth', () => {
    const profile = face();
    const mesh = [
      { x: 0, y: 0, z: -10 }, { x: 100, y: 0, z: -10 }, { x: 0, y: 100, z: -10 },
      { x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }, { x: 0, y: 100, z: 10 }
    ];
    const withDepth: FaceWarpFace = {
      ...profile,
      landmarks: { ...profile.landmarks, mesh }
    };
    expect(visibleFaceTriangleIndices(withDepth, [0, 1, 2, 3, 4, 5]))
      .toEqual([0, 1, 2]);
  });

  it('relaxes local brush constraints without touching distant strokes', () => {
    const source = {
      ...face(),
      displacements: face().landmarks.mesh.map((_, index) => index === 5 || index === 7
        ? { x: 10, y: 0 }
        : { x: 0, y: 0 })
    };
    const relaxed = relaxFaceWarpBrush(source, triangles, { x: 50, y: 50 }, 30, 1);
    expect(relaxed[5]!.x).toBeLessThan(10);
    expect(relaxed[7]!.x).toBe(10);
  });
});
