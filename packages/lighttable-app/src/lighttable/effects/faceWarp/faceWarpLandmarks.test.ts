import { describe, expect, it } from 'vitest';
import { semanticLandmarksFromMesh } from './faceWarpLandmarks';

describe('semanticLandmarksFromMesh', () => {
  it('keeps the full mesh and projects stable semantic handles', () => {
    const mesh = Array.from({ length: 478 }, (_, index) => ({ x: index, y: index * 2 }));
    const landmarks = semanticLandmarksFromMesh(mesh);
    expect(landmarks.mesh).toEqual(mesh);
    expect(landmarks.faceTop).toEqual({ x: 10, y: 20 });
    expect(landmarks.chin).toEqual({ x: 152, y: 304 });
    expect(landmarks.noseLeft).toEqual({ x: 98, y: 196 });
    expect(landmarks.noseRight).toEqual({ x: 327, y: 654 });
  });

  it('rejects incomplete meshes instead of authoring corrupt geometry', () => {
    expect(() => semanticLandmarksFromMesh([{ x: 0, y: 0 }])).toThrow(/at least 468/);
  });
});
