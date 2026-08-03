import React from 'react';
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

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  warp: EditorSession['warp'];
  vectorStyle: VectorToolStyleSettings;
  text: TextToolSettings;
  textFonts: readonly DocumentFontAsset[];
  textProperties?: TextPropertyPresentation | null;
  textLayoutMode?: 'point' | 'paragraph' | null;
  selectedVectorStyle?: VectorToolStyleSettings | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: SelectionCombineMode;
  selectionRowHeight: number;
  selectionColumnWidth: number;
  zoomPercent: number;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<VectorToolStyleSettings>) => void;
  onTextChange: (change: Partial<TextToolSettings>) => void;
  onTextFontAssetChange?: (assetId: string) => void;
  onTextSizeChange?: (size: number) => void;
  onTextFillChange?: (fill: string) => void;
  onTextStrokeColorChange?: (stroke: string) => void;
  onTextStrokeWidthChange?: (width: number) => void;
  onTextAlignmentChange?: (alignment: TextToolSettings['alignment']) => void;
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange?: (change: Partial<VectorToolStyleSettings>) => void;
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
  fill: 'Fill',
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
  'text-point': 'Point text',
  'text-paragraph': 'Paragraph text'
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
  warp,
  vectorStyle,
  text,
  textFonts,
  textProperties,
  textLayoutMode,
  selectedVectorStyle,
  selectionPixelSnap,
  selectionCombineMode,
  selectionRowHeight,
  selectionColumnWidth,
  zoomPercent,
  onBrushChange,
  onWarpChange,
  onVectorStyleChange,
  onTextChange,
  onTextFontAssetChange,
  onTextSizeChange,
  onTextFillChange,
  onTextStrokeColorChange,
  onTextStrokeWidthChange,
  onTextAlignmentChange,
  onTextPropertyBegin,
  onTextPropertyCommit,
  onTextPropertyCancel,
  onTextLayoutModeChange,
  onSelectedVectorStyleChange,
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
      {activeTool === 'text-point' || activeTool === 'text-paragraph' ? (
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
            {[...new Set(textFonts.flatMap(({ familyNames }) => familyNames.slice(0, 1)))]
              .map((family) => <option key={family} value={family}>{family}</option>)}
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
              onChange={onTextFillChange}
              onBlur={onTextPropertyCommit}
              onCancel={onTextPropertyCancel}
              status={textProperties && textProperties.fill.kind !== 'value' ? (
                <em>{textProperties.fill.kind === 'mixed' ? 'Mixed' : 'Non-solid / unsupported'}</em>
              ) : null}
            />
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
              onChange={(fillColor) => changeVectorStyle({ fillColor })} />
          ) : null}
          <ToolOptionColor label="Line" value={presentedVectorStyle.strokeColor}
            onChange={(strokeColor) => changeVectorStyle({ strokeColor })} />
          <ToolOptionNumber label="Weight" min={0.1} max={1000} step={0.5}
            value={presentedVectorStyle.strokeWidth} unit="px"
            onChange={(value) => changeVectorStyle({ strokeWidth: Math.max(0.1, value || 0.1) })} />
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
