import React from 'react';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import type {
  BrushSettings,
  EditorSession,
  ToolId
} from '../session/editorSession';
import { ZOOM_PRESETS_PERCENT } from '../tools/zoom/zoomLevels';

export interface ToolOptionsProps {
  activeTool: ToolId;
  brush: BrushSettings;
  warp: EditorSession['warp'];
  selectionPixelSnap: boolean;
  zoomPercent: number;
  onBrushChange: (change: Partial<BrushSettings>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  warp: 'Warp - Push',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-free': 'Free selection',
  'select-polygonal': 'Polygonal selection',
  fill: 'Fill',
  brush: 'Brush',
  erase: 'Erase',
  view: 'Move canvas',
  zoom: 'Zoom'
};

export const ToolOptionsContent: React.FC<ToolOptionsProps & {
  orientation?: 'horizontal' | 'vertical';
}> = ({
  activeTool,
  brush,
  warp,
  selectionPixelSnap,
  zoomPercent,
  onBrushChange,
  onWarpChange,
  onSelectionPixelSnapChange,
  onZoomPreset,
  onZoomFit,
  orientation = 'horizontal'
}) => (
  <div className={`lighttable-tool-options__content lighttable-tool-options__content--${orientation}`}>
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
      {activeTool === 'warp' ? (
        <>
          <AdjustmentSlider
            label="Size"
            value={warp.diameterPx}
            min={1}
            max={2000}
            resetValue={200}
            format={(value) => `${Math.round(value)} px`}
            onReset={() => onWarpChange({ diameterPx: 200 })}
            onChange={(diameterPx) => onWarpChange({ diameterPx })}
          />
          <AdjustmentSlider
            label="Strength"
            value={warp.strength * 100}
            min={1}
            max={100}
            resetValue={35}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onWarpChange({ strength: 0.35 })}
            onChange={(value) => onWarpChange({ strength: value / 100 })}
          />
          <AdjustmentSlider
            label="Hardness"
            value={warp.hardness * 100}
            min={0}
            max={100}
            resetValue={75}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onWarpChange({ hardness: 0.75 })}
            onChange={(value) => onWarpChange({ hardness: value / 100 })}
          />
          <AdjustmentSlider
            label="Flow"
            value={warp.flow * 100}
            min={1}
            max={100}
            resetValue={50}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onWarpChange({ flow: 0.5 })}
            onChange={(value) => onWarpChange({ flow: value / 100 })}
          />
          <AdjustmentSlider
            label="Spacing"
            value={warp.spacing * 100}
            min={1}
            max={100}
            resetValue={10}
            format={(value) => `${Math.round(value)}%`}
            onReset={() => onWarpChange({ spacing: 0.1 })}
            onChange={(value) => onWarpChange({ spacing: value / 100 })}
          />
          <label className="lighttable-tool-options__toggle">
            <input
              type="checkbox"
              checked={warp.pressureSize}
              onChange={(event) => onWarpChange({
                pressureSize: event.currentTarget.checked
              })}
            />
            Pressure size
          </label>
          <label className="lighttable-tool-options__toggle">
            <input
              type="checkbox"
              checked={warp.pressureStrength}
              onChange={(event) => onWarpChange({
                pressureStrength: event.currentTarget.checked
              })}
            />
            Pressure strength
          </label>
        </>
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

export const ToolOptionsBar: React.FC<ToolOptionsProps> = (props) => (
  <section className="lighttable-tool-options" aria-label="Tool settings">
    <ToolOptionsContent {...props} />
  </section>
);
