import React from 'react';

interface GradientFieldColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface GradientFieldValue {
  readonly colorStops: readonly {
    readonly position: number;
    readonly color: GradientFieldColor;
  }[];
  readonly opacityStops: readonly {
    readonly position: number;
    readonly opacity: number;
  }[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const byte = (value: number) => Math.round(clamp01(value) * 255);

const sampleColor = (gradient: GradientFieldValue, position: number): GradientFieldColor => {
  const stops = [...gradient.colorStops].sort((left, right) => left.position - right.position);
  const upperIndex = stops.findIndex((stop) => stop.position >= position);
  if (upperIndex <= 0) return stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  if (upperIndex < 0) return stops.at(-1)?.color ?? { r: 1, g: 1, b: 1, a: 1 };
  const lower = stops[upperIndex - 1]!;
  const upper = stops[upperIndex]!;
  const amount = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  return {
    r: lower.color.r + (upper.color.r - lower.color.r) * amount,
    g: lower.color.g + (upper.color.g - lower.color.g) * amount,
    b: lower.color.b + (upper.color.b - lower.color.b) * amount,
    a: lower.color.a + (upper.color.a - lower.color.a) * amount
  };
};

const sampleOpacity = (gradient: GradientFieldValue, position: number) => {
  const stops = [...gradient.opacityStops].sort((left, right) => left.position - right.position);
  const upperIndex = stops.findIndex((stop) => stop.position >= position);
  if (upperIndex <= 0) return stops[0]?.opacity ?? 1;
  if (upperIndex < 0) return stops.at(-1)?.opacity ?? 1;
  const lower = stops[upperIndex - 1]!;
  const upper = stops[upperIndex]!;
  const amount = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  return lower.opacity + (upper.opacity - lower.opacity) * amount;
};

export const gradientFieldBackground = (gradient: GradientFieldValue) => {
  const positions = [...new Set([
    ...gradient.colorStops.map((stop) => clamp01(stop.position)),
    ...gradient.opacityStops.map((stop) => clamp01(stop.position))
  ])].sort((left, right) => left - right);
  const stops = (positions.length ? positions : [0, 1]).map((position) => {
    const color = sampleColor(gradient, position);
    const alpha = clamp01(color.a * sampleOpacity(gradient, position));
    return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${alpha.toFixed(3)}) ${(position * 100).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
};

export interface GradientFieldProps {
  readonly value: GradientFieldValue;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly expanded?: boolean;
  readonly onClick: () => void;
}

/** Canonical compact paint-field trigger for every LightTable gradient editor. */
export const GradientField = React.forwardRef<HTMLButtonElement, GradientFieldProps>(
  ({ value, ariaLabel, title = ariaLabel, expanded = false, onClick }, ref) => (
    <button ref={ref} type="button" className="gradient-field"
      aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={expanded}
      title={title} onClick={onClick}>
      <span className="gradient-field__ramp"
        style={{ '--ui-gradient-field': gradientFieldBackground(value) } as React.CSSProperties}
        aria-hidden="true" />
      <span className="gradient-field__arrow" aria-hidden="true" />
    </button>
  )
);

GradientField.displayName = 'GradientField';
