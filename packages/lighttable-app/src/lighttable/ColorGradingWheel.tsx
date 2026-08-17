import React, { useRef } from 'react';

interface ColorGradingWheelProps {
  label: string;
  hue: number;
  saturation: number;
  luminance: number;
  disabled?: boolean;
  compact?: boolean;
  resetModifierActive?: boolean;
  onChange: (hue: number, saturation: number) => void;
  onReset: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const normalizeHue = (value: number) => ((value % 360) + 360) % 360;

export const ColorGradingWheel: React.FC<ColorGradingWheelProps> = ({
  label,
  hue,
  saturation,
  luminance,
  disabled = false,
  compact = false,
  resetModifierActive = false,
  onChange,
  onReset,
  onInteractionStart,
  onInteractionEnd
}) => {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [preview, setPreview] = React.useState<{ hue: number; saturation: number } | null>(null);
  const presentedHue = preview?.hue ?? hue;
  const presentedSaturation = preview?.saturation ?? saturation;
  const radius = clamp(presentedSaturation, 0, 100) / 100;
  const angle = (normalizeHue(presentedHue) * Math.PI) / 180;
  // OKLab hue grows from red toward yellow. Screen Y grows downward, so the
  // visual wheel must invert Y to match Lightroom's counter-clockwise layout.
  const pointerX = Math.cos(angle);
  const pointerY = -Math.sin(angle);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const bounds = wheelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const half = Math.min(bounds.width, bounds.height) / 2;
    const x = (clientX - (bounds.left + bounds.width / 2)) / half;
    const y = (clientY - (bounds.top + bounds.height / 2)) / half;
    const nextRadius = clamp(Math.hypot(x, y), 0, 1);
    const nextHue = nextRadius < 0.001
      ? presentedHue
      : normalizeHue((Math.atan2(-y, x) * 180) / Math.PI);
    setPreview({ hue: nextHue, saturation: nextRadius * 100 });
    onChange(nextHue, nextRadius * 100);
  };

  return (
    <div className={`lighttable-grading-wheel${compact ? ' lighttable-grading-wheel--compact' : ''}${disabled ? ' lighttable-grading-wheel--disabled' : ''}`}>
      <div
        className="lighttable-grading-wheel__label"
        title={resetModifierActive ? `Reset ${label}` : label}
        onPointerDown={(event) => {
          if (event.button === 0 && !disabled && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            onReset();
          }
        }}
      >
        <strong>{label}</strong>
        <span>H:{Math.round(normalizeHue(presentedHue))} S:{Math.round(presentedSaturation)} L:{Math.round(luminance)}</span>
      </div>
      <div
        ref={wheelRef}
        className="lighttable-grading-wheel__disc"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} color tint`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(presentedSaturation)}
        aria-valuetext={`${Math.round(presentedHue)} degrees, ${Math.round(presentedSaturation)} percent`}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          if (event.shiftKey || resetModifierActive) {
            event.preventDefault();
            onReset();
            return;
          }
          pointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          onInteractionStart();
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current === event.pointerId) updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (pointerIdRef.current !== event.pointerId) return;
          pointerIdRef.current = null;
          onInteractionEnd();
          setPreview(null);
        }}
        onPointerCancel={(event) => {
          if (pointerIdRef.current !== event.pointerId) return;
          pointerIdRef.current = null;
          onInteractionEnd();
          setPreview(null);
        }}
        onDoubleClick={(event) => {
          if (!disabled) {
            event.preventDefault();
            onReset();
          }
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          let nextHue = presentedHue;
          let nextSaturation = presentedSaturation;
          if (event.key === 'ArrowLeft') nextHue -= event.shiftKey ? 10 : 1;
          else if (event.key === 'ArrowRight') nextHue += event.shiftKey ? 10 : 1;
          else if (event.key === 'ArrowDown') nextSaturation -= event.shiftKey ? 10 : 1;
          else if (event.key === 'ArrowUp') nextSaturation += event.shiftKey ? 10 : 1;
          else if (event.key === 'Home') nextSaturation = 0;
          else return;
          event.preventDefault();
          onInteractionStart();
          setPreview({ hue: normalizeHue(nextHue), saturation: clamp(nextSaturation, 0, 100) });
          onChange(normalizeHue(nextHue), clamp(nextSaturation, 0, 100));
        }}
        onKeyUp={() => { onInteractionEnd(); setPreview(null); }}
        onBlur={() => { onInteractionEnd(); setPreview(null); }}
      >
        <span className="lighttable-grading-wheel__guide" aria-hidden="true" />
        <span
          className="lighttable-grading-wheel__hue-marker"
          style={{
            left: `${50 + pointerX * 56}%`,
            top: `${50 + pointerY * 56}%`,
            backgroundColor: `hsl(${normalizeHue(presentedHue)} 100% 55%)`
          }}
          aria-hidden="true"
        />
        <span
          className="lighttable-grading-wheel__handle"
          style={{
            left: `${50 + pointerX * radius * 50}%`,
            top: `${50 + pointerY * radius * 50}%`,
            backgroundColor: radius > 0.015 ? `hsl(${normalizeHue(presentedHue)} ${Math.max(18, presentedSaturation)}% 58%)` : undefined
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};
