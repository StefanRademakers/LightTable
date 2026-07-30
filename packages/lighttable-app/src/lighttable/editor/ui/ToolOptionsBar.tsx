import React from 'react';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import type { BrushSettings, ToolId } from '../session/editorSession';

interface ToolOptionsBarProps {
  activeTool: ToolId;
  brush: BrushSettings;
  onBrushChange: (change: Partial<BrushSettings>) => void;
}

const TOOL_LABELS: Record<ToolId, string> = {
  transform: 'Transform',
  'select-rectangle': 'Rectangular selection',
  'select-ellipse': 'Elliptical selection',
  'select-free': 'Free selection',
  fill: 'Fill',
  brush: 'Brush',
  erase: 'Erase',
  view: 'Move canvas'
};

export const ToolOptionsBar: React.FC<ToolOptionsBarProps> = ({
  activeTool,
  brush,
  onBrushChange
}) => (
  <section className="lighttable-tool-options" aria-label="Tool settings">
    <div className="lighttable-tool-options__content">
      <strong>{TOOL_LABELS[activeTool]}</strong>
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
