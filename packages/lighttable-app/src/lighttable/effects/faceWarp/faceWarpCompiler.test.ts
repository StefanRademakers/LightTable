import { describe, expect, it } from 'vitest';
import { compileFaceWarpStrokes } from './faceWarpCompiler';
import { createDefaultFaceWarpParameters, type FaceWarpFace } from './faceWarpTypes';

const face = (parameters = createDefaultFaceWarpParameters()): FaceWarpFace => ({
  id: 'face-1',
  parameters,
  landmarks: {
    faceTop: { x: 100, y: 20 }, chin: { x: 100, y: 180 },
    leftCheek: { x: 40, y: 100 }, rightCheek: { x: 160, y: 100 },
    leftEye: { x: 72, y: 75 }, rightEye: { x: 128, y: 75 },
    noseTop: { x: 100, y: 75 }, noseTip: { x: 100, y: 120 },
    noseLeft: { x: 88, y: 118 }, noseRight: { x: 112, y: 118 },
    mouthLeft: { x: 75, y: 145 }, mouthRight: { x: 125, y: 145 },
    mouthTop: { x: 100, y: 140 }, mouthBottom: { x: 100, y: 153 }
  }
});

describe('compileFaceWarpStrokes', () => {
  it('does not emit runtime deformation for neutral semantic settings', () => {
    expect(compileFaceWarpStrokes([face()])).toEqual([]);
  });

  it('emits symmetric, deterministic face-width constraints', () => {
    const strokes = compileFaceWarpStrokes([face({
      ...createDefaultFaceWarpParameters(), faceWidth: 0.5
    })]);
    expect(strokes.map(({ id }) => id)).toEqual([
      'face:face-1:face-width-left', 'face:face-1:face-width-right'
    ]);
    expect(strokes[0]?.samples[0]?.deltaPx[0]).toBeLessThan(0);
    expect(strokes[1]?.samples[0]?.deltaPx[0]).toBeGreaterThan(0);
    expect(Math.abs(strokes[0]!.samples[0]!.deltaPx[0])).toBeCloseTo(
      Math.abs(strokes[1]!.samples[0]!.deltaPx[0])
    );
  });

  it('keeps independent detected faces in stable runtime order', () => {
    const parameters = { ...createDefaultFaceWarpParameters(), smile: 1 };
    const strokes = compileFaceWarpStrokes([
      face(parameters), { ...face(parameters), id: 'face-2' }
    ]);
    expect(strokes.map(({ id }) => id)).toEqual([
      'face:face-1:smile-left', 'face:face-1:smile-right',
      'face:face-2:smile-left', 'face:face-2:smile-right'
    ]);
  });
});
