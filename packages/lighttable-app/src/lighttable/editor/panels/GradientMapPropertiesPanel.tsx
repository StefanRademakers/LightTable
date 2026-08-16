import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { SwitchControl } from '../../../ui/SwitchControl';
import { useGradePresentation } from '../../application/adjustments/adjustmentPresentationStore';
import { GradientAssetEditor } from '../ui/LayerStyleGradientEditor';
import type { LayerStyleGradient } from '../styles/layerStyleTypes';
import { DEFAULT_BASIC_ADJUSTMENTS } from '../../types';
import type { GradePanelProps } from './GradePanel';

/** Focused Gradient Map editor reusing the production Grade gradient widget. */
export const GradientMapPropertiesPanel = ({ model, commands }: GradePanelProps) => {
  const adjustments = useGradePresentation(model.adjustmentStore);
  const gradientMap = adjustments.gradientMap ?? DEFAULT_BASIC_ADJUSTMENTS.gradientMap!;
  const editorValue: LayerStyleGradient = {
    id: 'gradient-map', type: 'solid', name: 'Gradient Map', smoothness: 1, roughness: 0, seed: 0,
    colorStops: gradientMap.colorStops.map((stop, index) => ({
      ...stop, id: `gradient-map-color-${index}`, color: { ...stop.color, a: 1 }
    })),
    opacityStops: gradientMap.opacityStops.map((stop, index) => ({
      ...stop, id: `gradient-map-opacity-${index}`
    }))
  };
  const updateGradient = (value: LayerStyleGradient) => commands.updateGradientMap({
    ...gradientMap,
    colorStops: value.colorStops.map(({ position, midpoint, color }) => ({
      position, midpoint, color: { r: color.r, g: color.g, b: color.b }
    })),
    opacityStops: value.opacityStops.map(({ position, midpoint, opacity }) => ({
      position, midpoint, opacity
    }))
  });

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Gradient Map properties">
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label"><strong>Gradient Map</strong></div>
          <div className="lighttable-group__actions">
            <ButtonBase type="button" className="lighttable-group__reset" onClick={commands.resetGradientMap} aria-label="Reset Gradient Map" title="Reset Gradient Map">
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </ButtonBase>
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls">
            <GradientAssetEditor value={editorValue} onChange={updateGradient} />
            <div className="lighttable-gradient-map__options">
              <SwitchControl checked={gradientMap.reverse} onCheckedChange={(reverse) => commands.updateGradientMap({ ...gradientMap, reverse })} label="Reverse Gradient Map" />
              <span>Reverse</span>
              <SwitchControl checked={gradientMap.dither} onCheckedChange={(dither) => commands.updateGradientMap({ ...gradientMap, dither })} label="Dither Gradient Map" />
              <span>Dither</span>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};
