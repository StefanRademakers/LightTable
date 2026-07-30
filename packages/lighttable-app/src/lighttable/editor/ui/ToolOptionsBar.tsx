import React from 'react';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import type { BrushSettings, ToolId } from '../session/editorSession';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';

interface ToolOptionsBarProps {
  activeTool: ToolId;
  brush: BrushSettings;
  selectionPixelSnap: boolean;
  zoomPercent: number;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-free': 'Free selection',
  fill: 'Fill',
  brush: 'Brush',
  erase: 'Erase',
  view: 'Move canvas',
  zoom: 'Zoom'
};

export const ToolOptionsBar: React.FC<ToolOptionsBarProps> = ({
  activeTool,
  brush,
  selectionPixelSnap,
  zoomPercent,
  onBrushChange,
  onSelectionPixelSnapChange,
  onZoomPreset,
  onZoomFit
}) => (
  <section className="lighttable-tool-options" aria-label="Tool settings">
    <div className="lighttable-tool-options__content">
      <strong>{TOOL_LABELS[activeTool]}</strong>
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
  </section>
);
