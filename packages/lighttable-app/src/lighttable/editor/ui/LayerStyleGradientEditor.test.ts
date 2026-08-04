import { describe, expect, it } from 'vitest';
import { gradientStopPosition, removableGradientStops } from './LayerStyleGradientEditor';

describe('GradientAssetEditor stop interactions', () => {
  it('maps pointer positions to a clamped gradient location', () => {
    expect(gradientStopPosition(150, 100, 200)).toBe(0.25);
    expect(gradientStopPosition(50, 100, 200)).toBe(0);
    expect(gradientStopPosition(350, 100, 200)).toBe(1);
  });

  it('deletes a selected stop without allowing fewer than two stops', () => {
    const stops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(removableGradientStops(stops, 'b')).toEqual([{ id: 'a' }, { id: 'c' }]);
    const minimum = stops.slice(0, 2);
    expect(removableGradientStops(minimum, 'a')).toBe(minimum);
  });
});
