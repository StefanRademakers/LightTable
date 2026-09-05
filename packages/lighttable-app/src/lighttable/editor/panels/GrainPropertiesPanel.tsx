import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
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
        <PanelSectionHeader label="Grain" actions={<>
            <IconButton variant="quiet" type="button" onClick={commands.grain.reset} aria-label="Reset Grain" title="Reset Grain" icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          </>} />
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
              onInteractionEnd={commands.endAdjustment}
              onInteractionCancel={commands.cancelAdjustment} />
          ))}
        </div></section>
      </div>
    </aside>
  );
};
