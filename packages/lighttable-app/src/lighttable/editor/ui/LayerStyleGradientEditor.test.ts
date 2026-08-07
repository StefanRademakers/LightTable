import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  GradientAssetEditor,
  gradientStopPosition,
  removableGradientStops
} from './LayerStyleGradientEditor';

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

  it('composes canonical panel controls instead of feature-local form controls', () => {
    const markup = renderToStaticMarkup(React.createElement(GradientAssetEditor, { value: {
      id: 'gradient', name: 'Gradient', type: 'solid', smoothness: 1,
      colorStops: [
        { id: 'a', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
        { id: 'b', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
      ],
      opacityStops: [
        { id: 'oa', position: 0, midpoint: 0.5, opacity: 1 },
        { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
      ],
      roughness: 0, seed: 0
    }, onChange: vi.fn() }));
    expect(markup).toContain('action-button action-button--compact');
    expect(markup).toContain('class="lighttable-style-field"');
    expect(markup.match(/class="lighttable-adjustment"/g)).toHaveLength(5);
  });
});
