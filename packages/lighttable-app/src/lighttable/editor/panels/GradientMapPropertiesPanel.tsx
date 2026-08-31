import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
import { lightTableIcon } from '../../../assets/icons';
import { SwitchControl } from '@lighttable/ui';
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
  const commitGradientMap = (next: typeof gradientMap) => {
    commands.updateGradientMap(next);
    commands.endAdjustment();
  };

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Gradient Map properties">
      <section className="lighttable-group lighttable-master-group">
        <PanelSectionHeader label="Gradient Map" actions={<>
            <IconButton variant="quiet" type="button" onClick={commands.resetGradientMap} aria-label="Reset Gradient Map" title="Reset Gradient Map" icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          </>} />
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls">
            <GradientAssetEditor value={editorValue} onChange={updateGradient}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment} />
            <div className="lighttable-gradient-map__options">
              <SwitchControl checked={gradientMap.reverse} onCheckedChange={(reverse) => commitGradientMap({ ...gradientMap, reverse })} label="Reverse Gradient Map" />
              <span>Reverse</span>
              <SwitchControl checked={gradientMap.dither} onCheckedChange={(dither) => commitGradientMap({ ...gradientMap, dither })} label="Dither Gradient Map" />
              <span>Dither</span>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
};
