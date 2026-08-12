import { describe, expect, it } from 'vitest';
import { MEDIAPIPE_FACE_VERTEX_COUNT } from './canonicalFaceTopology';
import {
  assessFaceWarpDetection,
  faceWarpObservationAgreement,
  matchFaceWarpObservations
} from './faceWarpDetectionQuality';
import type { FaceWarpPoint } from './faceWarpTypes';

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mesh = (offsetX = 0, offsetY = 0, scale = 1): FaceWarpPoint[] =>
  Array.from({ length: MEDIAPIPE_FACE_VERTEX_COUNT }, (_, index) => {
    const angle = index / MEDIAPIPE_FACE_VERTEX_COUNT * Math.PI * 2;
    const ring = 0.65 + (index % 7) / 20;
    return {
      x: offsetX + (50 + Math.cos(angle) * 35 * ring) * scale,
      y: offsetY + (50 + Math.sin(angle) * 45 * ring) * scale,
      z: Math.cos(angle) * 4 * scale
    };
  });

describe('Face Warp detection quality', () => {
  it('accepts a finite, observed face and returns geometry confidence', () => {
    const result = assessFaceWarpDetection(mesh(), pose, 100, 100);
    expect(result.accepted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      yaw: 0,
      insideRatio: 1
    }));
    expect(result.diagnostics?.noseEyeAsymmetry).toBeGreaterThanOrEqual(0);
  });

  it('rejects incomplete, corrupt and degenerate detector output', () => {
    expect(assessFaceWarpDetection(mesh().slice(0, 100), pose, 100, 100).accepted).toBe(false);
    const corrupt = mesh();
    corrupt[30] = { x: Number.NaN, y: 40 };
    expect(assessFaceWarpDetection(corrupt, pose, 100, 100).accepted).toBe(false);
    expect(assessFaceWarpDetection(mesh(0, 0, 0.01), pose, 100, 100).accepted).toBe(false);
    expect(assessFaceWarpDetection(mesh(), pose.slice(0, 12), 100, 100).accepted).toBe(false);
  });

  it('rejects a mostly off-canvas mesh but accepts an observed edge face', () => {
    expect(assessFaceWarpDetection(mesh(90), pose, 100, 100).accepted).toBe(false);
    expect(assessFaceWarpDetection(mesh(25), pose, 100, 100).accepted).toBe(true);
  });

  it('rejects near-profile pose before presenting an unreliable editable mesh', () => {
    const angle = 75 * Math.PI / 180;
    const profilePose = [
      Math.cos(angle), 0, Math.sin(angle), 0,
      0, 1, 0, 0,
      -Math.sin(angle), 0, Math.cos(angle), 0,
      0, 0, 0, 1
    ];
    const result = assessFaceWarpDetection(mesh(), profilePose, 100, 100);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/profile/i);
  });

  it('rejects an independently inconsistent face observation', () => {
    const points = mesh();
    const matching = observation(points);
    const inconsistent = {
      ...matching,
      keypoints: matching.keypoints.map((point) => ({ x: point.x + 80, y: point.y }))
    };
    expect(assessFaceWarpDetection(points, pose, 100, 100, matching).accepted).toBe(true);
    expect(assessFaceWarpDetection(points, pose, 100, 100, inconsistent)).toMatchObject({
      accepted: false,
      confidence: 0,
      reason: expect.stringContaining('Independent face observations disagree')
    });
  });
});

const observation = (points: readonly FaceWarpPoint[], score = 0.9) => ({
  score,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  keypoints: [33, 263, 1, 13, 234, 454].map((index) => ({
    x: points[index]!.x,
    y: points[index]!.y
  }))
});

describe('independent Face Warp observation matching', () => {
  it('normalizes detector-to-landmarker agreement by observed face size', () => {
    const points = mesh();
    expect(faceWarpObservationAgreement(points, observation(points))).toBe(0);
    const shifted = observation(points);
    shifted.keypoints[0]!.x += 20;
    expect(faceWarpObservationAgreement(points, shifted)).toBeGreaterThan(0.05);
  });

  it('matches multiple observations uniquely by their keypoints', () => {
    const first = mesh();
    const second = mesh().map((point) => ({ ...point, x: point.x + 200 }));
    const firstObservation = observation(first, 0.8);
    const secondObservation = observation(second, 0.7);
    expect(matchFaceWarpObservations([second, first], [firstObservation, secondObservation]))
      .toEqual([secondObservation, firstObservation]);
  });
});
