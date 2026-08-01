import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import type {
  BrushSettings,
  EditorSession,
  ToolId,
  VectorToolStyleSettings
} from '../session/editorSession';
import { WarpToolOptions } from '../../application/tools/warp/WarpToolOptions';
import { toolDefinition } from '../tools/toolRegistry';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  warp: EditorSession['warp'];
  vectorStyle: VectorToolStyleSettings;
  selectionPixelSnap: boolean;
  zoomPercent: number;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<VectorToolStyleSettings>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  warp: 'Warp',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
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
  'shape-line': 'Line'
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
  warp,
  vectorStyle,
  selectionPixelSnap,
  zoomPercent,
  onBrushChange,
  onWarpChange,
  onVectorStyleChange,
  onWarpReset,
  onSelectionPixelSnapChange,
  onZoomPreset,
  onZoomFit,
  orientation = 'horizontal'
}) => {
  const activeToolDefinition = toolDefinition(activeTool);

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
      {activeTool === 'vector-pen' || activeTool.startsWith('shape-') ? (
        <div className="lighttable-tool-options__vector-style" aria-label="Vector style">
          {activeTool !== 'shape-line' ? (
            <label className="lighttable-tool-options__color-field">
              <span>Fill</span>
              <input
                type="color"
                value={vectorStyle.fillColor}
                onChange={(event) => onVectorStyleChange({ fillColor: event.currentTarget.value })}
              />
            </label>
          ) : null}
          <label className="lighttable-tool-options__color-field">
            <span>Line</span>
            <input
              type="color"
              value={vectorStyle.strokeColor}
              onChange={(event) => onVectorStyleChange({ strokeColor: event.currentTarget.value })}
            />
          </label>
          <label className="lighttable-tool-options__weight-field">
            <span>Weight</span>
            <input
              type="number"
              min={0.1}
              max={1000}
              step={0.5}
              value={vectorStyle.strokeWidth}
              onChange={(event) => onVectorStyleChange({
                strokeWidth: Math.max(0.1, Number(event.currentTarget.value) || 0.1)
              })}
            />
            <span>px</span>
          </label>
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
