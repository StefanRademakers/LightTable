import React, { useId, useRef } from 'react';
import { sliderEditKeys, sliderValueAtPosition, useSliderInteraction } from './useSliderInteraction';

export interface SliderProps {
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  resetValue?: number;
  showResetMarker?: boolean;
  trackBackground?: string;
  /** Composites a supplied track over the shared transparency checkerboard. */
  transparency?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  className?: string;
  publishIntervalMs?: number | 'animation-frame';
  resetModifierActive?: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}
export interface SliderFieldProps extends SliderProps {
  layout?: 'stacked' | 'inline';
  size?: 'regular' | 'small';
}

function SliderControl({ label, ariaLabel, value, min, max, step = 1,
  format = String, resetValue = min, showResetMarker = true, trackBackground,
  transparency = false, disabled = false, tabIndex = -1, className = '',
  publishIntervalMs, resetModifierActive = false, onChange, onReset,
  onInteractionStart, onInteractionEnd, field
}: SliderProps & { field?: Pick<SliderFieldProps, 'layout' | 'size'> }) {
  const id = useId();
  const pointer = useRef<number | null>(null);
  const keyboard = useRef(false);
  const interaction = useSliderInteraction(value, { onChange, onInteractionStart, onInteractionEnd, publishIntervalMs });
  const display = Math.min(max, Math.max(min, interaction.display));
  const percentage = (next: number) => max > min ? Math.min(100, Math.max(0, (next - min) / (max - min) * 100)) : 0;
  const reset = () => {
    if (disabled) return;
    if (onReset) onReset();
    else { interaction.begin(); interaction.update(resetValue); interaction.end(); }
  };
  const move = (input: HTMLInputElement, x: number) => {
    const bounds = input.getBoundingClientRect();
    // Native thumbs travel within their own radius, not across the input edges.
    const thumb = parseFloat(getComputedStyle(input).getPropertyValue('--ui-slider-thumb-size')) || 18;
    interaction.update(sliderValueAtPosition(x, bounds.left + thumb / 2, Math.max(0, bounds.width - thumb), min, max, step));
  };
  const finish = () => { pointer.current = null; keyboard.current = false; interaction.end(); };
  React.useEffect(() => { if (disabled) finish(); }, [disabled]);
  const track = <div className="ui-slider__track" data-transparency={transparency || undefined}
    style={{ '--ui-slider-position': `${percentage(display)}%`, '--ui-slider-neutral': percentage(resetValue) / 100,
      ...(trackBackground ? { '--ui-slider-background': trackBackground } : {}) } as React.CSSProperties}>
    {showResetMarker && <span className="ui-slider__neutral" aria-hidden="true" />}
    <input id={id} type="range" min={min} max={max} step={step} value={display}
      disabled={disabled || max <= min} tabIndex={tabIndex} aria-label={ariaLabel ?? label} aria-valuetext={format(display)}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || pointer.current !== null) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        pointer.current = event.pointerId;
        interaction.begin();
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.currentTarget, event.clientX);
      }}
      onPointerMove={event => { if (pointer.current === event.pointerId) move(event.currentTarget, event.clientX); }}
      onPointerUp={event => { if (pointer.current === event.pointerId) { move(event.currentTarget, event.clientX); finish(); } }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={event => {
        if (!sliderEditKeys.has(event.key)) return;
        event.preventDefault();
        if (!keyboard.current) { keyboard.current = true; interaction.begin(); }
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown' ? -1 : 1;
        const delta = step * direction * (event.key.startsWith('Page') ? 10 : 1);
        interaction.update(event.key === 'Home' ? min : event.key === 'End' ? max
          : Math.min(max, Math.max(min, Number((interaction.latest.current + delta).toFixed(10)))));
      }}
      onKeyUp={event => { if (sliderEditKeys.has(event.key)) finish(); }} onBlur={() => { if (keyboard.current) finish(); }}
      onChange={event => {
        if (pointer.current !== null) return;
        const discrete = !keyboard.current;
        if (discrete) interaction.begin();
        interaction.update(Number(event.currentTarget.value));
        if (discrete) interaction.end();
      }} onDragStart={event => event.preventDefault()} />
  </div>;
  return <div className={`ui-slider${field ? ' ui-slider-field' : ''}${className ? ` ${className}` : ''}`}
    data-ui-component={field ? 'slider-field' : 'slider'} data-suite-control="adjustment-slider" data-layout={field?.layout ?? 'stacked'}
    data-size={field?.size ?? 'regular'} data-disabled={disabled || undefined}>
    {field && <>
      <label htmlFor={id} className="ui-slider__label" title={resetModifierActive ? `Reset ${label}` : label} onDoubleClick={reset}
        onClick={event => { if (event.shiftKey || resetModifierActive) { event.preventDefault(); reset(); } }}>{label}</label>
      <output htmlFor={id} className="ui-slider__value" onDoubleClick={reset}
        onClick={event => { if (event.shiftKey || resetModifierActive) reset(); }}>{format(display)}</output>
    </>}
    {track}
  </div>;
}
export const Slider = (props: SliderProps) => <SliderControl {...props} />;
export const SliderField = ({ layout = 'stacked', size = 'regular', ...props }: SliderFieldProps) =>
  <SliderControl {...props} field={{ layout, size }} />;
