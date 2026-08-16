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
  selectedVectorStyle?: ToolOptionsProps['selectedVectorStyle'],
  marqueeStyle: ToolOptionsProps['selectionMarqueeStyle'] = 'free'
) => {
  const session = createEditorSession();
  const props: ToolOptionsProps = {
    activeTool,
    brush: session.brush,
    sampledBrush: session.sampledBrush,
    toneBrush: session.toneBrush,
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
    selectionFeather: session.selectionFeather,
    selectionAntiAlias: session.selectionAntiAlias,
    selectionMarqueeStyle: marqueeStyle,
    selectionMarqueeWidth: session.selectionMarqueeWidth,
    selectionMarqueeHeight: session.selectionMarqueeHeight,
    selectionRowHeight: rowHeight,
    selectionColumnWidth: columnWidth,
    selectionSmooth: 0,
    magicWand: session.magicWand,
    smartSelection: session.smartSelection,
    smartSelectionBackendIdentity: activeTool === 'select-object' ? {
      modelId: 'onnx-community/sam2.1-hiera-small-ONNX',
      artifactRevision: 'test',
      precision: 'fp16',
      preprocessingRevision: 'test'
    } : null,
    transformAutoSelectLayer: session.transformAutoSelectLayer,
    zoomPercent: 100,
    onBrushChange: vi.fn(),
    onSampledBrushChange: vi.fn(),
    onToneBrushChange: vi.fn(),
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
    faceWarp: {
      faces: [], selectedFaceId: null, busy: false, reviewPending: false, meshVisible: false,
      brushSize: 100, brushStrength: 0.35, semanticTarget: 'both', protectedFeature: 'eyes',
      onDetect: vi.fn(), onAcceptDetection: vi.fn(), onCancelDetection: vi.fn(),
      onSelectFace: vi.fn(), onMeshVisibleChange: vi.fn(),
      onBrushChange: vi.fn(), onSemanticTargetChange: vi.fn(),
      onProtectedFeatureChange: vi.fn(), onProtectionChange: vi.fn(),
      onParametersChange: vi.fn(), onInteractionStart: vi.fn(),
      onInteractionEnd: vi.fn(), onReset: vi.fn()
    },
    onSelectionPixelSnapChange: vi.fn(),
    onSelectionCombineModeChange: vi.fn(),
    onSelectionFeatherChange: vi.fn(),
    onSelectionAntiAliasChange: vi.fn(),
    onSelectionMarqueeStyleChange: vi.fn(),
    onSelectionMarqueeWidthChange: vi.fn(),
    onSelectionMarqueeHeightChange: vi.fn(),
    onSelectionRowHeightChange: vi.fn(),
    onSelectionColumnWidthChange: vi.fn(),
    onSelectionSmoothChange: vi.fn(),
    onMagicWandChange: vi.fn(),
    onSmartSelectionChange: vi.fn(),
    onSmartSelectionSelectSubject: vi.fn(),
    onTransformAutoSelectLayerChange: vi.fn(),
    onZoomPreset: vi.fn(),
    onZoomFit: vi.fn(),
  };
  return renderToStaticMarkup(<ToolOptionsContent {...props} />);
};

describe('Free Transform tool options', () => {
  it('keeps the Move-tool property bar focused on auto layer selection', () => {
    const markup = renderOptions('transform');
    expect(markup).toContain('Auto select layer');
    expect(markup).not.toContain('Transform reference point');
    expect(markup).not.toContain('Apply');
    expect(markup).not.toContain('Text warp preset');
  });
});

describe('brush tool options', () => {
  it('keeps Basic and GPU effect brushes in one compact preset control', () => {
    const markup = renderOptions('brush');
    expect(markup).toContain('<optgroup label="Basic">');
    expect(markup).toContain('<optgroup label="Effects">');
    expect(markup).toContain('<option value="liquify">Liquify</option>');
  });

  it('uses the shared sampled-brush controls without exposing effect engines', () => {
    for (const tool of ['clone-stamp', 'healing-brush'] as const) {
      const markup = renderOptions(tool);
      expect(markup).toContain('aria-label="Sample layers"');
      expect(markup).toContain('<option value="current">Current Layer</option>');
      expect(markup).toContain('<option value="current-and-below" selected="">Current &amp; Below</option>');
      expect(markup).toContain('<option value="all">All Layers</option>');
      expect(markup).toContain('checked=""/><span>Aligned</span>');
      if (tool === 'healing-brush') expect(markup).toContain('Diffusion');
      else expect(markup).not.toContain('Diffusion');
      if (tool === 'healing-brush') expect(markup).not.toContain('>Flow<');
      else expect(markup).toContain('>Flow<');
      expect(markup).not.toContain('<optgroup label="Effects">');
      expect(markup).not.toContain('value="liquify"');
    }
  });
});

describe('Object Selection tool options', () => {
  it('uses one selection interaction model and identifies the active inference model', () => {
    const markup = renderOptions('select-object');
    expect(markup).toContain('aria-label="Object Selection settings"');
    expect(markup).toContain('Object Finder');
    expect(markup).toContain('Sample All Layers');
    expect(markup).toContain('Refine edges');
    expect(markup).toContain('SAM 2.1 Small');
    expect(markup).toContain('Select Subject');
    expect(markup).not.toContain('Undo prompt');
    expect(markup).not.toContain('>Apply<');
  });
});

describe('vector style tool options', () => {
  it('keeps implicit Pen behavior out of the property bar', () => {
    const markup = renderOptions('vector-pen');
    expect(markup).not.toContain('aria-label="Pen settings"');
    expect(markup).not.toContain('Auto Add/Delete');
    expect(markup).not.toContain('Rubber Band');
  });

  it('keeps shared exact geometry controls behind a compact Geometry dropdown', () => {
    const rectangle = renderOptions('shape-rectangle');
    expect(rectangle).toContain('aria-label="Geometry"');
    expect(rectangle).toContain('aria-haspopup="dialog" aria-expanded="false"');
    expect(rectangle).not.toContain('aria-label="Shape geometry mode"');
    expect(rectangle).not.toContain('From center');
    expect(rectangle).not.toContain('Snap pixels');
    expect(rectangle).not.toContain('Link corners');
    expect(rectangle).not.toContain('Radius');

    const ellipse = renderOptions('shape-ellipse');
    expect(ellipse).toContain('aria-label="Geometry"');
    expect(ellipse).not.toContain('Link corners');
  });

  it('keeps line geometry and stroke geometry behind their compact dropdowns', () => {
    const markup = renderOptions('shape-line');
    expect(markup).toContain('aria-label="Geometry"');
    expect(markup).toContain('aria-label="Line Style"');
    expect(markup).toContain('<span>Weight</span>');
    expect(markup).not.toContain('aria-label="Stroke style"');
    expect(markup).not.toContain('aria-label="Arrowheads"');
    expect(markup).not.toContain('Angle');
    expect(markup).not.toContain('Arrow W');
    expect(markup).not.toContain('Arrow L');
  });

  it('keeps the Gradient Tool strip compact and separate from shape geometry', () => {
    const markup = renderOptions('gradient');
    expect(markup).toContain('aria-label="Edit gradient"');
    expect(markup).toContain('aria-label="Gradient application"');
    expect(markup).toContain('value="fill-layer"');
    expect(markup).toContain('value="pixels"');
    expect(markup).toContain('aria-label="Gradient type"');
    expect(markup).not.toContain('aria-label="Gradient interpolation"');
    expect(markup).not.toContain('>Method<');
    expect(markup).not.toContain('aria-label="Gradient blend mode"');
    expect(markup).not.toContain('aria-label="Use gradient transparency"');
    expect(markup).not.toContain('aria-label="Shape geometry"');
    expect(markup).not.toContain('Editable fill layer');
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
    expect(markup).toContain('aria-label="Fill paint"');
    expect(markup).toContain('class="gradient-field gradient-field--compact"');
    expect(markup).not.toContain('>Gradient</button>');
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
      expect(markup).toContain('background-color:#123456');
      expect(markup).toContain('background-color:#abcdef');
      expect(markup).toContain('aria-label="Line Style"');
      expect(markup).toContain('value="7"');
    }
  });

  it('keeps new-shape defaults when no vector element is selected', () => {
    const markup = renderOptions('shape-rectangle');
    const defaults = createEditorSession().vectorStyle;
    expect(markup).toContain(`background-color:${defaults.fillColor}`);
    expect(markup).toContain(`background-color:${defaults.strokeColor}`);
  });

  it('presents imported no-fill and no-stroke states with the shared None control', () => {
    const markup = renderOptions('vector-select', 1, 1, undefined, {
      fillEnabled: false, fillColor: '#000000',
      strokeEnabled: false, strokeColor: '#ffffff', strokeWidth: 3,
      strokeAlignment: 'center'
    });

    expect(markup).toContain('aria-label="Fill paint"');
    expect(markup).toContain('aria-label="Line paint"');
    expect(markup).toContain('class="none-paint-field none-paint-field--compact"');
    expect(markup).toMatch(/<button[^>]+aria-label="Line Style"[^>]+disabled=""/);
    expect(markup).not.toContain('aria-label="Fill: enabled"');
    expect(markup).not.toContain('aria-label="Line: enabled"');
  });

  it('routes native stroke geometry through the Line Style dropdown', () => {
    const markup = renderOptions('vector-select', 1, 1, undefined, {
      fillEnabled: true, fillColor: '#000000',
      strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 12,
      strokeAlignment: 'inside'
    });

    expect(markup).toContain('aria-label="Line Style"');
    expect(markup).not.toContain('aria-label="Stroke alignment"');
    expect(markup).not.toContain('aria-label="Stroke cap"');
    expect(markup).not.toContain('aria-label="Stroke join"');
    expect(markup).toContain('aria-label="Line paint"');
    expect(markup).toContain('aria-label="Open line paint"');
    expect(markup).not.toContain('<span>Line opacity</span>');
    expect(markup).not.toContain('<span>Opacity</span>');
  });
});

describe('tone brush tool options', () => {
  it('shows compact Dodge controls without duplicate paint strength controls', () => {
    const markup = renderOptions('dodge');
    expect(markup).toContain('aria-label="Tone range"');
    expect(markup).toContain('<span>Exposure</span>');
    expect(markup).toContain('Protect Tones');
    expect(markup).toContain('<span>Size</span>');
    expect(markup).toContain('<span>Hardness</span>');
    expect(markup).toContain('<span>Smooth</span>');
    expect(markup).not.toContain('<span>Opacity</span>');
  });

  it('shows Sponge mode, Flow and Vibrance', () => {
    const markup = renderOptions('sponge');
    expect(markup).toContain('aria-label="Sponge mode"');
    expect(markup).toContain('<option value="saturate" selected="">Saturate</option>');
    expect(markup).toContain('<span>Flow</span>');
    expect(markup).toContain('Vibrance');
  });
});

describe('selection strip tool options', () => {
  it('uses shared marquee controls for rectangle and ellipse without exposing pixel snap', () => {
    for (const tool of ['select-rectangle', 'select-ellipse'] as const) {
      const markup = renderOptions(tool);
      expect(markup).toContain('aria-label="Marquee selection settings"');
      expect(markup).toContain('<span>Feather</span>');
      expect(markup).toContain('aria-label="Marquee selection style"');
      expect(markup).toContain('<option value="free" selected="">Free</option>');
      expect(markup).not.toContain('Snap to pixels');
      expect(markup).not.toContain('<span>Width</span>');
      expect(markup).not.toContain('<span>Height</span>');
    }

    const ratio = renderOptions('select-rectangle', 1, 1, undefined, undefined, 'ratio');
    expect(ratio).toContain('<span>Width</span>');
    expect(ratio).toContain('<span>Height</span>');
  });

  it('surfaces every Magic Wand parameter through shared compact controls', () => {
    const markup = renderOptions('select-magic-wand');
    expect(markup).toContain('aria-label="Magic Wand settings"');
    expect(markup).toContain('aria-label="Magic Wand sample size"');
    for (const size of [1, 3, 5, 11, 31, 51, 101]) {
      expect(markup).toContain(`<option value="${size}"`);
    }
    expect(markup).toContain('<span>Tolerance</span>');
    expect(markup).toContain('value="20"');
    expect(markup).toContain('checked=""/>Anti-alias');
    expect(markup).toContain('checked=""/>Contiguous');
    expect(markup).toContain('/>Sample All Layers');
  });

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

  it('exposes the extended smoothing range for free selections', () => {
    const markup = renderOptions('select-free');
    expect(markup).toContain('Free selection');
    expect(markup).toContain('aria-label="Lasso selection settings"');
    expect(markup).toContain('Smooth');
    expect(markup).toContain('max="200"');
    expect(markup).toContain('<span>Feather</span>');
    expect(markup).toContain('checked=""/>Anti-alias');
  });

  it('shares feather and anti-alias with polygonal selections without fake smoothing', () => {
    const markup = renderOptions('select-polygonal');
    expect(markup).toContain('aria-label="Lasso selection settings"');
    expect(markup).toContain('<span>Feather</span>');
    expect(markup).toContain('checked=""/>Anti-alias');
    expect(markup).not.toContain('Smooth');
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
    expect(markup).toContain('background-color:#ff0000');
    expect(markup).toContain('aria-label="Text line"');
    expect(markup).toContain('background-color:#00ff00');
    expect(markup).toContain('value="3"');
    expect(markup).toContain('aria-label="Text layout mode"');
    expect(markup).toContain('Convert to paragraph text');
    expect(markup).toContain('<option value="center" selected="">Center</option>');
  });
});
