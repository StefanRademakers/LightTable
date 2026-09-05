import React, { useRef } from 'react';
import { useSliderInteraction } from './useSliderInteraction';

export interface ColorAreaValue { s: number; v: number }
export interface ColorAreaProps {
  hue: number;
  value: ColorAreaValue;
  onChange: (value: ColorAreaValue) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onInteractionCancel?: () => void;
  publishIntervalMs?: number | 'animation-frame';
  tabIndex?: number;
  disabled?: boolean;
}
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Saturation/value plane. The marker moves immediately; previews use the shared scheduler. */
export function ColorArea({ hue, value, tabIndex = -1, disabled = false, ...interactionProps }: ColorAreaProps) {
  const interaction = useSliderInteraction(value, interactionProps);
  const pointer = useRef<number | null>(null);
  const move = (element: HTMLElement, x: number, y: number) => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    interaction.update({ s: clamp((x - bounds.left) / bounds.width), v: 1 - clamp((y - bounds.top) / bounds.height) });
  };
  const finish = () => { pointer.current = null; interaction.end(); };
  const cancel = () => { pointer.current = null; interaction.cancel(); };
  React.useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const { s, v } = interaction.display;
  return <div className="ui-color-area" data-ui-component="color-area" role="slider"
    aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s * 100)}
    aria-valuetext={`${Math.round(s * 100)}% saturation, ${Math.round(v * 100)}% brightness`}
    aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : tabIndex}
    style={{ '--ui-color-area-hue': `hsl(${hue} 100% 50%)` } as React.CSSProperties}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || pointer.current !== null) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      pointer.current = event.pointerId; interaction.begin();
      event.currentTarget.setPointerCapture(event.pointerId);
      move(event.currentTarget, event.clientX, event.clientY);
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) move(event.currentTarget, event.clientX, event.clientY); }}
    onPointerUp={event => { if (pointer.current === event.pointerId) { move(event.currentTarget, event.clientX, event.clientY); finish(); } }}
    onPointerCancel={cancel}
    onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
    onKeyDown={event => {
      if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 0.1 : 0.01;
      const current = interaction.latest.current;
      interaction.begin();
      interaction.update({ s: clamp(current.s + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
        v: clamp(current.v + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0)) });
    }}
    onKeyUp={event => { if (event.key.startsWith('Arrow')) { event.stopPropagation(); finish(); } }} onBlur={finish}>
    <span className="ui-color-area__marker" aria-hidden="true" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
  </div>;
}
