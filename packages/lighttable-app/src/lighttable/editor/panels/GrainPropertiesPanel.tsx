import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { useLensFxPresentation } from '../../application/adjustments/adjustmentPresentationStore';
import { DEFAULT_GRAIN_SETTINGS } from '../../effects/grain/settings';
import { GRAIN_ADVANCED_SLIDERS, GRAIN_SLIDERS } from '../config/adjustmentControls';
import type { LensFxPanelProps } from './LensFxPanel';

export const GrainPropertiesPanel = ({ model, commands }: LensFxPanelProps) => {
  const adjustments = useLensFxPresentation(model.adjustmentStore);
  const grain = adjustments.effects.grain;
  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Grain properties">
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label"><strong>Grain</strong></div>
          <div className="lighttable-group__actions">
            <ButtonBase type="button" className="lighttable-group__reset" onClick={commands.grain.reset} aria-label="Reset Grain" title="Reset Grain">
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </ButtonBase>
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group"><div className="lighttable-group__controls">
          {[...GRAIN_SLIDERS, ...GRAIN_ADVANCED_SLIDERS].map((slider) => (
            <AdjustmentSlider key={slider.key} label={slider.label} value={grain[slider.key]}
              min={slider.min} max={slider.max} step={slider.step} format={slider.format}
              track={slider.track} resetValue={DEFAULT_GRAIN_SETTINGS[slider.key]}
              disabled={!model.metadata || !grain.enabled}
              resetModifierActive={model.resetModifierActive}
              onChange={(value) => commands.grain.update(slider.key, value)}
              onReset={() => commands.grain.resetControl(slider.key)}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment} />
          ))}
        </div></section>
      </div>
    </aside>
  );
};
