import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TextPropertiesPanel } from './TextPropertiesPanel';

describe('contextual text properties', () => {
  it('uses the established panel and tool-option controls for mixed text properties', () => {
    const markup = renderToStaticMarkup(<TextPropertiesPanel
      model={{
        target: 'selection',
        family: { kind: 'mixed' }, face: { kind: 'mixed' },
        size: { kind: 'mixed' }, fill: { kind: 'mixed' },
        strokeColor: { kind: 'value', value: '#ffffff' },
        strokeWidth: { kind: 'value', value: 2 },
        tracking: { kind: 'value', value: 0 },
        alignment: { kind: 'value', value: 'justify' },
        lineHeight: { kind: 'value', value: { kind: 'absolute', value: 24 } },
        firstLineIndent: { kind: 'value', value: 4 }, startIndent: { kind: 'value', value: 8 },
        endIndent: { kind: 'value', value: 12 }, spaceBefore: { kind: 'value', value: 6 },
        spaceAfter: { kind: 'value', value: 10 },
        advancedUnavailableReason: 'Engine support is unavailable.'
      }}
      fonts={[]}
      onFontAsset={vi.fn()} onSize={vi.fn()} onFill={vi.fn()} onTracking={vi.fn()}
      onStrokeColor={vi.fn()} onStrokeWidth={vi.fn()}
      onParagraph={vi.fn()}
      onBegin={vi.fn()} onCommit={vi.fn()} onCancel={vi.fn()}
    />);
    expect(markup).toContain('Text properties');
    expect(markup).toContain('Selection');
    expect(markup).toContain('Mixed');
    expect(markup).toContain('aria-label="Text fill"');
    expect(markup).toContain('aria-label="Text line"');
    expect(markup).toContain('<span>Weight</span>');
    expect(markup).toContain('lighttable-tool-options__field');
    expect(markup).toContain('lighttable-tool-options__weight-field');
    expect(markup).toContain('lighttable-tool-options__color-field');
    expect(markup).not.toContain('lighttable-lens-blur__select-row');
    expect(markup).not.toContain('Advanced');
    expect(markup).toContain('Paragraph');
    expect(markup).toContain('Justify');
    expect(markup).toContain('Leading value');
  });
});
