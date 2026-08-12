import { describe, expect, it } from 'vitest';
import {
  snapFeaturesForCanvas,
  snapFeaturesForRect,
  snapLineFeature,
  solveSnap,
  unionSnapRects
} from './snapEngine';

const moving = { x: 10, y: 20, width: 30, height: 40 };

describe('snapEngine', () => {
  it('evaluates every moving and target edge/center pairing', () => {
    const movingX = [10, 25, 40];
    const targetX = [100, 120, 140];
    const roles = ['min', 'center', 'max'] as const;
    for (const [movingIndex, source] of movingX.entries()) {
      for (const [targetIndex, target] of targetX.entries()) {
        const shift = target - source;
        const result = solveSnap({
          movingBounds: { ...moving, x: moving.x + shift - 4 },
          targets: [{
            axis: 'x',
            position: target,
            source: 'layer',
            sourceId: `target-${targetIndex}`,
            role: roles[targetIndex]
          }],
          zoom: 1
        });
        expect(result.snappedX).toBe(true);
        expect(result.offsetX).toBe(4);
        expect(result.matches[0]?.moving.role).toBe(roles[movingIndex]);
        expect(result.matches[0]?.target.role).toBe(roles[targetIndex]);
      }
    }
  });

  it('selects X and Y independently', () => {
    const result = solveSnap({
      movingBounds: { x: 93, y: 202, width: 20, height: 20 },
      targets: [
        snapLineFeature('x', 100, 'guide', 'v'),
        snapLineFeature('y', 220, 'guide', 'h')
      ],
      zoom: 1
    });
    expect(result.offsetX).toBe(-3);
    expect(result.offsetY).toBe(-2);
    expect(result.matches).toHaveLength(2);
  });

  it('keeps the perceived tolerance invariant across zoom levels', () => {
    expect(solveSnap({ movingBounds: moving, targets: [snapLineFeature('x', 18, 'guide')], zoom: 1 }).snappedX).toBe(true);
    expect(solveSnap({ movingBounds: moving, targets: [snapLineFeature('x', 12, 'guide')], zoom: 4 }).snappedX).toBe(true);
    expect(solveSnap({ movingBounds: moving, targets: [snapLineFeature('x', 12.01, 'guide')], zoom: 4 }).snappedX).toBe(false);
  });

  it('supports temporary bypass without changing settings', () => {
    const result = solveSnap({ movingBounds: moving, targets: [snapLineFeature('x', 10, 'guide')], zoom: 1, bypass: true });
    expect(result).toEqual({ offsetX: 0, offsetY: 0, snappedX: false, snappedY: false, matches: [] });
  });

  it('uses document edges but not centers for strict canvas snapping', () => {
    const features = snapFeaturesForCanvas(100, 80);
    expect(features.map((feature) => feature.position)).toEqual([0, 100, 0, 80]);
    expect(features.every((feature) => feature.role !== 'center')).toBe(true);
  });

  it('builds multi-selection union bounds', () => {
    expect(unionSnapRects([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: -5, y: 40, width: 10, height: 80 }
    ])).toEqual({ x: -5, y: 20, width: 45, height: 100 });
  });
});
