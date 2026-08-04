import React from 'react';
import { createPortal } from 'react-dom';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import type {
  BrushSettings,
  EditorSession,
  TextToolSettings,
  ToolId,
  VectorToolStyleSettings
} from '../session/editorSession';
import { WarpToolOptions } from '../../application/tools/warp/WarpToolOptions';
import { toolDefinition } from '../tools/toolRegistry';
import { isSelectionTool } from '../tools/toolCapabilities';
import type { SelectionCombineMode } from '../selection/selectionTypes';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';
import type { DocumentFontAsset } from '../document/documentTypes';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import { MixedNumberInput } from './MixedNumberInput';
import { ToolOptionColor, ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';
import { GradientAssetEditor } from './LayerStyleGradientEditor';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import type { TextPaint } from '@lighttable/text-core';

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  gradient: EditorSession['gradient'];
  shape: EditorSession['shape'];
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
  selectionRowHeight: number;
  selectionColumnWidth: number;
  zoomPercent: number;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onGradientChange: (change: Partial<EditorSession['gradient']>) => void;
  onShapeChange: (change: Partial<EditorSession['shape']>) => void;
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
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange?: (change: Partial<VectorToolStyleSettings>) => void;
  onSelectedShapeChange?: (change: Partial<EditorSession['shape']>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: SelectionCombineMode) => void;
  onSelectionRowHeightChange: (height: number) => void;
  onSelectionColumnWidthChange: (width: number) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  warp: 'Warp',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-horizontal': 'Horizontal selection',
  'select-vertical': 'Vertical selection',
  'select-free': 'Free selection',
  'select-polygonal': 'Polygonal selection',
  gradient: 'Gradient',
  fill: 'Paint bucket',
  brush: 'Brush',
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
  'text-path': 'Path text'
};

const AnchoredGradientPopover: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: React.ReactNode;
  onPointerDownCapture?: () => void;
  onPointerUpCapture?: () => void;
}> = ({ anchor, ariaLabel, children, onPointerDownCapture, onPointerUpCapture }) => {
  const [position, setPosition] = React.useState({ left: 12, top: 84 });
  React.useLayoutEffect(() => {
    const update = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 348)),
        top: bounds.bottom + 7
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor]);
  return createPortal(
    <div className="lighttable-tool-options__gradient-popover" role="dialog"
      aria-label={ariaLabel} style={position}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}>{children}</div>,
    document.body
  );
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
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
  selectionPixelSnap,
  selectionCombineMode,
  selectionRowHeight,
  selectionColumnWidth,
  zoomPercent,
  onBrushChange,
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
  onTextPropertyBegin,
  onTextPropertyCommit,
  onTextPropertyCancel,
  onTextLayoutModeChange,
  onSelectedVectorStyleChange,
  onSelectedShapeChange,
  onWarpReset,
  onSelectionPixelSnapChange,
  onSelectionCombineModeChange,
  onSelectionRowHeightChange,
  onSelectionColumnWidthChange,
  onZoomPreset,
  onZoomFit,
  orientation = 'horizontal'
}) => {
  const activeToolDefinition = toolDefinition(activeTool);
  const vectorStyleToolActive = activeTool.startsWith('vector-') || activeTool.startsWith('shape-');
  const editsVectorSelection = vectorStyleToolActive && Boolean(selectedVectorStyle);
  const presentedVectorStyle = editsVectorSelection ? selectedVectorStyle! : vectorStyle;
  const presentedShape = selectedShape ?? shape;
  const changeShape = selectedShape && onSelectedShapeChange
    ? onSelectedShapeChange : onShapeChange;
  const shapeGeometryActive = activeTool === 'shape-rectangle'
    || activeTool === 'shape-ellipse' || activeTool === 'shape-line' || Boolean(selectedShapeKind);
  const rectangleGeometryActive = selectedShapeKind
    ? selectedShapeKind === 'rectangle' : activeTool === 'shape-rectangle';
  const presentedGradient = presentedVectorStyle.fillPaint
    && 'kind' in presentedVectorStyle.fillPaint
    ? presentedVectorStyle.fillPaint as GradientPaintInstance
    : null;
  const [gradientEditorOpen, setGradientEditorOpen] = React.useState(false);
  const gradientButtonRef = React.useRef<HTMLButtonElement>(null);
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

  const releaseCompletedSelect = (event: React.ChangeEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    // A tool-mode choice is a completed command, not an ongoing text-editing
    // session. Returning focus immediately keeps document shortcuts such as
    // the shared brush-size [ / ] bindings available after the choice.
    target.blur();
  };

  return (
    <div
      className={`lighttable-tool-options__content lighttable-tool-options__content--${orientation}`}
      onChange={releaseCompletedSelect}
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
          ariaLabel="Selection combine mode"
          value={selectionCombineMode}
          onChange={onSelectionCombineModeChange}
          options={[
            { value: 'replace', label: 'New', title: 'New selection' },
            { value: 'add', label: 'Add', title: 'Add to selection' },
            { value: 'subtract', label: 'Subtract', title: 'Subtract from selection' },
            { value: 'intersect', label: 'Intersect', title: 'Intersect with selection' }
          ]}
        />
      ) : null}
      {activeTool === 'select-rectangle' || activeTool === 'select-ellipse' ? (
        <label className="lighttable-tool-options__toggle">
          <input
            type="checkbox"
            checked={selectionPixelSnap}
            onChange={(event) => onSelectionPixelSnapChange(event.currentTarget.checked)}
          />
          Snap to pixels
        </label>
      ) : null}
      {activeTool === 'select-horizontal' || activeTool === 'select-vertical' ? (
        <label className="lighttable-tool-options__weight-field">
          <span>{activeTool === 'select-horizontal' ? 'Height' : 'Width'}</span>
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={activeTool === 'select-horizontal'
              ? selectionRowHeight
              : selectionColumnWidth}
            onChange={(event) => {
              const size = Math.max(1, Math.round(Number(event.currentTarget.value) || 1));
              if (activeTool === 'select-horizontal') onSelectionRowHeightChange(size);
              else onSelectionColumnWidthChange(size);
            }}
          />
          <span>px</span>
        </label>
      ) : null}
      {activeTool === 'gradient' ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Gradient settings">
          <ToolOptionSelect label="Apply" value={gradient.application}
            aria-label="Gradient application"
            onChange={(event) => onGradientChange({
              application: event.currentTarget.value as EditorSession['gradient']['application']
            })}>
            <option value="fill-layer">Fill layer</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <button
            ref={gradientButtonRef}
            type="button"
            className="lighttable-tool-options__gradient-button"
            aria-label="Edit gradient"
            title="Edit gradient"
            onClick={() => setGradientEditorOpen((open) => !open)}
          >Gradient</button>
          {gradientEditorOpen ? (
            <AnchoredGradientPopover anchor={gradientButtonRef} ariaLabel="Gradient editor">
              <div className="lighttable-tool-options__gradient-header">
                <strong>Gradient</strong>
                <button type="button" aria-label="Close gradient"
                  onClick={() => setGradientEditorOpen(false)}>×</button>
              </div>
              <GradientAssetEditor
                value={gradient.paint.asset}
                onChange={(asset) => onGradientChange({
                  paint: { ...gradient.paint, asset }
                })}
              />
            </AnchoredGradientPopover>
          ) : null}
          <ToolOptionSelect label="Type" value={gradient.paint.shape}
            aria-label="Gradient type"
            onChange={(event) => onGradientChange({ paint: {
              ...gradient.paint,
              shape: event.currentTarget.value as GradientPaintInstance['shape']
            } })}>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="angle">Angle</option>
            <option value="reflected">Reflected</option>
            <option value="diamond">Diamond</option>
          </ToolOptionSelect>
          <AdjustmentSlider label="Opacity" value={gradient.opacity * 100}
            min={1} max={100} resetValue={100}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onGradientChange({ opacity: 1 })}
            onChange={(opacity) => onGradientChange({ opacity: opacity / 100 })} />
          <ToolOptionSelect label="Mode" value={gradient.blendMode}
            aria-label="Gradient blend mode"
            onChange={(event) => onGradientChange({
              blendMode: event.currentTarget.value as EditorSession['gradient']['blendMode']
            })}>
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
            <option value="overlay">Overlay</option>
            <option value="soft-light">Soft Light</option>
            <option value="hard-light">Hard Light</option>
            <option value="difference">Difference</option>
          </ToolOptionSelect>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={gradient.paint.reverse}
              aria-label="Reverse gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, reverse: event.currentTarget.checked
              } })} />
            <span>Reverse</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={gradient.paint.dither}
              aria-label="Dither gradient"
              onChange={(event) => onGradientChange({ paint: {
                ...gradient.paint, dither: event.currentTarget.checked
              } })} />
            <span>Dither</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={gradient.transparency}
              aria-label="Use gradient transparency"
              onChange={(event) => onGradientChange({ transparency: event.currentTarget.checked })} />
            <span>Transparency</span>
          </label>
          <ToolOptionSelect label="Method" value={gradient.paint.interpolation}
            aria-label="Gradient interpolation"
            onChange={(event) => onGradientChange({ paint: {
              ...gradient.paint,
              interpolation: event.currentTarget.value as GradientPaintInstance['interpolation']
            } })}>
            <option value="perceptual">Perceptual</option>
            <option value="linear">Linear</option>
            <option value="classic">Classic</option>
            <option value="smooth">Smooth</option>
          </ToolOptionSelect>
          <span className="lighttable-tool-options__status">
            {gradient.application === 'fill-layer' ? 'Editable fill layer' : 'Active raster target'}
          </span>
        </div>
      ) : null}
      {shapeGeometryActive ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Shape geometry">
          <ToolOptionSelect label="Mode" value={shape.mode}
            aria-label="Shape application mode"
            onChange={(event) => onShapeChange({
              mode: event.currentTarget.value as EditorSession['shape']['mode']
            })}>
            <option value="shape">Shape</option>
            <option value="pixels">Pixels</option>
          </ToolOptionSelect>
          <ToolOptionSelect label="Geometry" value={presentedShape.geometry}
            aria-label="Shape geometry mode"
            onChange={(event) => changeShape({
              geometry: event.currentTarget.value as EditorSession['shape']['geometry']
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
            <input type="checkbox" checked={presentedShape.fromCenter}
              onChange={(event) => changeShape({ fromCenter: event.currentTarget.checked })} />
            <span>From center</span>
          </label>
          <label className="lighttable-tool-options__toggle">
            <input type="checkbox" checked={presentedShape.snapToPixels}
              onChange={(event) => changeShape({ snapToPixels: event.currentTarget.checked })} />
            <span>Snap pixels</span>
          </label>
          {rectangleGeometryActive ? (
            <>
              <label className="lighttable-tool-options__toggle">
                <input type="checkbox" checked={presentedShape.linkedCorners}
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
              <ToolOptionSelect label="Style" value={presentedShape.lineStyle}
                aria-label="Line style"
                onChange={(event) => changeShape({
                  lineStyle: event.currentTarget.value as EditorSession['shape']['lineStyle']
                })}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </ToolOptionSelect>
              <div className="lighttable-tool-options__line-ends" role="group" aria-label="Arrowheads">
                <button type="button" aria-label="Start arrowhead"
                  aria-pressed={presentedShape.lineStartArrow}
                  onClick={() => changeShape({ lineStartArrow: !presentedShape.lineStartArrow })}>
                  <img src={lightTableIcon('arrow-left.png')} alt="" aria-hidden />
                </button>
                <button type="button" aria-label="No arrowheads"
                  aria-pressed={!presentedShape.lineStartArrow && !presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineStartArrow: false, lineEndArrow: false })}>
                  <img src={lightTableIcon('horizontal-line.png')} alt="" aria-hidden />
                </button>
                <button type="button" aria-label="End arrowhead"
                  aria-pressed={presentedShape.lineEndArrow}
                  onClick={() => changeShape({ lineEndArrow: !presentedShape.lineEndArrow })}>
                  <img src={lightTableIcon('arrow-right.png')} alt="" aria-hidden />
                </button>
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
      ) : null}
      {activeTool === 'zoom' ? (
        <div className="lighttable-tool-options__zoom-presets" aria-label="Zoom presets">
          {ZOOM_PRESETS_PERCENT.map((percent) => (
            <button
              key={percent}
              type="button"
              className={
                Math.abs(zoomPercent - percent) < 0.01
                  ? 'lighttable-tool-options__preset lighttable-tool-options__preset--active'
                  : 'lighttable-tool-options__preset'
              }
              onClick={() => onZoomPreset(percent)}
            >
              {percent}%
            </button>
          ))}
          <button
            type="button"
            className="lighttable-tool-options__preset"
            onClick={onZoomFit}
          >
            Fit screen
          </button>
        </div>
      ) : null}
      {activeTool === 'warp' ? (
        <WarpToolOptions
          warp={warp}
          onChange={onWarpChange}
          onReset={onWarpReset}
        />
      ) : null}
      {activeTool === 'text-point' || activeTool === 'text-paragraph'
        || activeTool === 'text-path' ? (
        <div className="lighttable-tool-options__text" aria-label="Text settings">
          {textLayoutMode && onTextLayoutModeChange ? (
            <SegmentedControl
              className="lighttable-tool-options__text-layout-mode"
              ariaLabel="Text layout mode"
              value={textLayoutMode}
              onChange={onTextLayoutModeChange}
              options={[
                { value: 'point', label: 'Point', title: 'Convert to point text' },
                { value: 'paragraph', label: 'Paragraph', title: 'Convert to paragraph text' }
              ]}
            />
          ) : null}
          <ToolOptionSelect
            label="Font"
            value={textProperties && textProperties.family.kind !== 'value' ? '' : presentedTextFamily}
            disabled={textProperties?.family.kind === 'unavailable'}
            onChange={(event) => {
              if (!textProperties || !onTextFontAssetChange) {
                onTextChange({ family: event.currentTarget.value }); return;
              }
              const family = event.currentTarget.value;
              const matches = textFonts.filter((font) => font.familyNames.includes(family));
              const asset = matches.find((font) => font.styleName === 'Regular') ?? matches[0];
              if (asset) onTextFontAssetChange(asset.assetId);
            }}
          >
            {textProperties?.family.kind === 'mixed' ? <option value="" disabled>Mixed</option> : null}
            {textProperties?.family.kind === 'unavailable' ? <option value="">Unavailable</option> : null}
            {([
              ['Bundled', (font: DocumentFontAsset) => font.source === 'bundled'],
              ['Document', (font: DocumentFontAsset) => font.source !== 'bundled' && font.source !== 'system'],
              ['System', (font: DocumentFontAsset) => font.source === 'system']
            ] as const).map(([label, accepts]) => {
              const families = [...new Set(textFonts.filter(accepts)
                .flatMap(({ familyNames }) => familyNames.slice(0, 1)))];
              return families.length ? <optgroup key={label} label={label}>
                {families.map((family) => <option key={`${label}:${family}`} value={family}>{family}</option>)}
              </optgroup> : null;
            })}
          </ToolOptionSelect>
          <ToolOptionSelect
            label="Style"
            value={textProperties?.face.kind === 'mixed' ? ''
              : textProperties?.face.kind === 'unavailable' ? ''
                : textProperties?.face.kind === 'value' ? textProperties.face.value : text.style}
            disabled={textProperties?.face.kind === 'unavailable'}
            onChange={(event) => {
              if (!textProperties || !onTextFontAssetChange) {
                onTextChange({ style: event.currentTarget.value }); return;
              }
              onTextFontAssetChange(event.currentTarget.value);
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
                <button ref={textGradientButtonRef} type="button" className="lighttable-tool-options__gradient-button"
                  aria-label="Edit text fill gradient" title="Edit text fill gradient"
                  onClick={() => setTextGradientEditorOpen((open) => !open)}>Gradient</button>
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
                <button type="button" aria-label="Close text fill gradient"
                  onClick={() => setTextGradientEditorOpen(false)}>×</button>
              </div>
              <GradientAssetEditor value={presentedTextGradient.asset}
                onChange={(asset) => onTextFillPaintChange({ ...presentedTextGradient, asset })} />
              <div className="lighttable-tool-options__gradient-options">
                <ToolOptionSelect label="Style" value={presentedTextGradient.shape}
                  aria-label="Text gradient style"
                  onChange={(event) => onTextFillPaintChange({
                    ...presentedTextGradient,
                    shape: event.currentTarget.value as GradientPaintInstance['shape']
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
            <select value={text.antiAlias} disabled aria-label="Text antialias mode">
              <option value="smooth">Smooth</option>
            </select>
          </label>
          <ToolOptionSelect
            label="Align"
            value={textProperties?.alignment.kind === 'value'
              ? textProperties.alignment.value
              : textProperties ? '' : text.alignment}
            disabled={textProperties?.alignment.kind === 'unavailable'}
            aria-label="Text alignment"
            onChange={(event) => {
              const alignment = event.currentTarget.value as TextToolSettings['alignment'];
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
        <div className="lighttable-tool-options__vector-style" aria-label="Vector style">
          {activeTool !== 'shape-line' ? (
            <ToolOptionColor label="Fill" value={presentedVectorStyle.fillColor}
              enabled={presentedVectorStyle.fillEnabled}
              allowChangeWhenOff
              onEnabledChange={(fillEnabled) => changeVectorStyle({
                fillEnabled,
                ...(fillEnabled ? { fillColor: presentedVectorStyle.fillColor } : {})
              })}
              onChange={(fillColor) => changeVectorStyle({ fillEnabled: true, fillColor })}
              status={presentedGradient ? (
                <button ref={gradientButtonRef} type="button" className="lighttable-tool-options__gradient-button"
                  aria-label="Edit fill gradient" title="Edit fill gradient"
                  onClick={() => setGradientEditorOpen((open) => !open)}>Gradient</button>
              ) : null} />
          ) : null}
          {presentedGradient && gradientEditorOpen ? (
            <AnchoredGradientPopover anchor={gradientButtonRef} ariaLabel="Fill gradient">
              <div className="lighttable-tool-options__gradient-header">
                <strong>Fill gradient</strong>
                <button type="button" aria-label="Close fill gradient"
                  onClick={() => setGradientEditorOpen(false)}>×</button>
              </div>
              <GradientAssetEditor value={presentedGradient.asset}
                onChange={(asset) => changeVectorStyle({
                  fillEnabled: true, fillPaint: { ...presentedGradient, asset }
                })} />
              <div className="lighttable-tool-options__gradient-options">
                <ToolOptionSelect label="Style" value={presentedGradient.shape}
                  aria-label="Gradient style"
                  onChange={(event) => changeVectorStyle({ fillPaint: {
                    ...presentedGradient,
                    shape: event.currentTarget.value as GradientPaintInstance['shape']
                  } })}>
                  <option value="linear">Linear</option>
                  <option value="radial">Radial</option>
                  <option value="angle">Angle</option>
                  <option value="reflected">Reflected</option>
                  <option value="diamond">Diamond</option>
                </ToolOptionSelect>
                <label className="lighttable-tool-options__toggle">
                  <input type="checkbox" checked={presentedGradient.reverse}
                    aria-label="Reverse gradient"
                    onChange={(event) => changeVectorStyle({ fillPaint: {
                      ...presentedGradient, reverse: event.currentTarget.checked
                    } })} />
                  <span>Reverse</span>
                </label>
              </div>
            </AnchoredGradientPopover>
          ) : null}
          <ToolOptionColor label="Line" value={presentedVectorStyle.strokeColor}
            enabled={presentedVectorStyle.strokeEnabled}
            allowChangeWhenOff
            onEnabledChange={(strokeEnabled) => changeVectorStyle({
              strokeEnabled,
              ...(strokeEnabled ? { strokeColor: presentedVectorStyle.strokeColor } : {})
            })}
            onChange={(strokeColor) => changeVectorStyle({ strokeEnabled: true, strokeColor })} />
          <ToolOptionNumber label="Weight" min={0.1} max={1000} step={0.5}
            value={presentedVectorStyle.strokeWidth} unit="px"
            onChange={(value) => changeVectorStyle({ strokeWidth: Math.max(0.1, value || 0.1) })} />
          <ToolOptionSelect label="Align" value={presentedVectorStyle.strokeAlignment}
            disabled={!presentedVectorStyle.strokeEnabled}
            aria-label="Stroke alignment"
            onChange={(event) => changeVectorStyle({
              strokeAlignment: event.currentTarget.value as VectorToolStyleSettings['strokeAlignment']
            })}>
            <option value="inside">Inside</option>
            <option value="center">Center</option>
            <option value="outside">Outside</option>
          </ToolOptionSelect>
        </div>
      ) : null}
      {activeTool === 'brush' || activeTool === 'erase' ? (
        <>
          <AdjustmentSlider
          label="Size"
          value={brush.size}
          min={1}
          max={1000}
          resetValue={48}
          onReset={() => onBrushChange({ size: 48 })}
          onChange={(size) => onBrushChange({ size })}
          />
          <AdjustmentSlider
          label="Hardness"
          value={brush.hardness * 100}
          min={0}
          max={100}
          resetValue={75}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ hardness: 0.75 })}
          onChange={(value) => onBrushChange({ hardness: value / 100 })}
          />
          <AdjustmentSlider
          label="Opacity"
          value={brush.opacity * 100}
          min={1}
          max={100}
          resetValue={100}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ opacity: 1 })}
          onChange={(value) => onBrushChange({ opacity: value / 100 })}
          />
          <AdjustmentSlider
          label="Flow"
          value={brush.flow * 100}
          min={1}
          max={100}
          resetValue={35}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ flow: 0.35 })}
          onChange={(value) => onBrushChange({ flow: value / 100 })}
          />
          <AdjustmentSlider
          label="Spacing"
          value={brush.spacing * 100}
          min={1}
          max={100}
          resetValue={5}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onBrushChange({ spacing: 0.05 })}
          onChange={(value) => onBrushChange({ spacing: value / 100 })}
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
