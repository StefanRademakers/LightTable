import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { useGradePresentation } from '../../application/adjustments/adjustmentPresentationStore';
import {
  COLOR_SLIDERS,
  EFFECTS_SLIDERS,
  LIGHT_SLIDERS,
  type SliderDefinition
} from '../config/adjustmentControls';
import type { NumericAdjustmentKey } from '../../application/adjustments/groupVisibility';
import type { GradePanelProps } from './GradePanel';

interface AdjustmentPropertiesPanelProps extends GradePanelProps {
  readonly title: 'Exposure' | 'Vibrance' | 'Color and Vibrance' | 'Clarity and Dehaze';
}

const definitionsFor = (title: AdjustmentPropertiesPanelProps['title']): readonly SliderDefinition[] => (
  title === 'Exposure'
    ? LIGHT_SLIDERS.filter(({ key }) => key === 'exposureEV')
    : title === 'Clarity and Dehaze'
      ? EFFECTS_SLIDERS.filter(({ key }) => key === 'clarity' || key === 'dehaze')
      : title === 'Color and Vibrance'
      ? COLOR_SLIDERS
      : COLOR_SLIDERS.filter(({ key }) => key === 'vibrance' || key === 'saturation')
);

/** Focused editor assembled from the same controls and command path as Grade. */
export const AdjustmentPropertiesPanel = ({
  title,
  model,
  commands
}: AdjustmentPropertiesPanelProps) => {
  const adjustments = useGradePresentation(model.adjustmentStore);
  const sliders = definitionsFor(title);
  const group = title === 'Exposure' ? 'light'
    : title === 'Clarity and Dehaze' ? 'effects' : 'color';

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label={`${title} properties`}>
      <section className="lighttable-group lighttable-master-group">
        <PanelSectionHeader label={title} actions={<>
            <IconButton variant="quiet" type="button" onClick={() => commands.resetGroup(group)} aria-label={`Reset ${title}`} title={`Reset ${title}`} icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          </>} />
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls">
            {sliders.map((slider) => (
              <AdjustmentSlider
                key={slider.key}
                label={slider.label}
                value={adjustments[slider.key as NumericAdjustmentKey]}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                format={slider.format}
                track={slider.track}
                resetValue={0}
                disabled={!model.metadata}
                resetModifierActive={model.resetModifierActive}
                onChange={(value) => commands.updateAdjustment(slider.key, value)}
                onReset={() => commands.resetAdjustment(slider.key)}
                onInteractionStart={commands.beginAdjustment}
                onInteractionEnd={commands.endAdjustment}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
};
