import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSession, type ToolId } from '../session/editorSession';
import { ToolOptionsContent, type ToolOptionsProps } from './ToolOptionsBar';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';

const renderOptions = (
  activeTool: ToolId,
  rowHeight = 1,
  columnWidth = 1,
  textProperties?: TextPropertyPresentation,
  selectedVectorStyle?: ToolOptionsProps['selectedVectorStyle']
) => {
  const session = createEditorSession();
  const props: ToolOptionsProps = {
    activeTool,
    brush: session.brush,
    warp: session.warp,
    vectorStyle: session.vectorStyle,
    text: session.text,
    textFonts: [{
      assetId: 'inter', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
      source: 'bundled', container: 'woff2', outline: 'truetype',
      postScriptName: 'Inter-Regular',
      embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['Inter'], styleName: 'Regular', weight: 400,
      stretch: 100, italic: false, byteLength: 10
    }],
    textProperties,
    textLayoutMode: textProperties ? 'point' : null,
    selectedVectorStyle,
    selectionPixelSnap: session.selectionPixelSnap,
    selectionCombineMode: session.selectionCombineMode,
    selectionRowHeight: rowHeight,
    selectionColumnWidth: columnWidth,
    zoomPercent: 100,
    onBrushChange: vi.fn(),
    onWarpChange: vi.fn(),
    onVectorStyleChange: vi.fn(),
    onTextChange: vi.fn(),
    onTextFontAssetChange: vi.fn(),
    onTextSizeChange: vi.fn(),
    onTextFillChange: vi.fn(),
    onTextStrokeColorChange: vi.fn(),
    onTextStrokeWidthChange: vi.fn(),
    onTextAlignmentChange: vi.fn(),
    onTextPropertyBegin: vi.fn(),
    onTextPropertyCommit: vi.fn(),
    onTextPropertyCancel: vi.fn(),
    onTextLayoutModeChange: vi.fn(),
    onSelectedVectorStyleChange: vi.fn(),
    onWarpReset: vi.fn(),
    onSelectionPixelSnapChange: vi.fn(),
    onSelectionCombineModeChange: vi.fn(),
    onSelectionRowHeightChange: vi.fn(),
    onSelectionColumnWidthChange: vi.fn(),
    onZoomPreset: vi.fn(),
    onZoomFit: vi.fn()
  };
  return renderToStaticMarkup(<ToolOptionsContent {...props} />);
};

describe('vector style tool options', () => {
  it('shows an imported selected shape style across the existing vector tool family', () => {
    const selected = {
      fillEnabled: true, fillColor: '#123456',
      strokeEnabled: true, strokeColor: '#abcdef', strokeWidth: 7,
      strokeAlignment: 'outside' as const
    };
    for (const tool of ['shape-rectangle', 'vector-select', 'vector-direct-select'] as const) {
      const markup = renderOptions(tool, 1, 1, undefined, selected);
      expect(markup).toContain('aria-label="Vector style"');
      expect(markup).toContain('value="#123456"');
      expect(markup).toContain('value="#abcdef"');
      expect(markup).toContain('value="7"');
    }
  });

  it('keeps new-shape defaults when no vector element is selected', () => {
    const markup = renderOptions('shape-rectangle');
    const defaults = createEditorSession().vectorStyle;
    expect(markup).toContain(`value="${defaults.fillColor}"`);
    expect(markup).toContain(`value="${defaults.strokeColor}"`);
  });

  it('uses the shared checkbox control for imported no-fill and no-stroke states', () => {
    const markup = renderOptions('vector-select', 1, 1, undefined, {
      fillEnabled: false, fillColor: '#000000',
      strokeEnabled: false, strokeColor: '#ffffff', strokeWidth: 3,
      strokeAlignment: 'center'
    });

    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('aria-label="Fill: enabled"');
    expect(markup).toContain('aria-label="Line: enabled"');
    expect(markup).not.toContain('paint-toggle');
    expect(markup).not.toContain('>\/</button>');
  });

  it('surfaces native inside, center and outside stroke alignment', () => {
    const markup = renderOptions('vector-select', 1, 1, undefined, {
      fillEnabled: true, fillColor: '#000000',
      strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 12,
      strokeAlignment: 'inside'
    });

    expect(markup).toContain('aria-label="Stroke alignment"');
    expect(markup).toContain('<option value="inside" selected="">Inside</option>');
    expect(markup).toContain('<option value="center">Center</option>');
    expect(markup).toContain('<option value="outside">Outside</option>');
  });
});

describe('selection strip tool options', () => {
  it('shows a pixel height for horizontal selections', () => {
    const markup = renderOptions('select-horizontal', 3, 7);
    expect(markup).toContain('Horizontal selection');
    expect(markup).toContain('<span>Height</span>');
    expect(markup).toContain('value="3"');
  });

  it('shows an independent pixel width for vertical selections', () => {
    const markup = renderOptions('select-vertical', 3, 7);
    expect(markup).toContain('Vertical selection');
    expect(markup).toContain('<span>Width</span>');
    expect(markup).toContain('value="7"');
  });
});

describe('point text tool options', () => {
  it('shows the exact shared text authoring controls with truthful capabilities', () => {
    const markup = renderOptions('text-point');
    expect(markup).toContain('Point text');
    expect(markup).toContain('<span>Font</span>');
    expect(markup).toContain('Inter');
    expect(markup).toContain('<span>Style</span>');
    expect(markup).toContain('<span>Size</span>');
    expect(markup).toContain('aria-label="Text antialias mode"');
    expect(markup).toContain('Smooth');
    expect(markup).toContain('aria-label="Text alignment"');
    expect(markup).toContain('Left');
  });

  it('shows selected-layer mixed values and fill through the shared controls', () => {
    const markup = renderOptions('text-point', 1, 1, {
      target: 'selection', family: { kind: 'value', value: 'Inter' },
      face: { kind: 'value', value: 'inter' }, size: { kind: 'mixed' },
      fillEnabled: { kind: 'value', value: true },
      fill: { kind: 'value', value: '#ff0000' }, tracking: { kind: 'value', value: 0 },
      strokeColor: { kind: 'value', value: '#00ff00' },
      strokeWidth: { kind: 'value', value: 3 },
      alignment: { kind: 'value', value: 'center' },
      lineHeight: { kind: 'value', value: { kind: 'normal' } },
      firstLineIndent: { kind: 'value', value: 0 }, startIndent: { kind: 'value', value: 0 },
      endIndent: { kind: 'value', value: 0 }, spaceBefore: { kind: 'value', value: 0 },
      spaceAfter: { kind: 'value', value: 0 },
      advancedUnavailableReason: 'Unavailable'
    });
    expect(markup).toContain('placeholder="Mixed"');
    expect(markup).toContain('value="#ff0000"');
    expect(markup).toContain('aria-label="Text line"');
    expect(markup).toContain('value="#00ff00"');
    expect(markup).toContain('value="3"');
    expect(markup).toContain('aria-label="Text layout mode"');
    expect(markup).toContain('Convert to paragraph text');
    expect(markup).toContain('<option value="center" selected="">Center</option>');
  });
});
