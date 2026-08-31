import { Checkbox, SegmentedControl, Button } from '@lighttable/ui';
import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { resolveTextToolFont } from '../../application/text/pointTextCreation';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';

import type {
  BrushSettings,
  EditorSession,
  TextToolSettings,
  ToolId,
  VectorToolStyleSettings
} from '../session/editorSession';
import { WarpToolOptions } from '../../application/tools/warp/WarpToolOptions';
import { FaceWarpToolOptions, type FaceWarpToolOptionsProps } from '../../application/tools/faceWarp/FaceWarpToolOptions';
import { toolDefinition } from '../tools/toolRegistry';
import { isPaintTool, isSelectionTool } from '../tools/toolCapabilities';
import type { SelectionCombineMode } from '../selection/selectionTypes';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import type {
  SmartSelectionBackendIdentity,
  SmartSelectionPreparationState
} from '../../application/tools/smartSelection/SmartSelectionBackend';
import { MixedNumberInput } from './MixedNumberInput';
import { ToolOptionColor, ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';
import { GradientAssetEditor } from './LayerStyleGradientEditor';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import { AnchoredGradientPopover } from './AnchoredGradientPopover';
import { VectorStyleToolOptions } from './VectorStyleToolOptions';
import { GradientField } from '@lighttable/ui';

import { Select } from '@lighttable/ui';
import type { TextPaint } from '@lighttable/text-core';
import {
  BRUSH_PRESETS,
  brushPresetChange,
  resolveBrushPreset,
  type BrushPresetId
} from '../tools/brush/brushPresets';
import { MAX_STROKE_SMOOTH } from '../tools/brush/strokeSmoother';
import {
  clampHealingDiffusion,
  isSampledBrushTool
} from '../tools/paint/sampledBrushTypes';
import { isToneBrushTool } from '../tools/paint/toneBrushTypes';
import { SelectionToolOptions } from './SelectionToolOptions';

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  sampledBrush: EditorSession['sampledBrush'];
  toneBrush: EditorSession['toneBrush'];
  gradient: EditorSession['gradient'];
  shape: EditorSession['shape'];
  pen: EditorSession['pen'];
  warp: EditorSession['warp'];
  vectorStyle: VectorToolStyleSettings;
  text: TextToolSettings;
  textFonts: readonly DocumentFontAsset[];
  textProperties?: TextPropertyPresentation | null;
  textLayoutMode?: 'point' | 'paragraph' | null;
  selectedVectorStyle?: VectorToolStyleSettings | null;
  selectedShape?: EditorSession['shape'] | null;
  selectedShapeKind?: 'rectangle' | 'ellipse' | 'line' | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: SelectionCombineMode;
  selectionFeather: number;
  selectionAntiAlias: boolean;
  selectionMarqueeStyle: EditorSession['selectionMarqueeStyle'];
  selectionMarqueeWidth: number;
  selectionMarqueeHeight: number;
  selectionRowHeight: number;
  selectionColumnWidth: number;
  selectionSmooth: number;
  magicWand: EditorSession['magicWand'];
  smartSelection: EditorSession['smartSelection'];
  selectionPaintBrush: EditorSession['selectionPaintBrush'];
  smartSelectionBackendIdentity?: SmartSelectionBackendIdentity | null;
  smartSelectionPreparation?: SmartSelectionPreparationState;
  transformAutoSelectLayer: boolean;
  zoomPercent: number;
  gradientEditorRequest?: { readonly revision: number; readonly endpoint: 'start' | 'end' } | null;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onSampledBrushChange: (change: Partial<EditorSession['sampledBrush']>) => void;
  onToneBrushChange: (change: Partial<EditorSession['toneBrush']>) => void;
  onGradientChange: (change: Partial<EditorSession['gradient']>) => void;
  onShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onPenChange: (change: Partial<EditorSession['pen']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<VectorToolStyleSettings>) => void;
  onTextChange: (change: Partial<TextToolSettings>) => void;
  onTextFontAssetChange?: (assetId: string) => void;
  onTextSizeChange?: (size: number) => void;
  onTextFillChange?: (fill: string) => void;
  onTextFillPaintChange?: (fill: TextPaint) => void;
  onTextFillEnabledChange?: (enabled: boolean) => void;
  onTextStrokeColorChange?: (stroke: string) => void;
  onTextStrokeWidthChange?: (width: number) => void;
  onTextAlignmentChange?: (alignment: TextToolSettings['alignment']) => void;
  onTextWritingModeChange?: (writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => void;
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange?: (change: Partial<VectorToolStyleSettings>) => void;
  onSelectedShapeChange?: (change: Partial<EditorSession['shape']>) => void;
  onWarpReset: () => void;
  faceWarp: FaceWarpToolOptionsProps;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: SelectionCombineMode) => void;
  onSelectionFeatherChange: (radius: number) => void;
  onSelectionAntiAliasChange: (enabled: boolean) => void;
  onSelectionMarqueeStyleChange: (style: EditorSession['selectionMarqueeStyle']) => void;
  onSelectionMarqueeWidthChange: (width: number) => void;
  onSelectionMarqueeHeightChange: (height: number) => void;
  onSelectionRowHeightChange: (height: number) => void;
  onSelectionColumnWidthChange: (width: number) => void;
  onSelectionSmoothChange: (smooth: number) => void;
  onMagicWandChange: (change: Partial<EditorSession['magicWand']>) => void;
  onSmartSelectionChange: (change: Partial<EditorSession['smartSelection']>) => void;
  onSelectionPaintBrushChange: (change: Partial<EditorSession['selectionPaintBrush']>) => void;
  onSmartSelectionSelectSubject?: () => void;
  onTransformAutoSelectLayerChange: (enabled: boolean) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  warp: 'Warp',
  'face-warp': 'Face Warp',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-horizontal': 'Horizontal selection',
  'select-vertical': 'Vertical selection',
  'select-free': 'Free selection',
  'select-polygonal': 'Polygonal selection',
  'select-object': 'Object Selection',
  'select-magic-wand': 'Magic Wand',
  'select-paint-brush': 'Selection Brush',
  gradient: 'Gradient',
  fill: 'Paint bucket',
  brush: 'Brush',
  dodge: 'Dodge',
  burn: 'Burn',
  sponge: 'Sponge',
  'clone-stamp': 'Clone Stamp',
  'healing-brush': 'Healing Brush',
  erase: 'Erase',
  view: 'Move canvas',
  zoom: 'Zoom',
  'vector-select': 'Path selection',
  'vector-direct-select': 'Direct selection',
  'vector-pen': 'Pen',
  'vector-add-anchor': 'Add anchor point',
  'vector-delete-anchor': 'Delete anchor point',
  'vector-convert-anchor': 'Convert anchor point',
  'shape-rectangle': 'Rectangle',
  'shape-ellipse': 'Ellipse',
  'shape-triangle': 'Triangle',
  'shape-line': 'Line',
  'text-point': 'Type tool',
  'text-paragraph': 'Paragraph text',
  'text-vertical': 'Vertical type tool',
  'text-path': 'Path text'
};

const TextFontPicker: React.FC<{
  readonly value: string;
  readonly fonts: readonly DocumentFontAsset[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onChange: (family: string) => void;
}> = ({ value, fonts, disabled = false, placeholder, onChange }) => {
  const options = React.useMemo(() => (['bundled', 'document', 'system'] as const).flatMap(source => {
    const group = source === 'bundled' ? 'Bundled' : source === 'system' ? 'System' : 'Document';
    return [...new Set(fonts.filter(font => source === 'document'
      ? font.source !== 'bundled' && font.source !== 'system' : font.source === source)
      .flatMap(font => font.familyNames.slice(0, 1)))].map(family => ({ value: family, label: family, group }));
  }), [fonts]);
  return <label className="lighttable-tool-options__field lighttable-tool-options__font-field">
    <span>Font</span>
    <Select value={value} options={options} disabled={disabled} placeholder={placeholder} aria-label="Font"
      searchable searchPlaceholder="Search fonts" title={placeholder ?? value}
      onPointerDown={event => event.stopPropagation()} onValueChange={onChange} />
  </label>;
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
  sampledBrush,
  toneBrush,
  gradient,
  shape,
  warp,
  vectorStyle,
  text,
  textFonts,
  textProperties,
  textLayoutMode,
  selectedVectorStyle,
  selectedShape,
  selectedShapeKind,
  selectionCombineMode,
  selectionFeather,
  selectionAntiAlias,
  selectionMarqueeStyle,
  selectionMarqueeWidth,
  selectionMarqueeHeight,
  selectionRowHeight,
  selectionColumnWidth,
  selectionSmooth,
  magicWand,
  smartSelection,
  smartSelectionBackendIdentity,
  smartSelectionPreparation = { phase: 'idle' },
  transformAutoSelectLayer,
  zoomPercent,
  gradientEditorRequest,
  onBrushChange,
  onSampledBrushChange,
  onToneBrushChange,
  onGradientChange,
  onShapeChange,
  onWarpChange,
  onVectorStyleChange,
  onTextChange,
  onTextFontAssetChange,
  onTextSizeChange,
  onTextFillChange,
  onTextFillPaintChange,
  onTextFillEnabledChange,
  onTextStrokeColorChange,
  onTextStrokeWidthChange,
  onTextAlignmentChange,
  onTextWritingModeChange,
  onTextPropertyBegin,
  onTextPropertyCommit,
  onTextPropertyCancel,
  onTextLayoutModeChange,
  onSelectedVectorStyleChange,
  onSelectedShapeChange,
  onWarpReset,
  faceWarp,
  onSelectionCombineModeChange,
  onSelectionFeatherChange,
  onSelectionAntiAliasChange,
  onSelectionMarqueeStyleChange,
  onSelectionMarqueeWidthChange,
  onSelectionMarqueeHeightChange,
  onSelectionRowHeightChange,
  onSelectionColumnWidthChange,
  onSelectionSmoothChange,
  onMagicWandChange,
  onSmartSelectionChange,
  selectionPaintBrush,
  onSelectionPaintBrushChange,
  onSmartSelectionSelectSubject,
  onTransformAutoSelectLayerChange,
  onZoomPreset,
  onZoomFit,
  orientation = 'horizontal'
}) => {
  const adjustmentLayout = orientation === 'vertical' ? 'tool-panel' : 'tool-bar';
  const activeToolDefinition = toolDefinition(activeTool);
  const vectorStyleToolActive = activeTool.startsWith('vector-') || activeTool.startsWith('shape-');
  const editsVectorSelection = vectorStyleToolActive && Boolean(selectedVectorStyle);
  const presentedVectorStyle = editsVectorSelection ? selectedVectorStyle! : vectorStyle;
  const presentedShape = selectedShape ?? shape;
  const changeShape = selectedShape && onSelectedShapeChange
    ? onSelectedShapeChange : onShapeChange;
  const shapeGeometryActive = activeTool === 'shape-rectangle'
    || activeTool === 'shape-ellipse'
    || activeTool === 'shape-line'
    || (activeTool !== 'gradient' && Boolean(selectedShapeKind));
  const rectangleGeometryActive = selectedShapeKind
    ? selectedShapeKind === 'rectangle' : activeTool === 'shape-rectangle';
  const [shapeGeometryOpen, setShapeGeometryOpen] = React.useState(false);
  const shapeGeometryAnchorRef = React.useRef<HTMLButtonElement>(null);
  const [gradientEditorOpen, setGradientEditorOpen] = React.useState(false);
  const gradientButtonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (gradientEditorRequest) setGradientEditorOpen(true);
  }, [gradientEditorRequest]);
  const presentedTextGradient = textProperties?.fillPaint?.kind === 'value'
    && textProperties.fillPaint.value?.kind === 'gradient'
    ? textProperties.fillPaint.value : null;
  const [textGradientEditorOpen, setTextGradientEditorOpen] = React.useState(false);
  const textGradientButtonRef = React.useRef<HTMLButtonElement>(null);
  const changeVectorStyle = editsVectorSelection
    ? onSelectedVectorStyleChange ?? onVectorStyleChange
    : onVectorStyleChange;
  const presentedTextFamily = textProperties?.family.kind === 'value'
    ? textProperties.family.value : text.family;

  return (
    <div
      className={`lighttable-tool-options__content lighttable-tool-options__content--${orientation}`}
    >
      <div className="lighttable-tool-options__identity">
        <img src={lightTableIcon(activeToolDefinition.iconName)} alt="" aria-hidden="true" />
        <strong>{activeTool === 'warp'
          ? `Warp - ${warp.mode === 'twirl-cw'
            ? 'Twirl clockwise'
            : warp.mode === 'twirl-ccw'
              ? 'Twirl counter-clockwise'
              : warp.mode[0]!.toUpperCase() + warp.mode.slice(1)}`
          : TOOL_LABELS[activeTool]}</strong>
      </div>
      {isSelectionTool(activeTool) ? (
        <SegmentedControl
          className="lighttable-tool-options__selection-mode"
          label="Selection combine mode"
          value={activeTool === 'select-paint-brush'
            ? selectionCombineMode === 'subtract' ? 'subtract' : 'add'
            : selectionCombineMode}
          onChange={onSelectionCombineModeChange}
          options={activeTool === 'select-paint-brush' ? [
            { value: 'add', label: 'Add', title: 'Add to selection' },
            { value: 'subtract', label: 'Subtract', title: 'Subtract from selection' }
          ] : [
            { value: 'replace', label: 'New', title: 'New selection' },
            { value: 'add', label: 'Add', title: 'Add to selection' },
            { value: 'subtract', label: 'Subtract', title: 'Subtract from selection' },
            { value: 'intersect', label: 'Intersect', title: 'Intersect with selection' }
          ]}
        />
      ) : null}
      {activeTool === 'select-paint-brush' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Selection Brush settings">
          <AdjustmentSlider
            layout={adjustmentLayout}
            label="Size"
            value={selectionPaintBrush.size}
            min={1}
            max={1000}
            resetValue={48}
            onReset={() => onSelectionPaintBrushChange({ size: 48 })}
            onChange={(size) => onSelectionPaintBrushChange({ size })}
          />
          <AdjustmentSlider
            layout={adjustmentLayout}
            label="Hardness"
            value={selectionPaintBrush.hardness * 100}
            min={0}
            max={100}
            resetValue={75}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onSelectionPaintBrushChange({ hardness: 0.75 })}
            onChange={(value) => onSelectionPaintBrushChange({ hardness: value / 100 })}
          />
          <AdjustmentSlider
            layout={adjustmentLayout}
            label="Opacity"
            value={selectionPaintBrush.opacity * 100}
            min={1}
            max={100}
            resetValue={100}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onSelectionPaintBrushChange({ opacity: 1 })}
            onChange={(value) => onSelectionPaintBrushChange({ opacity: value / 100 })}
          />
          <ToolOptionColor
            label="Overlay"
            value={selectionPaintBrush.overlayColor}
            onChange={(overlayColor) => onSelectionPaintBrushChange({ overlayColor })}
          />
        </div>
      ) : null}
      {activeTool === 'transform' ? (
        <label className="lighttable-tool-options__toggle">
          <Checkbox  checked={transformAutoSelectLayer}
            onChange={(event) => onTransformAutoSelectLayerChange(event.currentTarget.checked)} />
          <span>Auto select layer</span>
        </label>
      ) : null}
      <SelectionToolOptions
        adjustmentLayout={adjustmentLayout}
        activeTool={activeTool}
        feather={selectionFeather}
        antiAlias={selectionAntiAlias}
        marqueeStyle={selectionMarqueeStyle}
        marqueeWidth={selectionMarqueeWidth}
        marqueeHeight={selectionMarqueeHeight}
        rowHeight={selectionRowHeight}
        columnWidth={selectionColumnWidth}
        smooth={selectionSmooth}
        onFeatherChange={onSelectionFeatherChange}
        onAntiAliasChange={onSelectionAntiAliasChange}
        onMarqueeStyleChange={onSelectionMarqueeStyleChange}
        onMarqueeWidthChange={onSelectionMarqueeWidthChange}
        onMarqueeHeightChange={onSelectionMarqueeHeightChange}
        onRowHeightChange={onSelectionRowHeightChange}
        onColumnWidthChange={onSelectionColumnWidthChange}
        onSmoothChange={onSelectionSmoothChange}
      />
      {activeTool === 'select-magic-wand' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Magic Wand settings">
          <ToolOptionSelect
            label="Sample size"
            value={magicWand.sampleSize}
            aria-label="Magic Wand sample size"
            onValueChange={(nextValue) => onMagicWandChange({
              sampleSize: Number(nextValue) as EditorSession['magicWand']['sampleSize']
            })}
          >
            <option value={1}>Point Sample</option>
            <option value={3}>3 by 3 Average</option>
            <option value={5}>5 by 5 Average</option>
            <option value={11}>11 by 11 Average</option>
            <option value={31}>31 by 31 Average</option>
            <option value={51}>51 by 51 Average</option>
            <option value={101}>101 by 101 Average</option>
          </ToolOptionSelect>
          <ToolOptionNumber
            label="Tolerance"
            value={magicWand.tolerance}
            min={0}
            max={255}
            step={1}
            onChange={(tolerance) => onMagicWandChange({
              tolerance: Math.max(0, Math.min(255, Math.round(tolerance || 0)))
            })}
          />
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={magicWand.antiAlias}
              onChange={(event) => onMagicWandChange({ antiAlias: event.currentTarget.checked })} />
            Anti-alias
          </label>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={magicWand.contiguous}
              onChange={(event) => onMagicWandChange({ contiguous: event.currentTarget.checked })} />
            Contiguous
          </label>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={magicWand.sampleAllLayers}
              onChange={(event) => onMagicWandChange({ sampleAllLayers: event.currentTarget.checked })} />
            Sample All Layers
          </label>
        </div>
      ) : null}
      {activeTool === 'select-object' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Object Selection settings">
          {smartSelectionPreparation.phase === 'preparing' ? (
            <span className="lighttable-tool-options__hint" role="status">
              {smartSelectionPreparation.message}
              {smartSelectionPreparation.progress === undefined
                ? ''
                : ` ${Math.round(smartSelectionPreparation.progress)}%`}
            </span>
          ) : smartSelectionPreparation.phase === 'error' ? (
            <span className="lighttable-tool-options__hint" role="status">
              {smartSelectionPreparation.message}
            </span>
          ) : <>
          <ToolOptionSelect
            label="Mode"
            value={smartSelection.mode}
            aria-label="Object Selection mode"
            onValueChange={(nextValue) => onSmartSelectionChange({
              mode: nextValue as EditorSession['smartSelection']['mode']
            })}
          >
            <option value="object-finder">Object Finder</option>
            <option value="rectangle">Rectangle</option>
            <option value="lasso">Lasso</option>
          </ToolOptionSelect>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={smartSelection.sampleAllLayers}
              onChange={(event) => onSmartSelectionChange({
                sampleAllLayers: event.currentTarget.checked
              })} />
            Sample All Layers
          </label>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={smartSelection.refineEdges}
              onChange={(event) => onSmartSelectionChange({ refineEdges: event.currentTarget.checked })} />
            Refine edges
          </label>
          {smartSelection.refineEdges ? (
            <ToolOptionSelect label="Quality" value={smartSelection.refinementQuality}
              aria-label="Edge refinement quality"
              onValueChange={(nextValue) => onSmartSelectionChange({
                refinementQuality: nextValue as EditorSession['smartSelection']['refinementQuality']
              })}>
              <option value="fast">Fast</option>
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </ToolOptionSelect>
          ) : null}
          <Button onClick={onSmartSelectionSelectSubject}>Select Subject</Button>
          {smartSelectionBackendIdentity ? (
            <span className="lighttable-tool-options__hint"
              title={`${smartSelectionBackendIdentity.modelId} @ ${smartSelectionBackendIdentity.artifactRevision}`}>
              {smartSelectionBackendIdentity.modelId.includes('sam2.1-hiera-small')
                ? 'SAM 2.1 Small'
                : smartSelectionBackendIdentity.modelId.includes('slimsam')
                  ? 'SlimSAM'
                  : smartSelectionBackendIdentity.modelId.split('/').at(-1)}
              {' \u00b7 '}{smartSelectionBackendIdentity.precision.toUpperCase()}
            </span>
          ) : null}
          </>}
        </div>
      ) : null}
      {activeTool === 'gradient' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Gradient settings">
          <ToolOptionSelect label="Apply" value={gradient.application}
            aria-label="Gradient application"
            onValueChange={(nextValue) => onGradientChange({
              application: nextValue as EditorSession['gradient']['application']
            })}>
            <option value="fill-layer">Fill layer</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <GradientField
            ref={gradientButtonRef}
            value={gradient.paint.asset}
            ariaLabel="Edit gradient"
            title="Edit gradient"
            expanded={gradientEditorOpen}
            onClick={() => setGradientEditorOpen((open) => !open)}
          />
          {gradientEditorOpen ? (
            <AnchoredGradientPopover anchor={gradientButtonRef} ariaLabel="Gradient editor">
              <div className="lighttable-tool-options__gradient-header">
                <strong>Gradient</strong>
                <ButtonBase type="button" aria-label="Close gradient"
                  onClick={() => setGradientEditorOpen(false)}>×</ButtonBase>
              </div>
              <GradientAssetEditor
                key={gradientEditorRequest?.revision ?? 'toolbar'}
                value={gradient.paint.asset}
                initialColorStop={gradientEditorRequest
                  && (gradientEditorRequest.endpoint === 'end') !== gradient.paint.reverse
                  ? 'last'
                  : 'first'}
                onChange={(asset) => onGradientChange({
                  paint: { ...gradient.paint, asset }
                })}
              />
            </AnchoredGradientPopover>
          ) : null}
          <ToolOptionSelect label="Type" value={gradient.paint.shape}
            aria-label="Gradient type"
            onValueChange={(nextValue) => onGradientChange({ paint: {
              ...gradient.paint,
              shape: nextValue as GradientPaintInstance['shape']
            } })}>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="angle">Angle</option>
            <option value="reflected">Reflected</option>
            <option value="diamond">Diamond</option>
          </ToolOptionSelect>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={gradient.paint.reverse}
              aria-label="Reverse gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, reverse: event.currentTarget.checked
              } })} />
            <span>Reverse</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={gradient.paint.dither}
              aria-label="Dither gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, dither: event.currentTarget.checked
              } })} />
            <span>Dither</span>
          </label>
        </div>
      ) : null}
      {shapeGeometryActive ? (
        <>
        <ButtonBase ref={shapeGeometryAnchorRef} type="button"
          className="lighttable-tool-options__dropdown-trigger"
          aria-label="Geometry" aria-haspopup="dialog" aria-expanded={shapeGeometryOpen}
          onClick={() => setShapeGeometryOpen((open) => !open)}>
          <span>Geometry</span><span className="paint-field__arrow" aria-hidden="true" />
        </ButtonBase>
        {shapeGeometryOpen ? <AnchoredGradientPopover anchor={shapeGeometryAnchorRef}
          ariaLabel="Geometry options" className="lighttable-tool-options__geometry-popover"
          onClose={() => setShapeGeometryOpen(false)}>
          <div className="lighttable-tool-options__gradient-header">
            <strong>Geometry</strong>
            <ButtonBase type="button" aria-label="Close geometry"
              onClick={() => setShapeGeometryOpen(false)}>×</ButtonBase>
          </div>
        <div className="lighttable-tool-options__shape-geometry-options" aria-label="Shape geometry">
          <ToolOptionSelect label="Mode" value={shape.mode}
            aria-label="Shape application mode"
            onValueChange={(nextValue) => onShapeChange({
              mode: nextValue as EditorSession['shape']['mode']
            })}>
            <option value="shape">Shape</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <ToolOptionSelect label="Geometry" value={presentedShape.geometry}
            aria-label="Shape geometry mode"
            onValueChange={(nextValue) => changeShape({
              geometry: nextValue as EditorSession['shape']['geometry']
            })}>
            <option value="unrestricted">Unrestricted</option>
            <option value="fixed">Fixed size</option>
            <option value="proportional">Proportional</option>
          </ToolOptionSelect>
          <ToolOptionNumber label="W" unit="px" min={0.01} max={100000} step={1}
            value={presentedShape.width}
            onChange={(width) => changeShape({ width: Math.max(0.01, width || 0.01) })} />
          <ToolOptionNumber label="H" unit="px" min={0.01} max={100000} step={1}
            value={presentedShape.height}
            onChange={(height) => changeShape({ height: Math.max(0.01, height || 0.01) })} />
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={presentedShape.fromCenter}
              onChange={(event) => changeShape({ fromCenter: event.currentTarget.checked })} />
            <span>From center</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <Checkbox  checked={presentedShape.snapToPixels}
              onChange={(event) => changeShape({ snapToPixels: event.currentTarget.checked })} />
            <span>Snap pixels</span>
          </label>
          {rectangleGeometryActive ? (
            <>
              <label className="lighttable-tool-options__toggle">
                <Checkbox  checked={presentedShape.linkedCorners}
                  aria-label="Link rectangle corners"
                  onChange={(event) => changeShape({ linkedCorners: event.currentTarget.checked })} />
                <span>Link corners</span>
              </label>
              {presentedShape.rectangleCornerRadii.map((radius, index) => presentedShape.linkedCorners && index > 0 ? null : (
                <ToolOptionNumber key={index} label={presentedShape.linkedCorners ? 'Radius' : `R${index + 1}`}
                  unit="px" min={0} max={100000} step={1} value={radius}
                  onChange={(value) => {
                    const next = Math.max(0, value || 0);
                    changeShape({ rectangleCornerRadii: presentedShape.linkedCorners
                      ? [next, next, next, next]
                      : presentedShape.rectangleCornerRadii.map((current, corner) => (
                          corner === index ? next : current
                        )) as [number, number, number, number] });
                  }} />
              ))}
            </>
          ) : null}
          {(selectedShapeKind ? selectedShapeKind === 'line' : activeTool === 'shape-line') ? (
            <>
              <ToolOptionNumber label="Angle" unit="deg" min={-360} max={360} step={1}
                value={presentedShape.lineRotationDegrees}
                onChange={(lineRotationDegrees) => changeShape({ lineRotationDegrees })} />
              <div className="lighttable-tool-options__line-ends" role="group" aria-label="Arrowheads">
                <ButtonBase type="button" aria-label="Start arrowhead"
                  aria-pressed={presentedShape.lineStartArrow}
                  onClick={() => changeShape({ lineStartArrow: !presentedShape.lineStartArrow })}>
                  <img src={lightTableIcon('arrow-left.png')} alt="" aria-hidden />
                </ButtonBase>
                <ButtonBase type="button" aria-label="No arrowheads"
                  aria-pressed={!presentedShape.lineStartArrow && !presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineStartArrow: false, lineEndArrow: false })}>
                  <img src={lightTableIcon('horizontal-line.png')} alt="" aria-hidden />
                </ButtonBase>
                <ButtonBase type="button" aria-label="End arrowhead"
                  aria-pressed={presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineEndArrow: !presentedShape.lineEndArrow })}>
                  <img src={lightTableIcon('arrow-right.png')} alt="" aria-hidden />
                </ButtonBase>
              </div>
              <ToolOptionNumber label="Arrow W" unit="px" min={0} max={10000} step={1}
                value={presentedShape.lineArrowWidth}
                onChange={(lineArrowWidth) => changeShape({ lineArrowWidth: Math.max(0, lineArrowWidth) })} />
              <ToolOptionNumber label="Arrow L" unit="px" min={0} max={10000} step={1}
                value={presentedShape.lineArrowLength}
                onChange={(lineArrowLength) => changeShape({ lineArrowLength: Math.max(0, lineArrowLength) })} />
            </>
          ) : null}
        </div>
        </AnchoredGradientPopover> : null}
        </>
      ) : null}
      {activeTool === 'zoom' ? (
        <div className="lighttable-tool-options__zoom-presets" aria-label="Zoom presets">
          {ZOOM_PRESETS_PERCENT.map((percent) => (
            <Button
              key={percent}
              type="button"
              aria-pressed={Math.abs(zoomPercent - percent) < 0.01}
              onClick={() => onZoomPreset(percent)}
            >
              {percent}%
            </Button>
          ))}
          <Button
            type="button"
            onClick={onZoomFit}
          >
            Fit screen
          </Button>
        </div>
      ) : null}
      {activeTool === 'warp' ? (
        <WarpToolOptions
          adjustmentLayout={adjustmentLayout}
          warp={warp}
          onChange={onWarpChange}
          onReset={onWarpReset}
        />
      ) : null}
      {activeTool === 'face-warp' ? <FaceWarpToolOptions {...faceWarp}
        adjustmentLayout={adjustmentLayout} /> : null}
      {activeTool === 'text-point' || activeTool === 'text-paragraph'
        || activeTool === 'text-vertical' || activeTool === 'text-path' ? (
        <div className="lighttable-tool-options__text" aria-label="Text settings">
          {textLayoutMode && onTextLayoutModeChange ? (
            <SegmentedControl
              className="lighttable-tool-options__text-layout-mode"
              label="Text layout mode"
              value={textLayoutMode}
              onChange={onTextLayoutModeChange}
              options={[
                { value: 'point', label: 'Point', title: 'Convert to point text' },
                { value: 'paragraph', label: 'Paragraph', title: 'Convert to paragraph text' }
              ]}
            />
          ) : null}
          {textProperties && onTextWritingModeChange ? (
            <ToolOptionSelect label="Orientation"
              value={textProperties.writingMode.kind === 'value'
                ? textProperties.writingMode.value : ''}
              disabled={textProperties.writingMode.kind === 'unavailable'}
              onValueChange={(nextValue) => onTextWritingModeChange(nextValue as
                'horizontal-tb' | 'vertical-rl' | 'vertical-lr')}>
              <option value="horizontal-tb">Horizontal</option>
              <option value="vertical-rl">Vertical</option>
              <option value="vertical-lr">Vertical LTR</option>
            </ToolOptionSelect>
          ) : null}
          <TextFontPicker
            value={presentedTextFamily}
            fonts={textFonts}
            placeholder={textProperties?.family.kind === 'mixed' ? 'Mixed'
              : textProperties?.family.kind === 'unavailable' ? 'Unavailable' : undefined}
            disabled={textProperties?.family.kind === 'unavailable'}
            onChange={(family) => {
              if (!textProperties || !onTextFontAssetChange) {
                onTextChange({ family }); return;
              }
              const matches = textFonts.filter((font) => font.familyNames.includes(family));
              const asset = matches.find((font) => font.styleName === 'Regular') ?? matches[0];
              if (asset) onTextFontAssetChange(asset.assetId);
            }}
          />
          <ToolOptionSelect
            label="Style"
            value={textProperties?.face.kind === 'mixed' ? ''
              : textProperties?.face.kind === 'unavailable' ? ''
                : textProperties?.face.kind === 'value' ? textProperties.face.value : resolveTextToolFont(textFonts, text)?.assetId ?? ''}
            disabled={textProperties?.face.kind === 'unavailable'}
            onValueChange={(nextValue) => {
              if (!textProperties || !onTextFontAssetChange) {
                const font = textFonts.find(entry => entry.assetId === nextValue);
                if (font) onTextChange({ style: font.styleName });
                return;
              }
              onTextFontAssetChange(nextValue);
            }}
          >
            {textProperties?.face.kind === 'mixed' ? <option value="" disabled>Mixed</option> : null}
            {textProperties?.face.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
            {[...new Set(textFonts
              .filter(({ familyNames }) => familyNames.includes(presentedTextFamily))
              .map(({ assetId }) => assetId))]
              .map((assetId) => {
                const font = textFonts.find((entry) => entry.assetId === assetId)!;
                return <option key={assetId} value={assetId}>{font.styleName}</option>;
              })}
          </ToolOptionSelect>
          {textProperties && onTextSizeChange && onTextPropertyBegin
            && onTextPropertyCommit && onTextPropertyCancel ? (
            <MixedNumberInput label="Size" value={textProperties.size} min={1} max={1296}
              step={1} unit="px" onBegin={onTextPropertyBegin} onPreview={onTextSizeChange}
              onCommit={onTextPropertyCommit} onCancel={onTextPropertyCancel} />
          ) : <ToolOptionNumber
            label="Size"
            min={1}
            max={1296}
            step={1}
            value={text.size}
            onChange={(value) => onTextChange({
              size: Math.max(1, Math.min(1296, value || 1))
            })}
            unit="px"
          />}
          {onTextFillChange ? (
            <ToolOptionColor
              label="Fill"
              value={textProperties?.fill.kind === 'value'
                ? textProperties.fill.value
                : textProperties ? '#000000' : brush.color}
              onFocus={onTextPropertyBegin}
              enabled={textProperties?.fillEnabled.kind === 'value'
                ? textProperties.fillEnabled.value : text.fillEnabled}
              onEnabledChange={onTextFillEnabledChange}
              onChange={onTextFillChange}
              onBlur={onTextPropertyCommit}
              onCancel={onTextPropertyCancel}
              status={presentedTextGradient ? (
                <GradientField ref={textGradientButtonRef} size="compact"
                  value={presentedTextGradient.asset}
                  ariaLabel="Edit text fill gradient" title="Edit text fill gradient"
                  expanded={textGradientEditorOpen}
                  onClick={() => setTextGradientEditorOpen((open) => !open)} />
              ) : textProperties && textProperties.fill.kind !== 'value' ? (
                <em>{textProperties.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
              ) : null}
            />
          ) : null}
          {presentedTextGradient && textGradientEditorOpen && onTextFillPaintChange ? (
            <AnchoredGradientPopover anchor={textGradientButtonRef} ariaLabel="Text fill gradient"
              onPointerDownCapture={() => onTextPropertyBegin?.()}
              onPointerUpCapture={() => onTextPropertyCommit?.()}>
              <div className="lighttable-tool-options__gradient-header">
                <strong>Text fill gradient</strong>
                <ButtonBase type="button" aria-label="Close text fill gradient"
                  onClick={() => setTextGradientEditorOpen(false)}>×</ButtonBase>
              </div>
              <GradientAssetEditor value={presentedTextGradient.asset}
                onChange={(asset) => onTextFillPaintChange({ ...presentedTextGradient, asset })} />
              <div className="lighttable-tool-options__gradient-options">
                <ToolOptionSelect label="Style" value={presentedTextGradient.shape}
                  aria-label="Text gradient style"
                  onValueChange={(nextValue) => onTextFillPaintChange({
                    ...presentedTextGradient,
                    shape: nextValue as GradientPaintInstance['shape']
                  })}>
                  <option value="linear">Linear</option><option value="radial">Radial</option>
                  <option value="angle">Angle</option><option value="reflected">Reflected</option>
                  <option value="diamond">Diamond</option>
                </ToolOptionSelect>
              </div>
            </AnchoredGradientPopover>
          ) : null}
          {textProperties && onTextStrokeColorChange ? (
            <ToolOptionColor
              label="Line"
              value={textProperties.strokeColor.kind === 'value'
                ? textProperties.strokeColor.value : '#000000'}
              ariaLabel="Text line"
              onFocus={onTextPropertyBegin}
              onChange={onTextStrokeColorChange}
              onBlur={onTextPropertyCommit}
              onCancel={onTextPropertyCancel}
              status={textProperties.strokeColor.kind !== 'value' ? (
                <em>{textProperties.strokeColor.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
              ) : null}
            />
          ) : null}
          {textProperties && onTextStrokeWidthChange && onTextPropertyBegin
            && onTextPropertyCommit && onTextPropertyCancel ? (
            <MixedNumberInput label="Weight" value={textProperties.strokeWidth} min={0}
              max={100000} step={0.5} unit="px" onBegin={onTextPropertyBegin}
              onPreview={onTextStrokeWidthChange} onCommit={onTextPropertyCommit}
              onCancel={onTextPropertyCancel} />
          ) : null}
          <label className="lighttable-tool-options__field">
            <span>Antialias</span>
            <Select defaultValue={text.antiAlias} disabled aria-label="Text antialias mode">
              <option value="smooth">Smooth</option>
            </Select>
          </label>
          <ToolOptionSelect
            label="Align"
            value={textProperties?.alignment.kind === 'value'
              ? textProperties.alignment.value
              : textProperties ? '' : text.alignment}
            disabled={textProperties?.alignment.kind === 'unavailable'}
            aria-label="Text alignment"
            onValueChange={(nextValue) => {
              const alignment = nextValue as TextToolSettings['alignment'];
              if (textProperties && onTextAlignmentChange) onTextAlignmentChange(alignment);
              else onTextChange({ alignment });
            }}
          >
            {textProperties?.alignment.kind === 'mixed' ? <option value="" disabled>Mixed</option> : null}
            {textProperties?.alignment.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
            <option value="start">Left</option>
            <option value="center">Center</option>
            <option value="end">Right</option>
            <option value="justify">Justify</option>
          </ToolOptionSelect>
        </div>
      ) : null}
      {activeTool === 'vector-pen' || activeTool.startsWith('shape-') || editsVectorSelection ? (
        <VectorStyleToolOptions activeTool={activeTool} style={presentedVectorStyle}
          onChange={changeVectorStyle} />
      ) : null}
      {isPaintTool(activeTool) ? (
        <>
          {isSampledBrushTool(activeTool) ? (
            <>
              <ToolOptionSelect
                label="Sample"
                value={sampledBrush.sampleMode}
                aria-label="Sample layers"
                onValueChange={(nextValue) => onSampledBrushChange({
                  sampleMode: nextValue as EditorSession['sampledBrush']['sampleMode']
                })}
              >
                <option value="current">Current Layer</option>
                <option value="current-and-below">Current &amp; Below</option>
                <option value="all">All Layers</option>
              </ToolOptionSelect>
              <label className="lighttable-tool-options__toggle">
                <Checkbox  checked={sampledBrush.aligned}
                  onChange={(event) => onSampledBrushChange({ aligned: event.currentTarget.checked })} />
                <span>Aligned</span>
              </label>
              {activeTool === 'healing-brush' ? (
                <ToolOptionNumber
                  label="Diffusion"
                  value={sampledBrush.diffusion}
                  min={1}
                  max={7}
                  step={1}
                  onChange={(value) => onSampledBrushChange({
                    diffusion: clampHealingDiffusion(value)
                  })}
                />
              ) : null}
            </>
          ) : null}
          {isToneBrushTool(activeTool) ? (
            <>
              {activeTool === 'sponge' ? (
                <ToolOptionSelect
                  label="Mode"
                  value={toneBrush.spongeMode}
                  aria-label="Sponge mode"
                  onValueChange={(nextValue) => onToneBrushChange({
                    spongeMode: nextValue as EditorSession['toneBrush']['spongeMode']
                  })}
                >
                  <option value="desaturate">Desaturate</option>
                  <option value="saturate">Saturate</option>
                </ToolOptionSelect>
              ) : (
                <ToolOptionSelect
                  label="Range"
                  value={toneBrush.range}
                  aria-label="Tone range"
                  onValueChange={(nextValue) => onToneBrushChange({
                    range: nextValue as EditorSession['toneBrush']['range']
                  })}
                >
                  <option value="shadows">Shadows</option>
                  <option value="midtones">Midtones</option>
                  <option value="highlights">Highlights</option>
                </ToolOptionSelect>
              )}
              <AdjustmentSlider
                layout={adjustmentLayout}
                label={activeTool === 'sponge' ? 'Flow' : 'Exposure'}
                value={(activeTool === 'sponge' ? toneBrush.spongeFlow : toneBrush.exposure) * 100}
                min={1}
                max={100}
                resetValue={activeTool === 'sponge' ? 50 : 15}
                format={(value) => `${Math.round(value)}%`}
                onReset={() => onToneBrushChange(activeTool === 'sponge'
                  ? { spongeFlow: 0.5 } : { exposure: 0.15 })}
                onChange={(value) => onToneBrushChange(activeTool === 'sponge'
                  ? { spongeFlow: value / 100 } : { exposure: value / 100 })}
              />
              <label className="lighttable-tool-options__toggle">
                <Checkbox

                  checked={activeTool === 'sponge' ? toneBrush.vibrance : toneBrush.protectTones}
                  onChange={(event) => onToneBrushChange(activeTool === 'sponge'
                    ? { vibrance: event.currentTarget.checked }
                    : { protectTones: event.currentTarget.checked })}
                />
                <span>{activeTool === 'sponge' ? 'Vibrance' : 'Protect Tones'}</span>
              </label>
            </>
          ) : null}
          <ToolOptionSelect
            label="Preset"
            value={brush.presetId}
            aria-label="Brush preset"
            onValueChange={(nextValue) => onBrushChange(
              brushPresetChange(nextValue as BrushPresetId)
            )}
          >
            <optgroup label="Basic">
              {BRUSH_PRESETS.filter(({ category }) => category === 'Basic').map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </optgroup>
            {!isSampledBrushTool(activeTool) && !isToneBrushTool(activeTool) ? (
              <optgroup label="Effects">
                {BRUSH_PRESETS.filter(({ category }) => category === 'Effects').map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </optgroup>
            ) : null}
          </ToolOptionSelect>
          <AdjustmentSlider
          layout={adjustmentLayout}
          label="Size"
          value={brush.size}
          min={1}
          max={1000}
          resetValue={48}
          onReset={() => onBrushChange({ size: 48 })}
          onChange={(size) => onBrushChange({ size })}
          />
          <AdjustmentSlider
          layout={adjustmentLayout}
          label={resolveBrushPreset(brush.presetId).engine === 'warp' ? 'Density' : 'Hardness'}
          value={(activeTool === 'healing-brush'
            ? sampledBrush.healingHardness : brush.hardness) * 100}
          min={0}
          max={100}
          resetValue={75}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => activeTool === 'healing-brush'
            ? onSampledBrushChange({ healingHardness: 0 })
            : onBrushChange({ hardness: 0.75 })}
          onChange={(value) => activeTool === 'healing-brush'
            ? onSampledBrushChange({ healingHardness: value / 100 })
            : onBrushChange({ hardness: value / 100 })}
          />
          {!isToneBrushTool(activeTool) ? <AdjustmentSlider
          layout={adjustmentLayout}
          label={isSampledBrushTool(activeTool) || resolveBrushPreset(brush.presetId).engine === 'paint'
            ? 'Opacity' : 'Strength'}
          value={(activeTool === 'healing-brush'
            ? sampledBrush.healingOpacity : brush.opacity) * 100}
          min={1}
          max={100}
          resetValue={100}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => activeTool === 'healing-brush'
            ? onSampledBrushChange({ healingOpacity: 1 })
            : onBrushChange({ opacity: 1 })}
          onChange={(value) => activeTool === 'healing-brush'
            ? onSampledBrushChange({ healingOpacity: value / 100 })
            : onBrushChange({ opacity: value / 100 })}
          /> : null}
          {activeTool !== 'healing-brush' && !isToneBrushTool(activeTool) ? (
            <AdjustmentSlider
            layout={adjustmentLayout}
            label="Flow"
            value={brush.flow * 100}
            min={1}
            max={100}
            resetValue={35}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onBrushChange({ flow: 0.35 })}
            onChange={(value) => onBrushChange({ flow: value / 100 })}
            />
          ) : null}
          <AdjustmentSlider
          layout={adjustmentLayout}
          label="Smooth"
          value={brush.smooth * 100}
          min={0}
          max={MAX_STROKE_SMOOTH * 100}
          resetValue={0}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ smooth: 0 })}
          onChange={(value) => onBrushChange({ smooth: value / 100 })}
          />
        </>
      ) : null}
    </div>
  );
};

export const ToolOptionsBar: React.FC<ToolOptionsProps> = (props) => (
  <section className="lighttable-tool-options" aria-label="Tool settings">
    <ToolOptionsContent {...props} />
  </section>
);

/**
 * Keeps the application workspace geometry stable when the active document
 * has no applicable tool options. The bar is structural; only its controls
 * are document/tool specific.
 */
export const EmptyToolOptionsBar: React.FC<{
  readonly documentKind: 'image' | 'video' | 'model-3d';
}> = ({ documentKind }) => (
  <section
    className="lighttable-tool-options"
    aria-hidden="true"
    data-document-kind={documentKind}
  />
);
