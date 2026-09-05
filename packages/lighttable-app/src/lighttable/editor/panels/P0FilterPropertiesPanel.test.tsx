import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { P0FilterPropertiesPanel } from './P0FilterPropertiesPanel';

const commands = {
  beginAdjustment: vi.fn(), endAdjustment: vi.fn(), cancelAdjustment: vi.fn(), updateSetting: vi.fn(),
  reset: vi.fn(), toggleEnabled: vi.fn()
};

describe('P0FilterPropertiesPanel', () => {
  it('uses the same registry-driven controls for global and attached filters', () => {
    const highPass = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'high-pass', label: 'High Pass', settings: { radius: 10 }, enabled: true,
        rasterSources: [] }}
      commands={commands} />);
    expect(highPass).toContain('High Pass properties');
    expect(highPass).toContain('Radius');

    const unsharp = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'unsharp-mask', label: 'Unsharp Mask',
        settings: { amount: 100, radius: 1, threshold: 0 }, enabled: true, rasterSources: [] }}
      commands={commands} />);
    expect(unsharp).toContain('Amount');
    expect(unsharp).toContain('Radius');
    expect(unsharp).toContain('Threshold');
  });

  it('offers canonical raster layers as portable Displace maps', () => {
    const displace = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'displace', label: 'Displace', enabled: true, rasterSources: [
        { value: 'map-layer', label: 'Maps / Cloth' }
      ], settings: { horizontalScale: 10, verticalScale: 10, mapAssetId: 'map-layer',
        edgeMode: 'clamp', interpolation: 'bicubic' } }} commands={commands} />);
    expect(displace).toContain('Displacement Map');
    expect(displace).toContain('Maps / Cloth');

    const bypass = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'displace', label: 'Displace', enabled: true, rasterSources: [
        { value: 'map-layer', label: 'Maps / Cloth' }
      ], settings: { horizontalScale: 10, verticalScale: 10, mapAssetId: null,
        edgeMode: 'clamp', interpolation: 'bicubic' } }} commands={commands} />);
    expect(bypass).toContain('None (bypass)');
  });
});
