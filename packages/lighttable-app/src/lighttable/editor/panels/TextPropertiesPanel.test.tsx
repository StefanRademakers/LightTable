import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TextPropertiesPanel } from './TextPropertiesPanel';

describe('contextual text properties', () => {
  it('shows truthful targeting, mixed fields and disabled advanced capabilities', () => {
    const markup = renderToStaticMarkup(<TextPropertiesPanel
      model={{
        target: 'selection',
        family: { kind: 'mixed' }, face: { kind: 'mixed' },
        size: { kind: 'mixed' }, fill: { kind: 'mixed' },
        tracking: { kind: 'value', value: 0 },
        advancedUnavailableReason: 'Engine support is unavailable.'
      }}
      fonts={[]}
      onFontAsset={vi.fn()} onSize={vi.fn()} onFill={vi.fn()} onTracking={vi.fn()}
      onBegin={vi.fn()} onCommit={vi.fn()} onCancel={vi.fn()}
    />);
    expect(markup).toContain('Text properties');
    expect(markup).toContain('Selection');
    expect(markup).toContain('Mixed');
    expect(markup).toContain('aria-label="Text fill"');
    expect(markup).toContain('Variable axes');
    expect(markup).toContain('Engine support is unavailable.');
  });
});
