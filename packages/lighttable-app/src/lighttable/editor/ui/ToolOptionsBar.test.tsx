import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSession, type ToolId } from '../session/editorSession';
import { ToolOptionsContent, type ToolOptionsProps } from './ToolOptionsBar';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import type { TransformSessionState } from '../tools/transform/transformTypes';

const renderOptions = (
  activeTool: ToolId,
  rowHeight = 1,
  columnWidth = 1,
  textProperties?: TextPropertyPresentation,
  selectedVectorStyle?: ToolOptionsProps['selectedVectorStyle'],
  transformState?: TransformSessionState
) => {
  const session = createEditorSession();
  const props: ToolOptionsProps = {
    activeTool,
    brush: session.brush,
    gradient: session.gradient,
    shape: session.shape,
    pen: session.pen,
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
    selectedShape: null,
    selectedShapeKind: null,
    selectionPixelSnap: session.selectionPixelSnap,
    selectionCombineMode: session.selectionCombineMode,
    selectionRowHeight: rowHeight,
    selectionColumnWidth: columnWidth,
    zoomPercent: 100,
    transformState,
    onBrushChange: vi.fn(),
    onGradientChange: vi.fn(),
    onShapeChange: vi.fn(),
    onPenChange: vi.fn(),
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
    onSelectedShapeChange: vi.fn(),
    onWarpReset: vi.fn(),
    onSelectionPixelSnapChange: vi.fn(),
    onSelectionCombineModeChange: vi.fn(),
    onSelectionRowHeightChange: vi.fn(),
    onSelectionColumnWidthChange: vi.fn(),
    onZoomPreset: vi.fn(),
    onZoomFit: vi.fn(),
    onTransformChange: vi.fn(),
    onTransformCommit: vi.fn(),
    onTransformCancel: vi.fn()
  };
  return renderToStaticMarkup(<ToolOptionsContent {...props} />);
};

describe('Free Transform tool options', () => {
  it('surfaces exact semantic transform controls and apply/cancel actions', () => {
    const markup = renderOptions('transform', 1, 1, undefined, undefined, {
      layerId: 'text-1' as never,
      sourceBounds: { x: 10, y: 20, width: 100, height: 40 },
      supportBounds: { x: 10, y: 20, width: 100, height: 40 },
      sourceContentBounds: { x: 10, y: 20, width: 100, height: 40 },
      sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      projectiveQuad: null,
      sourceKind: 'layer',
      previewKind: 'semantic'
    });
    expect(markup).toContain('aria-label="Free Transform properties"');
    expect(markup).toContain('Transform reference point');
    expect(markup).toContain('<span>X</span>');
    expect(markup).toContain('<span>Y</span>');
    expect(markup).toContain('<span>W</span>');
    expect(markup).toContain('<span>H</span>');
    expect(markup).toContain('Link transform proportions');
    expect(markup).toContain('Angle');
    expect(markup).toContain('Skew X');
    expect(markup).toContain('Skew Y');
    expect(markup).toContain('Apply');
    expect(markup).toContain('Cancel');
  });
});

describe('vector style tool options', () => {
  it('surfaces Pen Auto Add/Delete and GPU Rubber Band controls', () => {
    const markup = renderOptions('vector-pen');
    expect(markup).toContain('aria-label="Pen settings"');
    expect(markup).toContain('Auto Add/Delete');
    expect(markup).toContain('Rubber Band');
  });

  it('surfaces shared exact geometry controls for rectangle and ellipse tools', () => {
    const rectangle = renderOptions('shape-rectangle');
    expect(rectangle).toContain('aria-label="Shape geometry"');
    expect(rectangle).toContain('aria-label="Shape geometry mode"');
    expect(rectangle).toContain('From center');
    expect(rectangle).toContain('Snap pixels');
    expect(rectangle).toContain('Link corners');
    expect(rectangle).toContain('Radius');

    const ellipse = renderOptions('shape-ellipse');
    expect(ellipse).toContain('aria-label="Shape geometry"');
    expect(ellipse).not.toContain('Link corners');
  });

  it('surfaces exact line geometry, style and independent arrowhead controls', () => {
    const markup = renderOptions('shape-line');
    expect(markup).toContain('aria-label="Shape geometry"');
    expect(markup).toContain('aria-label="Stroke style"');
    expect(markup).toContain('aria-label="Arrowheads"');
    expect(markup).toContain('aria-label="Start arrowhead"');
    expect(markup).toContain('aria-label="No arrowheads"');
    expect(markup).toContain('aria-label="End arrowhead"');
    expect(markup).toContain('Angle');
    expect(markup).toContain('Arrow W');
    expect(markup).toContain('Arrow L');
  });

  it('surfaces native Gradient Tool geometry and quality controls', () => {
    const markup = renderOptions('gradient');
    expect(markup).toContain('aria-label="Edit gradient"');
    expect(markup).toContain('aria-label="Gradient application"');
    expect(markup).toContain('value="fill-layer"');
    expect(markup).toContain('value="pixels"');
    expect(markup).toContain('aria-label="Gradient type"');
    expect(markup).toContain('aria-label="Gradient blend mode"');
    expect(markup).toContain('aria-label="Gradient interpolation"');
    expect(markup).toContain('aria-label="Use gradient transparency"');
  });

  it('surfaces the shared compact gradient editor entry for gradient artwork', () => {
    const markup = renderOptions('vector-select', 1, 1, undefined, {
      fillEnabled: true, fillColor: '#000000',
      fillPaint: {
        kind: 'gradient',
        asset: {
          id: 'gradient', name: 'Gradient', type: 'solid', smoothness: 1,
          colorStops: [
            { id: 'a', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
            { id: 'b', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
          ],
          opacityStops: [
            { id: 'oa', position: 0, midpoint: 0.5, opacity: 1 },
            { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
          ], roughness: 0, seed: 0
        },
        shape: 'linear', coordinateSpace: 'object-bounds',
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        reverse: false, dither: true, interpolation: 'perceptual'
      },
      strokeEnabled: false, strokeColor: '#ffffff', strokeWidth: 3,
      strokeAlignment: 'center'
    });
    expect(markup).toContain('aria-label="Edit fill gradient"');
    expect(markup).toContain('>Gradient</button>');
  });

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
    expect(markup).not.toContain('type="color" value="#000000" disabled=""');
    expect(markup).not.toContain('type="color" value="#ffffff" disabled=""');
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
    expect(markup).toContain('Type tool');
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
      kerning: { kind: 'value', value: 'metrics' },
      baselineShift: { kind: 'value', value: 0 }, horizontalScale: { kind: 'value', value: 100 },
      verticalScale: { kind: 'value', value: 100 }, syntheticBold: { kind: 'value', value: false },
      syntheticItalic: { kind: 'value', value: false }, underline: { kind: 'value', value: false },
      writingMode: { kind: 'value', value: 'horizontal-tb' },
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
