import { describe, expect, it } from 'vitest';
import { canonicalTriangleCameraFacing, facePoseYawDegrees } from './faceWarpPose';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('face-warp canonical 3D pose visibility', () => {
  it('keeps a canonical front triangle visible through scale and roll', () => {
    expect(canonicalTriangleCameraFacing(identity, 173, 155, 133)).toBe(true);
    expect(canonicalTriangleCameraFacing(
      [0, -2, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1], 173, 155, 133
    )).toBe(true);
  });

  it('rejects a surface after it turns away from the camera', () => {
    expect(canonicalTriangleCameraFacing(
      [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1], 173, 155, 133
    )).toBe(false);
  });

  it('requests a conservative fallback without valid pose', () => {
    expect(canonicalTriangleCameraFacing(undefined, 173, 155, 133)).toBeNull();
  });

  it('reads scale-independent absolute yaw from the canonical pose', () => {
    expect(facePoseYawDegrees(identity)).toBeCloseTo(0);
    const angle = Math.PI / 3;
    expect(facePoseYawDegrees([
      Math.cos(angle) * 2, 0, Math.sin(angle) * 2, 0,
      0, 2, 0, 0,
      -Math.sin(angle) * 2, 0, Math.cos(angle) * 2, 0,
      0, 0, 0, 1
    ])).toBeCloseTo(60);
  });
});
