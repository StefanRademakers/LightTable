import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { gradientPreview, type GradientValue } from '@lighttable/ui';
import {
  GradientAssetEditor,
  gradientMidpointPosition,
  gradientMidpointValue,
  gradientStopPosition,
  removableGradientStops
} from './LayerStyleGradientEditor';

describe('GradientAssetEditor stop interactions', () => {
  it('previews midpoint/opacity interpolation and extends the last authored stop', () => {
    const gradient: GradientValue = {
      colorStops: [
        { id: 'a', position: 0.2, midpoint: 0.25, color: { r: 0, g: 0, b: 0, a: 1 } },
        { id: 'b', position: 0.8, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
      ],
      opacityStops: [
        { id: 'oa', position: 0, midpoint: 0.5, opacity: 0 },
        { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
      ]
    };
    const authored = structuredClone(gradient);
    const ramp = gradientPreview(gradient);
    expect(ramp).toContain('rgba(0, 0, 0, 0) 0%');
    expect(ramp).toContain('rgba(180, 180, 180, 0.5) 50%');
    expect(ramp).toContain('rgba(255, 255, 255, 1) 100%');
    expect(gradient).toEqual(authored);
  });

  it('maps pointer positions to a clamped gradient location', () => {
    expect(gradientStopPosition(150, 100, 200)).toBe(0.25);
    expect(gradientStopPosition(50, 100, 200)).toBe(0);
    expect(gradientStopPosition(350, 100, 200)).toBe(1);
  });

  it('keeps a midpoint relative to its adjacent stops', () => {
    expect(gradientMidpointPosition(0.2, 0.8, 0.25)).toBeCloseTo(0.35);
    expect(gradientMidpointValue(0.35, 0.2, 0.8)).toBeCloseTo(0.25);
    expect(gradientMidpointValue(0, 0.2, 0.8)).toBe(0.05);
    expect(gradientMidpointValue(1, 0.2, 0.8)).toBe(0.95);
  });

  it('deletes a selected stop without allowing fewer than two stops', () => {
    const stops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(removableGradientStops(stops, 'b')).toEqual([{ id: 'a' }, { id: 'c' }]);
    const minimum = stops.slice(0, 2);
    expect(removableGradientStops(minimum, 'a')).toBe(minimum);
  });

  it('keeps only canonical opacity/color controls and direct stop hit regions', () => {
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
    expect(markup).toContain('class="lighttable-style-field"');
    expect(markup).toContain('data-ui-component="slider-field"');
    expect(markup).toContain('aria-label="Gradient stop opacity"');
    expect(markup).toContain('data-layout="inline"');
    expect(markup).not.toContain('Gradient stop opacity percentage');
    expect(markup).toContain('aria-label="Add opacity stop"');
    expect(markup).toContain('aria-label="Add color stop"');
    expect(markup).not.toContain('action-button action-button--compact');
    expect(markup).not.toContain('>Color stops<');
    expect(markup).not.toContain('>Opacity stops<');
    expect(markup).toContain('aria-label="Color midpoint 50%"');
    expect(markup).toContain('aria-label="Opacity midpoint 50%"');
    expect(markup).not.toContain('>Location<');
    expect(markup).not.toContain('>Midpoint<');
  });
});
