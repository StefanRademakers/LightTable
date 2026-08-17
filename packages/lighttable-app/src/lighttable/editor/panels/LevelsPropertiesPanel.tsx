import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { NumericExpressionInput } from '../../../ui/NumericExpressionInput';
import { lightTableIcon } from '../../../assets/icons';
import { Histogram, type HistogramChannel } from '../../Histogram';
import type { PhotoshopAdjustmentSettings } from '../../photoshopAdjustments';
import type { GradePanelProps } from './GradePanel';
import { PanelSelectField } from '../../../ui/PanelControls';
import { adjustmentSliderValueAtPosition } from '../../../ui/AdjustmentSlider';

type LevelsInput = PhotoshopAdjustmentSettings['levels']['rgb']['input'];
type LevelsOutput = PhotoshopAdjustmentSettings['levels']['rgb']['output'];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const LEVELS_EDIT_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'PageUp', 'PageDown', 'Home', 'End'
]);

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

const LevelsHandle: React.FC<{
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly className: string;
  readonly onChange: (value: number) => void;
  readonly onInteractionStart: () => void;
  readonly onInteractionEnd: () => void;
}> = ({
  value, minimum, maximum, step, disabled, ariaLabel, className,
  onChange, onInteractionStart, onInteractionEnd
}) => {
  const pointerRef = React.useRef<number | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const latestRef = React.useRef(value);
  const publishedRef = React.useRef(value);
  const [displayValue, setDisplayValue] = React.useState(value);

  const publish = React.useCallback((force = false) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (!force && latestRef.current === publishedRef.current) return;
    publishedRef.current = latestRef.current;
    onChange(latestRef.current);
  }, [onChange]);
  const updateFromPointer = (input: HTMLInputElement, clientX: number) => {
    const bounds = input.getBoundingClientRect();
    const next = clamp(adjustmentSliderValueAtPosition(
      clientX, bounds.left, bounds.width, 0, 255, step
    ), minimum, maximum);
    latestRef.current = next;
    setDisplayValue(next);
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        publish();
      });
    }
  };
  const finish = (pointerId: number) => {
    if (pointerRef.current !== pointerId) return;
    pointerRef.current = null;
    publish(true);
    onInteractionEnd();
  };

  React.useEffect(() => {
    if (pointerRef.current !== null) return;
    latestRef.current = value;
    publishedRef.current = value;
    setDisplayValue(value);
  }, [value]);
  React.useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return <input
    className={className}
    type="range"
    min={0}
    max={255}
    step={step}
    value={displayValue}
    disabled={disabled}
    aria-label={ariaLabel}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || pointerRef.current !== null) return;
      event.preventDefault();
      pointerRef.current = event.pointerId;
      onInteractionStart();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateFromPointer(event.currentTarget, event.clientX);
    }}
    onPointerMove={(event) => {
      if (pointerRef.current === event.pointerId) {
        updateFromPointer(event.currentTarget, event.clientX);
      }
    }}
    onPointerUp={(event) => {
      if (pointerRef.current !== event.pointerId) return;
      updateFromPointer(event.currentTarget, event.clientX);
      finish(event.pointerId);
    }}
    onPointerCancel={(event) => finish(event.pointerId)}
    onLostPointerCapture={(event) => finish(event.pointerId)}
    onKeyDown={(event) => {
      if (!LEVELS_EDIT_KEYS.has(event.key) || event.repeat) return;
      onInteractionStart();
    }}
    onKeyUp={(event) => {
      if (LEVELS_EDIT_KEYS.has(event.key)) onInteractionEnd();
    }}
    onBlur={onInteractionEnd}
    onChange={(event) => {
      if (pointerRef.current !== null) return;
      const next = Number(event.currentTarget.value);
      latestRef.current = next;
      publishedRef.current = next;
      setDisplayValue(next);
      onChange(next);
    }}
    onDragStart={(event) => event.preventDefault()}
  />;
};

export const LevelsTrack = ({
  label,
  values,
  ariaLabels,
  formatters,
  showValues = true,
  background,
  disabled,
  onChange,
  onInteractionStart,
  onInteractionEnd
}: LevelsTrackProps) => (
  <div className={`lighttable-levels__range lighttable-levels__range--${values.length}`}>
    <span className="lighttable-levels__range-label">{label}</span>
    <div className="lighttable-levels__track">
      <span
        className="lighttable-levels__track-axis"
        style={{ ['--lighttable-slider-track' as string]: background }}
        aria-hidden="true"
      />
      {values.map((value, index) => {
        const minimum = index === 0 ? 0 : values[index - 1] ?? 0;
        const maximum = index === values.length - 1 ? 255 : values[index + 1] ?? 255;
        const endpointGap = values.length === 3 && index !== 1 ? 1 : 0;
        return <LevelsHandle
          key={ariaLabels[index]}
          className={`lighttable-levels__handle lighttable-levels__handle--${index}`}
          minimum={minimum + (index > 0 ? endpointGap : 0)}
          maximum={maximum - (index < values.length - 1 ? endpointGap : 0)}
          step={index === 1 && values.length === 3 ? 0.1 : 1}
          value={value}
          disabled={disabled}
          ariaLabel={ariaLabels[index]}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
          onChange={(next) => onChange(index, next)}
        />;
      })}
    </div>
    {showValues ? <div className="lighttable-levels__values">
      {values.map((value, index) => (
        <NumericExpressionInput
          key={ariaLabels[index]}
          aria-label={`${ariaLabels[index]} value`}
          value={value}
          min={index === 1 && values.length === 3 ? 0.1 : 0}
          max={index === 1 && values.length === 3 ? 9.99 : 255}
          step={index === 1 && values.length === 3 ? 0.01 : 1}
          kind={index === 1 && values.length === 3 ? 'float' : 'integer'}
          formatValue={formatters?.[index]}
          disabled={disabled}
          onValueChange={(next) => {
            onInteractionStart();
            onChange(index, next);
            onInteractionEnd();
          }}
        />
      ))}
    </div> : null}
  </div>
);

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
