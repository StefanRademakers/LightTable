import React, { useRef } from 'react';
import { sliderValueAtPosition, useSliderInteraction } from './useSliderInteraction';

export interface RangeSliderProps {
  label: string;
  values: readonly number[];
  labels: readonly string[];
  min: number;
  max: number;
  step?: number | readonly number[];
  disabled?: boolean;
  tabIndex?: number;
  trackBackground?: string;
  publishIntervalMs?: number | 'animation-frame';
  getBounds?: (index: number, values: readonly number[]) => { min: number; max: number };
  /** Domain-specific coupling stays with the consumer (for example Levels gamma). */
  resolveValues?: (values: readonly number[], index: number, previous: readonly number[]) => readonly number[];
  renderValues?: (values: readonly number[]) => React.ReactNode;
  onChange: (values: readonly number[], index: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}
export function RangeSlider({ label, values, labels, min, max, step = 1, disabled = false,
  tabIndex = -1, trackBackground, publishIntervalMs = 'animation-frame', getBounds, resolveValues, renderValues,
  onChange, onInteractionStart, onInteractionEnd }: RangeSliderProps) {
  const pointer = useRef<number | null>(null);
  const indexRef = useRef(0);
  const interaction = useSliderInteraction(values, {
    onChange: next => onChange(next, indexRef.current), onInteractionStart, onInteractionEnd, publishIntervalMs
  });
  const increment = (index: number) => typeof step === 'number' ? step : step[index] ?? 1;
  const bounds = (index: number) => getBounds?.(index, interaction.latest.current) ?? {
    min: index === 0 ? min : interaction.latest.current[index - 1]!,
    max: index === values.length - 1 ? max : interaction.latest.current[index + 1]!
  };
  const update = (index: number, raw: number) => {
    const limits = bounds(index);
    const previous = interaction.latest.current;
    const next = previous.map((value, i) => i === index ? Math.min(limits.max, Math.max(limits.min, raw)) : value);
    interaction.update(resolveValues?.(next, index, previous) ?? next);
  };
  const move = (element: HTMLElement, x: number, index: number) => {
    const track = element.parentElement!;
    const rect = track.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(track).getPropertyValue('--ui-slider-thumb-size')) || 18;
    update(index, sliderValueAtPosition(x, rect.left + thumb / 2, Math.max(0, rect.width - thumb), min, max, increment(index)));
  };
  const end = () => { pointer.current = null; interaction.end(); };
  React.useEffect(() => { if (disabled) end(); }, [disabled]);
  return <div className="ui-slider ui-range-slider" data-ui-component="range-slider" data-suite-control="range-slider" data-disabled={disabled || undefined}>
    <span className="ui-slider__label">{label}</span>
    <div className="ui-slider__track" style={{ '--ui-slider-position': '0%',
      ...(trackBackground ? { '--ui-slider-background': trackBackground } : {}) } as React.CSSProperties}>
      {interaction.display.map((value, index) => {
        const range = bounds(index);
        const position = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
        return <button key={labels[index] ?? index} type="button" className="ui-range-slider__handle"
          role="slider" aria-label={labels[index]} aria-valuenow={value} aria-valuemin={range.min} aria-valuemax={range.max}
          disabled={disabled || max <= min} tabIndex={tabIndex}
          style={{ '--ui-range-position': position } as React.CSSProperties}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary || pointer.current !== null) return;
            event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
            indexRef.current = index; pointer.current = event.pointerId; interaction.begin();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => { if (pointer.current === event.pointerId) move(event.currentTarget, event.clientX, index); }}
          onPointerUp={event => { if (pointer.current === event.pointerId) { move(event.currentTarget, event.clientX, index); end(); } }}
          onPointerCancel={end} onLostPointerCapture={end}
          onKeyDown={event => {
            const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[event.key];
            if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault(); indexRef.current = index; interaction.begin();
            update(index, event.key === 'Home' ? range.min : event.key === 'End' ? range.max : interaction.latest.current[index]! + delta! * increment(index));
          }} onKeyUp={event => { if (['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)) end(); }}
          onBlur={end} />;
      })}
    </div>
    {renderValues && <div className="ui-range-slider__values">{renderValues(interaction.display)}</div>}
  </div>;
}
