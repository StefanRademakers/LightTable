import { describe, expect, it } from 'vitest';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_CONNECTIONS,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from './canonicalFaceTopology';

describe('canonical MediaPipe face topology', () => {
  it('contains the complete official 468-vertex, 898-triangle surface', () => {
    expect(MEDIAPIPE_FACE_VERTEX_COUNT).toBe(468);
    expect(MEDIAPIPE_FACE_TRIANGLE_INDICES).toHaveLength(898 * 3);
    expect(MEDIAPIPE_FACE_CANONICAL_POSITIONS).toHaveLength(468 * 3);
    expect(MEDIAPIPE_FACE_CANONICAL_UVS).toHaveLength(468 * 2);
    expect(new Set(MEDIAPIPE_FACE_TRIANGLE_INDICES).size).toBe(468);
    expect(MEDIAPIPE_FACE_CONNECTIONS.length).toBeGreaterThan(1_300);
  });

  it('contains only finite normalized UVs and valid indices', () => {
    expect(MEDIAPIPE_FACE_TRIANGLE_INDICES.every(
      (index) => Number.isInteger(index) && index >= 0 && index < 468
    )).toBe(true);
    expect(MEDIAPIPE_FACE_CANONICAL_UVS.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )).toBe(true);
  });
});
