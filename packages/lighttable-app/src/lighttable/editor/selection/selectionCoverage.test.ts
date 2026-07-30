import { describe, expect, it } from 'vitest';
import { selectionCoverageBounds } from './selectionCoverage';

describe('LightTable selected-content coverage', () => {
  it('uses half of the actual peak for the gizmo and retains soft support', () => {
    const bytes = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 8, 40, 80, 40, 8, 0, 0,
      0, 8, 40, 204, 40, 8, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ]);

    expect(selectionCoverageBounds(bytes, 6, 4, 8)).toEqual({
      coreBounds: { x: 3, y: 2, width: 1, height: 1 },
      supportBounds: { x: 1, y: 1, width: 5, height: 2 },
      peakCoverage: 0.8
    });
  });

  it('returns no transform bounds for an empty selected layer', () => {
    expect(selectionCoverageBounds(new Uint8Array(16), 4, 4, 4)).toBeNull();
  });
});
