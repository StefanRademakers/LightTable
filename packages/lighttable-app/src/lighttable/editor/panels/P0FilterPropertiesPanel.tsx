import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
import React from 'react';
import { filterDefinition } from '@lighttable/filter-core';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';

import { PanelSelectField } from '../../../ui/PanelControls';
import { SwitchControl } from '@lighttable/ui';
import { lightTableIcon } from '../../../assets/icons';
import type {
  P0FilterCommands,
  P0FilterPresentation
} from '../../application/filters/useP0FilterController';

export interface P0FilterPropertiesPanelProps {
  readonly model: P0FilterPresentation;
  readonly commands: P0FilterCommands;
}

const formatted = (value: number, unit?: 'px' | '%' | 'deg') => unit === 'px'
  ? `${value.toFixed(1)} px`
  : unit === '%'
    ? `${Math.round(value)}%`
    : unit === 'deg'
      ? `${value.toFixed(1)}°`
      : `${Number.isInteger(value) ? value : value.toFixed(1)}`;

const valueAtPath = (source: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((value, part) => value && typeof value === 'object'
    ? (value as Record<string, unknown>)[part]
    : undefined, source);

/** Registry-driven Properties surface shared by global and attached filters. */
export const P0FilterPropertiesPanel: React.FC<P0FilterPropertiesPanelProps> = ({
  model,
  commands
}) => {
  const definition = filterDefinition(model.kind);
  const settings = model.settings as unknown as Record<string, unknown>;
  const defaults = definition.defaults as unknown as Record<string, unknown>;
  return (
    <aside className="lighttable-panel lighttable-grade-panel"
      aria-label={`${model.label} properties`}>
      <section className="lighttable-group lighttable-master-group">
        <PanelSectionHeader label={model.label} actions={<>
            <IconButton variant="quiet" type="button" onClick={commands.reset} aria-label={`Reset ${model.label}`} title={`Reset ${model.label}`} icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
            <SwitchControl checked={model.enabled} onCheckedChange={commands.toggleEnabled}
              label={model.enabled ? `Disable ${model.label}` : `Enable ${model.label}`} />
          </>} />
      </section>
      <div className="lighttable-panel__controls">
        <section className={`lighttable-group${model.enabled ? '' : ' lighttable-group--disabled'}`}>
          <div className="lighttable-group__controls">
            {definition.controls.map((control) => control.type === 'number' ? (
              <AdjustmentSlider key={control.key} label={control.label}
                value={Number(valueAtPath(settings, control.key))} min={control.min} max={control.max}
                step={control.step} format={(value) => formatted(value, control.unit)}
                resetValue={Number(valueAtPath(defaults, control.key))} disabled={!model.enabled}
                onChange={(value) => commands.updateSetting(control.key, value)}
                onReset={commands.reset} onInteractionStart={commands.beginAdjustment}
                onInteractionEnd={commands.endAdjustment} />
            ) : control.type === 'select' ? (
              <PanelSelectField key={control.key} label={control.label}
                value={String(valueAtPath(settings, control.key))} options={control.options}
                onChange={(value) => {
                  commands.beginAdjustment();
                  commands.updateSetting(control.key, value);
                  commands.endAdjustment();
                }} />
            ) : (
              <PanelSelectField key={control.key} label={control.label}
                value={String(valueAtPath(settings, control.key) ?? '')}
                options={[
                  { value: '', label: 'None (bypass)' },
                  ...model.rasterSources
                ]}
                onChange={(value) => {
                  commands.beginAdjustment();
                  commands.updateSetting(control.key, value || null);
                  commands.endAdjustment();
                }} />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
};
