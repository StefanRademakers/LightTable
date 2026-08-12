import { describe, expect, it } from 'vitest';
import {
  applyFaceWarpBrush,
  applyFaceWarpFeatureChange,
  applyFaceWarpParameterChange,
  deformFaceMesh,
  findDeformedFaceHit,
  hitTestDeformedFace,
  refineFaceWarpBrush,
  relaxFaceWarpBrush,
  restoreFaceWarpBrush,
  visibleFaceTriangleIndices
} from './faceWarpDeformer';
import { createDefaultFaceWarpParameters, type FaceWarpFace } from './faceWarpTypes';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from './canonicalFaceTopology';
import { semanticLandmarksFromMesh } from './faceWarpLandmarks';

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

  it('supports linked and independent left/right feature edits', () => {
    const linked = applyFaceWarpFeatureChange(face(), triangles, 'both', { eyeTilt: 0.7 });
    const linkedTarget = deformFaceMesh(linked);
    expect(linkedTarget[3]!.y).not.toBe(face().landmarks.mesh[3]!.y);
    expect(linkedTarget[4]!.y).not.toBe(face().landmarks.mesh[4]!.y);

    const leftOnly = applyFaceWarpFeatureChange(face(), triangles, 'left', { eyeTilt: 0.7 });
    const target = deformFaceMesh(leftOnly);
    expect(target[3]!.y).not.toBe(face().landmarks.mesh[3]!.y);
    expect(target[4]!.y).toBeCloseTo(face().landmarks.mesh[4]!.y, 8);

    const relinked = applyFaceWarpFeatureChange(leftOnly, triangles, 'both', { eyeTilt: 0.2 });
    expect(relinked.featureOverrides?.left?.eyeTilt).toBeUndefined();
    expect(relinked.parameters.eyeTilt).toBe(0.2);
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

  it('refines only the transition band while preserving the pointer constraint', () => {
    const source = face();
    const preview = applyFaceWarpBrush(
      source, triangles, { x: 50, y: 50 }, { x: 12, y: -4 }, 38, 1
    );
    const refined = refineFaceWarpBrush(
      { ...source, displacements: preview }, triangles, { x: 50, y: 50 }, 38
    );
    expect(refined[5]!.x).toBeCloseTo(preview[5]!.x, 8);
    expect(refined[5]!.y).toBeCloseTo(preview[5]!.y, 8);
    expect(refined[0]).toEqual(preview[0]);
    expect(refined.some((point, index) =>
      Math.hypot(point.x - preview[index]!.x, point.y - preview[index]!.y) > 1e-6
    )).toBe(true);
    expect(refined.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('keeps opposite facial feature loops untouched during exact refinement', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 24,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 24,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 24
    }));
    const source: FaceWarpFace = {
      id: 'canonical-refinement', confidence: 1,
      parameters: createDefaultFaceWarpParameters(),
      landmarks: semanticLandmarksFromMesh(mesh)
    };
    const preview = applyFaceWarpBrush(
      source, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, { x: 9, y: -5 }, 30, 1
    );
    const refined = refineFaceWarpBrush(
      { ...source, displacements: preview }, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, 30
    );
    [362, 385, 386, 387, 263].forEach((index) => {
      expect(refined[index]!.x).toBe(0);
      expect(refined[index]!.y).toBe(0);
    });
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

  it('preserves an intended smooth displacement while relaxing local detail', () => {
    const uniform = face().landmarks.mesh.map(() => ({ x: 12, y: -5 }));
    const source = { ...face(), displacements: uniform };
    const relaxed = relaxFaceWarpBrush(source, triangles, { x: 50, y: 50 }, 45, 1);

    relaxed.forEach((point) => {
      expect(point.x).toBeCloseTo(12, 8);
      expect(point.y).toBeCloseTo(-5, 8);
    });
  });

  it('restores direct constraints locally without removing semantic controls', () => {
    const source = {
      ...face(),
      parameters: { ...face().parameters, faceWidth: 0.5 },
      displacements: face().landmarks.mesh.map(() => ({ x: 10, y: -4 }))
    };
    const restored = restoreFaceWarpBrush(source, triangles, { x: 50, y: 55 }, 18, 1);
    expect(Math.hypot(restored[5]!.x, restored[5]!.y)).toBeLessThan(0.01);
    expect(restored[0]).toEqual({ x: 10, y: -4 });
    expect(deformFaceMesh({ ...source, displacements: restored })[0]!.x)
      .not.toBe(face().landmarks.mesh[0]!.x);
  });

  it('keeps eyelid and inner-lip ordering under extreme semantic and brush edits', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 24,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 24,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 24
    }));
    const canonical: FaceWarpFace = {
      id: 'canonical', confidence: 1,
      parameters: createDefaultFaceWarpParameters(),
      landmarks: semanticLandmarksFromMesh(mesh)
    };
    const orderedPairs = [
      [160, 144], [159, 145], [158, 153], [385, 380], [386, 374], [387, 373],
      [13, 14], [82, 87], [312, 317]
    ] as const;
    const expectOrdering = (target: readonly { x: number; y: number }[]) => {
      orderedPairs.forEach(([first, second]) => {
        const sourceDelta = mesh[first]!.y - mesh[second]!.y;
        const targetDelta = target[first]!.y - target[second]!.y;
        expect(Math.sign(targetDelta)).toBe(Math.sign(sourceDelta));
        expect(Math.abs(targetDelta)).toBeGreaterThan(1e-4);
      });
    };

    const semantic = applyFaceWarpParameterChange(canonical, MEDIAPIPE_FACE_TRIANGLE_INDICES, {
      eyeSize: 1, eyeHeight: 1, mouthHeight: -1, smile: 1
    });
    expectOrdering(deformFaceMesh(semantic));

    const brushDisplacements = applyFaceWarpBrush(
      canonical, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!,
      { x: 0, y: 120 }, 75, 1, 4
    );
    expectOrdering(deformFaceMesh({ ...canonical, displacements: brushDisplacements }));
  });

  it('keeps a compact eyelid brush on its connected local feature region', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 24,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 24,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 24
    }));
    const canonical: FaceWarpFace = {
      id: 'canonical-locality', confidence: 1,
      parameters: createDefaultFaceWarpParameters(),
      landmarks: semanticLandmarksFromMesh(mesh)
    };
    const displacement = applyFaceWarpBrush(
      canonical, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!,
      { x: 8, y: -5 }, 28, 1
    );
    const leftEye = [33, 160, 159, 158, 133];
    const rightEye = [362, 385, 386, 387, 263];
    expect(leftEye.some((index) => Math.hypot(
      displacement[index]!.x, displacement[index]!.y
    ) > 0.01)).toBe(true);
    rightEye.forEach((index) => expect(Math.hypot(
      displacement[index]!.x, displacement[index]!.y
    )).toBe(0));
  });

  it('keeps protected eye vertices exact through sculpt, refine, relax and restore', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 24,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 24,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 24
    }));
    const protectedFace: FaceWarpFace = {
      id: 'protected-eyes', confidence: 1,
      parameters: createDefaultFaceWarpParameters(), protection: { eyes: true },
      landmarks: semanticLandmarksFromMesh(mesh),
      displacements: mesh.map((_, index) => index === 159 ? { x: 4, y: 3 } : { x: 0, y: 0 })
    };
    const sculpt = applyFaceWarpBrush(
      protectedFace, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, { x: 20, y: 12 }, 60, 1
    );
    const refined = refineFaceWarpBrush(
      { ...protectedFace, displacements: sculpt }, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, 60
    );
    const relaxed = relaxFaceWarpBrush(
      protectedFace, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, 60, 1
    );
    const restored = restoreFaceWarpBrush(
      protectedFace, MEDIAPIPE_FACE_TRIANGLE_INDICES, mesh[159]!, 60, 1
    );
    [sculpt, refined, relaxed, restored].forEach((result) => {
      expect(result[159]).toEqual({ x: 4, y: 3 });
      expect(result[33]).toEqual({ x: 0, y: 0 });
    });
  });

  it('keeps semantic controls and direct sculpt constraints interoperable', () => {
    const source = face();
    const sculpted = {
      ...source,
      displacements: applyFaceWarpBrush(
        source, triangles, { x: 50, y: 50 }, { x: 7, y: -3 }, 35, 0.8
      )
    };
    const combined = applyFaceWarpParameterChange(sculpted, triangles, { faceWidth: 0.5 });
    const semanticOnly = applyFaceWarpParameterChange(source, triangles, { faceWidth: 0.5 });
    expect(combined.parameters.faceWidth).toBe(0.5);
    expect(deformFaceMesh(combined)).not.toEqual(deformFaceMesh(semanticOnly));

    const continued = applyFaceWarpBrush(
      combined, triangles, { x: 50, y: 55 }, { x: -2, y: 4 }, 30, 0.6
    );
    expect(continued).not.toEqual(combined.displacements);
  });

  it('produces equivalent semantic and brush edits under scale and rotation', () => {
    const mesh = Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => ({
      x: 300 + MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3]! * 24,
      y: 320 - MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 1]! * 24,
      z: MEDIAPIPE_FACE_CANONICAL_POSITIONS[index * 3 + 2]! * 24
    }));
    const source: FaceWarpFace = {
      id: 'equivalence-source', confidence: 1,
      parameters: createDefaultFaceWarpParameters(),
      landmarks: semanticLandmarksFromMesh(mesh)
    };
    const angle = Math.PI * 0.31;
    const scale = 1.7;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const forward = ({ x, y, z }: { x: number; y: number; z?: number }) => ({
      x: 80 + scale * (x * cosine - y * sine),
      y: -35 + scale * (x * sine + y * cosine),
      z: z === undefined ? undefined : z * scale
    });
    const inverse = ({ x, y }: { x: number; y: number }) => ({
      x: ((x - 80) * cosine + (y + 35) * sine) / scale,
      y: (-(x - 80) * sine + (y + 35) * cosine) / scale
    });
    const transformedMesh = mesh.map(forward);
    const transformed: FaceWarpFace = {
      ...source,
      id: 'equivalence-transformed',
      landmarks: semanticLandmarksFromMesh(transformedMesh)
    };

    const semantic = deformFaceMesh(applyFaceWarpParameterChange(
      source, MEDIAPIPE_FACE_TRIANGLE_INDICES, { faceWidth: 0.6, smile: 0.35 }
    ));
    const transformedSemantic = deformFaceMesh(applyFaceWarpParameterChange(
      transformed, MEDIAPIPE_FACE_TRIANGLE_INDICES, { faceWidth: 0.6, smile: 0.35 }
    ));
    semantic.forEach((point, index) => {
      const restored = inverse(transformedSemantic[index]!);
      expect(restored.x).toBeCloseTo(point.x, 4);
      expect(restored.y).toBeCloseTo(point.y, 4);
    });

    const center = mesh[5]!;
    const delta = { x: 7, y: -3 };
    const brush = applyFaceWarpBrush(
      source, MEDIAPIPE_FACE_TRIANGLE_INDICES, center, delta, 42, 0.7
    );
    const transformedDelta = {
      x: scale * (delta.x * cosine - delta.y * sine),
      y: scale * (delta.x * sine + delta.y * cosine)
    };
    const transformedBrush = applyFaceWarpBrush(
      transformed, MEDIAPIPE_FACE_TRIANGLE_INDICES, forward(center),
      transformedDelta, 42 * scale, 0.7
    );
    brush.forEach((point, index) => {
      const expected = {
        x: scale * (point.x * cosine - point.y * sine),
        y: scale * (point.x * sine + point.y * cosine)
      };
      expect(transformedBrush[index]!.x).toBeCloseTo(expected.x, 3);
      expect(transformedBrush[index]!.y).toBeCloseTo(expected.y, 3);
    });
  });
});
