import { describe, expect, it } from 'vitest';
import type { AffineMatrix } from '@lighttable/vector-core';
import { transformPoint } from '../../editor/tools/transform/affine';
import { buildFaceWarpMeshOverlay } from './faceWarpMeshOverlay';
import { buildFaceWarpRenderSurface } from './faceWarpRenderSurface';
import { createDefaultFaceWarpParameters, type FaceWarpFace, type FaceWarpNodeSettings } from './faceWarpTypes';

const triangleIndices = [0, 1, 2, 0, 2, 3] as const;

const fixture = (): { face: FaceWarpFace; settings: FaceWarpNodeSettings } => {
  // Clockwise in document coordinates (positive Y points down), matching the
  // detector surface convention used by the visible-triangle selector.
  const mesh = [
    { x: 20, y: 20, z: 0 }, { x: 80, y: 20, z: 0 },
    { x: 80, y: 80, z: 0 }, { x: 20, y: 80, z: 0 }
  ];
  const point = mesh[0]!;
  const face: FaceWarpFace = {
    id: 'overlay-fixture', confidence: 1,
    parameters: createDefaultFaceWarpParameters(),
    displacements: [
      { x: 4, y: -3 }, { x: 0, y: 0 },
      { x: -2, y: 5 }, { x: 0, y: 0 }
    ],
    landmarks: {
      mesh, faceTop: point, chin: point, leftCheek: point, rightCheek: point,
      leftEye: point, rightEye: point, noseTop: point, noseTip: point,
      noseLeft: point, noseRight: point, mouthLeft: point, mouthRight: point,
      mouthTop: point, mouthBottom: point
    }
  };
  return {
    face,
    settings: {
      version: 2, opacity: 1, sourceRevision: 1,
      detector: { id: 'fixture', version: '1' },
      topology: {
        id: 'quad', vertexCount: 4, triangleIndices,
        canonicalPositions: Array(12).fill(0), canonicalUvs: Array(8).fill(0)
      },
      faces: [face]
    }
  };
};

describe('Face Warp renderer/overlay agreement', () => {
  it('uses the exact rendered target vertices for the GPU editing overlay', () => {
    const { face, settings } = fixture();
    const sourceToDocument: AffineMatrix = {
      a: 1.25, b: 0.3, c: -0.2, d: 0.9, tx: 37, ty: -11
    };
    const renderSurface = buildFaceWarpRenderSurface(settings, 100, 100);
    const overlay = buildFaceWarpMeshOverlay(
      [face], sourceToDocument, triangleIndices, face.id
    );

    // The render surface appends collar vertices after the four face vertices.
    // Every visible face anchor must therefore equal the transformed renderer
    // target exactly; screen conversion is subsequently shared by both paths.
    expect(overlay.anchors.length).toBe(4);
    overlay.anchors.forEach((anchor) => {
      const vertexIndex = Number(anchor.anchorId.split(':').at(-1));
      const expected = transformPoint(sourceToDocument, renderSurface.target[vertexIndex]!);
      expect(anchor.point.x).toBeCloseTo(expected.x, 7);
      expect(anchor.point.y).toBeCloseTo(expected.y, 7);
    });
  });
});
