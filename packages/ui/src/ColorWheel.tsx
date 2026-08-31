import React, { useMemo, useRef } from 'react';
import { useSliderInteraction } from './useSliderInteraction';

export interface ColorWheelProps {
  label: string;
  hue: number;
  saturation: number;
  luminance?: number;
  disabled?: boolean;
  compact?: boolean;
  tabIndex?: number;
  resetModifierActive?: boolean;
  publishIntervalMs?: number | 'animation-frame';
  onChange: (hue: number, saturation: number) => void;
  onReset?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const normalizeHue = (value: number) => ((value % 360) + 360) % 360;

/** Hue/saturation picker; document transactions and luminance remain host-owned. */
export function ColorWheel({ label, hue, saturation, luminance, disabled = false, compact = false,
  tabIndex = -1, resetModifierActive = false, publishIntervalMs = 0, onChange, onReset,
  onInteractionStart, onInteractionEnd }: ColorWheelProps) {
  const value = useMemo(() => ({ hue, saturation }), [hue, saturation]);
  const interaction = useSliderInteraction(value, {
    onChange: next => onChange(next.hue, next.saturation), onInteractionStart, onInteractionEnd, publishIntervalMs
  });
  const pointer = useRef<number | null>(null);
  const finish = () => { pointer.current = null; interaction.end(); };
  React.useEffect(() => { if (disabled) finish(); }, [disabled]);
  const shown = interaction.display;
  const radius = clamp(shown.saturation) / 100;
  const angle = normalizeHue(shown.hue) * Math.PI / 180;
  const x = Math.cos(angle), y = -Math.sin(angle);
  const move = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    const half = Math.min(bounds.width, bounds.height) / 2;
    if (!half) return;
    const dx = (clientX - bounds.left - bounds.width / 2) / half;
    const dy = (clientY - bounds.top - bounds.height / 2) / half;
    const r = Math.min(1, Math.hypot(dx, dy));
    interaction.update({ hue: r < 0.001 ? interaction.latest.current.hue : normalizeHue(Math.atan2(-dy, dx) * 180 / Math.PI), saturation: r * 100 });
  };
  return <div className="ui-color-wheel" data-ui-component="color-wheel" data-suite-control="color-wheel"
    data-compact={compact || undefined} data-disabled={disabled || undefined}>
    <div className="ui-color-wheel__label" title={resetModifierActive ? `Reset ${label}` : label}
      onPointerDown={event => {
        if (!disabled && event.button === 0 && (event.shiftKey || resetModifierActive) && onReset) { event.preventDefault(); onReset(); }
      }}>
      <strong>{label}</strong>
      <span>H:{Math.round(normalizeHue(shown.hue))} S:{Math.round(shown.saturation)}{luminance === undefined ? '' : ` L:${Math.round(luminance)}`}</span>
    </div>
    <div className="ui-color-wheel__disc" role="slider" tabIndex={disabled ? -1 : tabIndex}
      aria-label={`${label} color tint`} aria-disabled={disabled || undefined}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown.saturation)}
      aria-valuetext={`${Math.round(shown.hue)} degrees, ${Math.round(shown.saturation)} percent`}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        if ((event.shiftKey || resetModifierActive) && onReset) { onReset(); return; }
        pointer.current = event.pointerId;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        interaction.begin(); move(event.currentTarget, event.clientX, event.clientY);
      }}
      onPointerMove={event => { if (pointer.current === event.pointerId) move(event.currentTarget, event.clientX, event.clientY); }}
      onPointerUp={event => { if (pointer.current === event.pointerId) { move(event.currentTarget, event.clientX, event.clientY); finish(); } }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={event => { if (!disabled && onReset) { event.preventDefault(); onReset(); } }}
      onKeyDown={event => {
        if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        const current = interaction.latest.current;
        interaction.begin();
        interaction.update({
          hue: normalizeHue(current.hue + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
          saturation: event.key === 'Home' ? 0 : clamp(current.saturation + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0))
        });
      }}
      onKeyUp={event => { if (event.key.startsWith('Arrow') || event.key === 'Home') { event.stopPropagation(); finish(); } }}
      onBlur={finish}>
      <span className="ui-color-wheel__guide" aria-hidden="true" />
      <span className="ui-color-wheel__hue-marker" aria-hidden="true"
        style={{ left: `${50 + x * 56}%`, top: `${50 + y * 56}%`, backgroundColor: `hsl(${normalizeHue(shown.hue)} 100% 55%)` }} />
      <span className="ui-color-wheel__handle" aria-hidden="true"
        style={{ left: `${50 + x * radius * 50}%`, top: `${50 + y * radius * 50}%`,
          backgroundColor: radius > 0.015 ? `hsl(${normalizeHue(shown.hue)} ${Math.max(18, shown.saturation)}% 58%)` : undefined }} />
    </div>
  </div>;
}
