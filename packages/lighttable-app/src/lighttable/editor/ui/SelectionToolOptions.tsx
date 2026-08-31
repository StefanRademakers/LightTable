import { Checkbox, NumberField } from '@lighttable/ui';
import React from 'react';
import { AdjustmentSlider, type AdjustmentSliderProps } from '../../../ui/AdjustmentSlider';
import type { EditorSession, ToolId } from '../session/editorSession';
import { MAX_STROKE_SMOOTH } from '../tools/brush/strokeSmoother';
import { ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';

interface SelectionToolOptionsProps {
  readonly activeTool: ToolId;
  readonly feather: number;
  readonly antiAlias: boolean;
  readonly marqueeStyle: EditorSession['selectionMarqueeStyle'];
  readonly marqueeWidth: number;
  readonly marqueeHeight: number;
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly smooth: number;
  readonly adjustmentLayout?: AdjustmentSliderProps['layout'];
  readonly onFeatherChange: (radius: number) => void;
  readonly onAntiAliasChange: (enabled: boolean) => void;
  readonly onMarqueeStyleChange: (style: EditorSession['selectionMarqueeStyle']) => void;
  readonly onMarqueeWidthChange: (width: number) => void;
  readonly onMarqueeHeightChange: (height: number) => void;
  readonly onRowHeightChange: (height: number) => void;
  readonly onColumnWidthChange: (width: number) => void;
  readonly onSmoothChange: (smooth: number) => void;
}

const finiteFeather = (value: number) => (
  Math.max(0, Math.min(250, Number.isFinite(value) ? value : 0))
);

export const SelectionToolOptions: React.FC<SelectionToolOptionsProps> = ({
  activeTool,
  feather,
  antiAlias,
  marqueeStyle,
  marqueeWidth,
  marqueeHeight,
  rowHeight,
  columnWidth,
  smooth,
  adjustmentLayout,
  onFeatherChange,
  onAntiAliasChange,
  onMarqueeStyleChange,
  onMarqueeWidthChange,
  onMarqueeHeightChange,
  onRowHeightChange,
  onColumnWidthChange,
  onSmoothChange
}) => {
  if (activeTool === 'select-rectangle' || activeTool === 'select-ellipse') {
    const fixed = marqueeStyle === 'fixed';
    const minimum = fixed ? 1 : 0.01;
    return (
      <div className="lighttable-tool-options__vector-style" aria-label="Marquee selection settings">
        <ToolOptionNumber label="Feather" unit="px" value={feather} min={0} max={250} step={1}
          onChange={(value) => onFeatherChange(finiteFeather(value))} />
        <ToolOptionSelect label="Style" value={marqueeStyle} aria-label="Marquee selection style"
          onValueChange={(nextValue) => onMarqueeStyleChange(
            nextValue as EditorSession['selectionMarqueeStyle']
          )}>
          <option value="free">Free</option>
          <option value="ratio">Ratio</option>
          <option value="fixed">Fixed</option>
        </ToolOptionSelect>
        {marqueeStyle !== 'free' ? <>
          <ToolOptionNumber label="Width" unit={fixed ? 'px' : undefined} value={marqueeWidth}
            min={minimum} max={10000} step={fixed ? 1 : 0.01}
            onChange={(value) => onMarqueeWidthChange(Math.max(
              minimum, Number.isFinite(value) ? value : 1
            ))} />
          <ToolOptionNumber label="Height" unit={fixed ? 'px' : undefined} value={marqueeHeight}
            min={minimum} max={10000} step={fixed ? 1 : 0.01}
            onChange={(value) => onMarqueeHeightChange(Math.max(
              minimum, Number.isFinite(value) ? value : 1
            ))} />
        </> : null}
      </div>
    );
  }

  if (activeTool === 'select-horizontal' || activeTool === 'select-vertical') {
    const horizontal = activeTool === 'select-horizontal';
    return (
      <label className="lighttable-tool-options__weight-field">
        <span>{horizontal ? 'Height' : 'Width'}</span>
        <NumberField kind="integer" updateMode="input" min={1} max={10000} step={1}
          value={horizontal ? rowHeight : columnWidth}
          onValueChange={(size) => {
            if (horizontal) onRowHeightChange(size);
            else onColumnWidthChange(size);
          }} />
        <span>px</span>
      </label>
    );
  }

  if (activeTool !== 'select-free' && activeTool !== 'select-polygonal') return null;
  return (
    <div className="lighttable-tool-options__vector-style" aria-label="Lasso selection settings">
      {activeTool === 'select-free' ? (
        <AdjustmentSlider layout={adjustmentLayout} label="Smooth" value={smooth * 100} min={0}
          max={MAX_STROKE_SMOOTH * 100} resetValue={0}
          format={(value) => `${Math.round(value)}%`}
          onReset={() => onSmoothChange(0)} onChange={(value) => onSmoothChange(value / 100)} />
      ) : null}
      <ToolOptionNumber label="Feather" unit="px" value={feather} min={0} max={250} step={1}
        onChange={(value) => onFeatherChange(finiteFeather(value))} />
      <label className="lighttable-tool-options__toggle">
        <Checkbox  checked={antiAlias}
          onChange={(event) => onAntiAliasChange(event.currentTarget.checked)} />
        Anti-alias
      </label>
    </div>
  );
};
