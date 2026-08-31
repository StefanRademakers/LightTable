import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { NumericExpressionInput } from '../../../ui/NumericExpressionInput';
import { lightTableIcon } from '../../../assets/icons';
import { Histogram, type HistogramChannel } from '../../Histogram';
import type { PhotoshopAdjustmentSettings } from '../../photoshopAdjustments';
import type { GradePanelProps } from './GradePanel';
import { PanelSelectField } from '../../../ui/PanelControls';
import { RangeSlider } from '@lighttable/ui';

type LevelsInput = PhotoshopAdjustmentSettings['levels']['rgb']['input'];
type LevelsOutput = PhotoshopAdjustmentSettings['levels']['rgb']['output'];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const levelsGammaPosition = ([black, gamma, white]: Readonly<LevelsInput>) =>
  black + (white - black) * Math.pow(0.5, gamma);

export const levelsGammaFromPosition = (
  position: number,
  black: number,
  white: number
) => {
  const normalized = clamp((position - black) / Math.max(1, white - black), 0.001, 0.999);
  return clamp(Math.log(normalized) / Math.log(0.5), 0.1, 9.99);
};

export interface LevelsTrackProps {
  readonly label: string;
  readonly values: readonly number[];
  readonly ariaLabels: readonly string[];
  readonly formatters?: readonly ((value: number) => string)[];
  readonly showValues?: boolean;
  readonly background: string;
  readonly disabled: boolean;
  readonly onChange: (index: number, value: number) => void;
  readonly onInteractionStart: () => void;
  readonly onInteractionEnd: () => void;
}

export const LevelsTrack = ({
  label, values, ariaLabels, formatters, showValues = true, background, disabled,
  onChange, onInteractionStart, onInteractionEnd
}: LevelsTrackProps) => <RangeSlider label={label} values={values} labels={ariaLabels}
  min={0} max={255} step={values.length === 3 ? [1, 0.1, 1] : 1}
  disabled={disabled} trackBackground={background}
  onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd}
  onChange={(next, index) => onChange(index, next[index]!)}
  getBounds={(index, current) => {
    // Gamma follows the endpoints; it must never constrain their travel.
    if (current.length === 3) return index === 0
      ? { min: 0, max: current[2]! - 1 }
      : index === 2 ? { min: current[0]! + 1, max: 255 }
      : { min: current[0]!, max: current[2]! };
    return { min: index === 0 ? 0 : current[index - 1]!, max: index === current.length - 1 ? 255 : current[index + 1]! };
  }}
  resolveValues={(next, index, previous) => {
    if (next.length !== 3 || index === 1) return next;
    const gamma = levelsGammaFromPosition(previous[1]!, previous[0]!, previous[2]!);
    return [next[0]!, levelsGammaPosition([next[0]!, gamma, next[2]!]), next[2]!];
  }}
  renderValues={showValues ? current => current.map((value, index) =>
    <NumericExpressionInput key={ariaLabels[index]} aria-label={`${ariaLabels[index]} value`}
      value={value} min={0} max={255} step={1} kind="integer" formatValue={formatters?.[index]}
      disabled={disabled} onValueChange={next => {
        onInteractionStart(); onChange(index, next); onInteractionEnd();
      }} />) : undefined} />;

export const LevelsPropertiesPanel = ({
  model,
  commands,
  settings
}: GradePanelProps & { readonly settings: PhotoshopAdjustmentSettings }) => {
  const disabled = !model.metadata;
  const update = (next: PhotoshopAdjustmentSettings) =>
    commands.updatePhotoshopAdjustment(next);
  const commit = (recipe: () => void) => {
    recipe();
    commands.endAdjustment();
  };
  const selected = settings.levels[settings.levelsChannel];
  const updateSelected = (next: { input?: LevelsInput; output?: LevelsOutput }) => update({
    ...settings,
    levels: {
      ...settings.levels,
      [settings.levelsChannel]: { ...selected, ...next }
    }
  });
  const updateInput = (index: number, rawValue: number) => {
    const [black, gamma, white] = selected.input;
    let next: LevelsInput;
    if (index === 0) next = [clamp(rawValue, 0, white - 1), gamma, white];
    else if (index === 1) next = [black, clamp(rawValue, 0.1, 9.99), white];
    else next = [black, gamma, clamp(rawValue, black + 1, 255)];
    updateSelected({ input: next });
  };
  const updateInputHandle = (index: number, rawValue: number) => {
    if (index !== 1) return updateInput(index, rawValue);
    updateInput(1, levelsGammaFromPosition(
      rawValue,
      selected.input[0],
      selected.input[2]
    ));
  };
  const updateOutput = (index: number, rawValue: number) => {
    const [black, white] = selected.output;
    const next: LevelsOutput = index === 0
      ? [clamp(rawValue, 0, white), white]
      : [black, clamp(rawValue, black, 255)];
    updateSelected({ output: next });
  };
  const inputHandleValues = [
    selected.input[0],
    levelsGammaPosition(selected.input),
    selected.input[2]
  ];

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Levels properties">
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label"><strong>Levels</strong></div>
          <div className="lighttable-group__actions">
            <ButtonBase type="button" className="lighttable-group__reset"
              onClick={commands.resetPhotoshopAdjustment} aria-label="Reset Levels" title="Reset Levels">
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </ButtonBase>
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls lighttable-levels">
            <PanelSelectField label="Channel" labelWidth="56px" value={settings.levelsChannel}
              options={['rgb', 'red', 'green', 'blue'].map((value) => ({
                value, label: value.toUpperCase()
              }))}
              onChange={(levelsChannel) => commit(() => update({
                ...settings,
                levelsChannel: levelsChannel as PhotoshopAdjustmentSettings['levelsChannel']
              }))} />
            <div className="lighttable-levels__histogram">
              <Histogram histogram={model.histogram}
                channel={settings.levelsChannel as HistogramChannel} />
            </div>
            <LevelsTrack
              label="Input Levels"
              values={inputHandleValues}
              ariaLabels={['Black input', 'Gamma', 'White input']}
              showValues={false}
              background="linear-gradient(to right, #050607, #f2f4f6)"
              disabled={disabled}
              onChange={updateInputHandle}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
            <div className="lighttable-levels__input-values">
              <NumericExpressionInput aria-label="Black input value"
                value={selected.input[0]} min={0} max={selected.input[2] - 1}
                kind="integer" onValueChange={(value) => commit(() => updateInput(0, value))} disabled={disabled} />
              <NumericExpressionInput aria-label="Gamma value"
                value={selected.input[1]} min={0.1} max={9.99} step={0.01}
                formatValue={(value) => value.toFixed(2)}
                onValueChange={(value) => commit(() => updateInput(1, value))} disabled={disabled} />
              <NumericExpressionInput aria-label="White input value"
                value={selected.input[2]} min={selected.input[0] + 1} max={255}
                kind="integer" onValueChange={(value) => commit(() => updateInput(2, value))} disabled={disabled} />
            </div>
            <LevelsTrack
              label="Output Levels"
              values={selected.output}
              ariaLabels={['Black output', 'White output']}
              background="linear-gradient(to right, #050607, #f2f4f6)"
              disabled={disabled}
              onChange={updateOutput}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          </div>
        </section>
      </div>
    </aside>
  );
};
