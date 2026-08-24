import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GaussianBlurPropertiesPanel } from './GaussianBlurPropertiesPanel';

describe('GaussianBlurPropertiesPanel', () => {
  it('presents the canonical radius in the context-sensitive Properties UI', () => {
    const markup = renderToStaticMarkup(<GaussianBlurPropertiesPanel
      model={{ radius: 12.5, enabled: true }}
      commands={{
        beginAdjustment: vi.fn(),
        endAdjustment: vi.fn(),
        updateRadius: vi.fn(),
        reset: vi.fn(),
        toggleEnabled: vi.fn()
      }}
    />);
    expect(markup).toContain('Gaussian Blur properties');
    expect(markup).toContain('Radius');
    expect(markup).toContain('12.5');
  });
});
