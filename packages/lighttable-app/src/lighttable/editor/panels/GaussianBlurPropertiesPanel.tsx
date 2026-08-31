import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
import React from 'react';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';

import { SwitchControl } from '@lighttable/ui';
import { lightTableIcon } from '../../../assets/icons';
import {
  DEFAULT_GAUSSIAN_BLUR_RADIUS,
  MAX_GAUSSIAN_BLUR_RADIUS
} from '../../processing/gaussianBlurFilter';
import type {
  GaussianBlurFilterCommands,
  GaussianBlurFilterPresentation
} from '../../application/filters/useGaussianBlurFilterController';

export interface GaussianBlurPropertiesPanelProps {
  readonly model: GaussianBlurFilterPresentation;
  readonly commands: GaussianBlurFilterCommands;
}

export const GaussianBlurPropertiesPanel: React.FC<GaussianBlurPropertiesPanelProps> = ({
  model,
  commands
}) => (
  <aside className="lighttable-panel lighttable-grade-panel" aria-label="Gaussian Blur properties">
    <section className="lighttable-group lighttable-master-group">
      <PanelSectionHeader label="Gaussian Blur" actions={<>
          <IconButton variant="quiet" type="button" onClick={commands.reset} aria-label="Reset Gaussian Blur" title="Reset Gaussian Blur" icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          <SwitchControl
            checked={model.enabled}
            onCheckedChange={commands.toggleEnabled}
            label={model.enabled ? 'Disable Gaussian Blur' : 'Enable Gaussian Blur'}
          />
        </>} />
    </section>
    <div className="lighttable-panel__controls">
      <section className={`lighttable-group${model.enabled ? '' : ' lighttable-group--disabled'}`}>
        <div className="lighttable-group__controls">
          <AdjustmentSlider
            label="Radius"
            value={model.radius}
            min={0}
            max={MAX_GAUSSIAN_BLUR_RADIUS}
            step={0.1}
            format={(value) => `${value.toFixed(1)} px`}
            resetValue={DEFAULT_GAUSSIAN_BLUR_RADIUS}
            disabled={!model.enabled}
            onChange={commands.updateRadius}
            onReset={commands.reset}
            onInteractionStart={commands.beginAdjustment}
            onInteractionEnd={commands.endAdjustment}
          />
        </div>
      </section>
    </div>
  </aside>
);
