import { Button } from '@lighttable/ui';
import React from 'react';
import { AdjustmentSlider, type AdjustmentSliderProps } from '../../../../ui/AdjustmentSlider';
import { FormSelect } from '../../../../ui/FormSelect';
import type { EditorSession } from '../../../editor/session/editorSession';
import type { WarpBrushMode } from '../../../effects/warp/warpTypes';
import { MAX_STROKE_SMOOTH } from '../../../editor/tools/brush/strokeSmoother';

export interface WarpToolOptionsProps {
  readonly warp: EditorSession['warp'];
  readonly onChange: (change: Partial<EditorSession['warp']>) => void;
  readonly onReset: () => void;
  readonly adjustmentLayout?: AdjustmentSliderProps['layout'];
}

/**
 * Presentation for the Warp tool only.
 *
 * Both the persistent options bar and cursor-local options menu project this
 * component, while document mutation remains owned by the Warp controller.
 */
export const WarpToolOptions: React.FC<WarpToolOptionsProps> = ({
  warp,
  adjustmentLayout,
  onChange,
  onReset
}) => (
  <>
    <label className="lighttable-tool-options__field">
      <span>Mode</span>
      <FormSelect
        value={warp.mode}
        onChange={(event) => onChange({ mode: event.currentTarget.value as WarpBrushMode })}
      >
        <option value="push">Push</option>
        <option value="twirl-cw">Twirl clockwise</option>
        <option value="twirl-ccw">Twirl counter-clockwise</option>
        <option value="pinch">Pinch</option>
        <option value="bloat">Bloat</option>
      </FormSelect>
    </label>
    <label className="lighttable-tool-options__toggle">
      <input
        type="checkbox"
        checked={warp.debugView === 'displacement'}
        onChange={(event) => onChange({
          debugView: event.currentTarget.checked ? 'displacement' : 'result'
        })}
      />
      Show displacement
    </label>
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Size"
      value={warp.diameterPx}
      min={1}
      max={2000}
      resetValue={500}
      format={(value) => `${Math.round(value)} px`}
      onReset={() => onChange({ diameterPx: 500 })}
      onChange={(diameterPx) => onChange({ diameterPx })}
    />
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Strength"
      value={warp.strength * 100}
      min={1}
      max={200}
      resetValue={100}
      format={(value) => `${Math.round(value)}%`}
      onReset={() => onChange({ strength: 1 })}
      onChange={(value) => onChange({ strength: value / 100 })}
    />
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Density"
      value={warp.hardness * 100}
      min={0}
      max={100}
      resetValue={50}
      format={(value) => `${Math.round(value)}%`}
      onReset={() => onChange({ hardness: 0.5 })}
      onChange={(value) => onChange({ hardness: value / 100 })}
    />
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Flow"
      value={warp.flow * 100}
      min={1}
      max={100}
      resetValue={100}
      format={(value) => `${Math.round(value)}%`}
      onReset={() => onChange({ flow: 1 })}
      onChange={(value) => onChange({ flow: value / 100 })}
    />
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Spacing"
      value={warp.spacing * 100}
      min={1}
      max={100}
      resetValue={4}
      format={(value) => `${Math.round(value)}%`}
      onReset={() => onChange({ spacing: 0.04 })}
      onChange={(value) => onChange({ spacing: value / 100 })}
    />
    <AdjustmentSlider
      layout={adjustmentLayout}
      label="Smooth"
      value={warp.smooth * 100}
      min={0}
      max={MAX_STROKE_SMOOTH * 100}
      resetValue={0}
      format={(value) => `${Math.round(value)}%`}
      onReset={() => onChange({ smooth: 0 })}
      onChange={(value) => onChange({ smooth: value / 100 })}
    />
    <label className="lighttable-tool-options__toggle">
      <input
        type="checkbox"
        checked={warp.pressureSize}
        onChange={(event) => onChange({
          pressureSize: event.currentTarget.checked
        })}
      />
      Pressure size
    </label>
    <label className="lighttable-tool-options__toggle">
      <input
        type="checkbox"
        checked={warp.pressureStrength}
        onChange={(event) => onChange({
          pressureStrength: event.currentTarget.checked
        })}
      />
      Pressure strength
    </label>
    <Button
      type="button"
      onClick={onReset}
    >
      Reset Warp
    </Button>
  </>
);
