import React from 'react';
import { GradientEditor, type GradientEditorProps, type LocalInteractionSession } from '@lighttable/ui';
import type { LayerStyleGradient } from '../styles/layerStyleTypes';
import { PanelColorSwatch } from '../../../ui/PanelControls';

export { gradientStopPosition, gradientMidpointPosition, gradientMidpointValue, removableGradientStops } from '@lighttable/ui';

/** The app contributes its color picker and preserves the asset's non-UI metadata. */
export const GradientAssetEditor = ({ value, onChange, ...props }: Omit<GradientEditorProps, 'value' | 'onChange'> & {
  value: LayerStyleGradient;
  onChange: (value: LayerStyleGradient, handle: object | void) => void;
}) => <GradientEditor {...props} value={value} onChange={(next, handle) => onChange({ ...value, ...next }, handle)}
  renderColorField={({
    value: color, onChange: changeColor, onInteractionStart, onInteractionEnd,
    onInteractionCancel
  }) =>
    <PanelColorSwatch label="Color" value={color} onChange={changeColor}
      onInteractionStart={onInteractionStart}
      onInteractionCommit={(handle) => onInteractionEnd(handle as LocalInteractionSession)}
      onInteractionCancel={(handle) => onInteractionCancel(handle as LocalInteractionSession)} />} />;

export const LayerStyleGradientEditor = GradientAssetEditor;
