import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { P0FilterPropertiesPanel } from './P0FilterPropertiesPanel';

const commands = {
  beginAdjustment: vi.fn(), endAdjustment: vi.fn(), updateSetting: vi.fn(),
  reset: vi.fn(), toggleEnabled: vi.fn()
};

describe('P0FilterPropertiesPanel', () => {
  it('uses the same registry-driven controls for global and attached filters', () => {
    const highPass = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'high-pass', label: 'High Pass', settings: { radius: 10 }, enabled: true }}
      commands={commands} />);
    expect(highPass).toContain('High Pass properties');
    expect(highPass).toContain('Radius');

    const unsharp = renderToStaticMarkup(<P0FilterPropertiesPanel
      model={{ kind: 'unsharp-mask', label: 'Unsharp Mask',
        settings: { amount: 100, radius: 1, threshold: 0 }, enabled: true }}
      commands={commands} />);
    expect(unsharp).toContain('Amount');
    expect(unsharp).toContain('Radius');
    expect(unsharp).toContain('Threshold');
  });
});
