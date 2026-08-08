import React from 'react';
import { lightTableIcon } from '../assets/icons';

interface EyeDropperResult {
  readonly sRGBHex: string;
}

interface EyeDropperInstance {
  open(): Promise<EyeDropperResult>;
}

type EyeDropperConstructor = new () => EyeDropperInstance;

/** Uses Chromium's user-gesture eyedropper without introducing feature-local color state. */
export const sampleScreenColor = async (): Promise<string | null> => {
  const EyeDropper = (globalThis as typeof globalThis & {
    EyeDropper?: EyeDropperConstructor;
  }).EyeDropper;
  if (!EyeDropper) return null;
  try {
    const result = await new EyeDropper().open();
    return /^#[0-9a-f]{6}$/i.test(result.sRGBHex) ? result.sRGBHex.toLowerCase() : null;
  } catch {
    // Escape and choosing outside the sampler are normal cancellation paths.
    return null;
  }
};

export interface ColorSwatchFieldProps {
  readonly value: string;
  readonly ariaLabel: string;
  readonly size?: 'regular' | 'compact';
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onInteractionStart?: () => void;
  readonly onInteractionCommit?: () => void;
  readonly onInteractionCancel?: () => void;
}

/** Canonical solid-color editor: one value shared by manual and sampled input. */
export const ColorSwatchField: React.FC<ColorSwatchFieldProps> = ({
  value,
  ariaLabel,
  size = 'regular',
  disabled = false,
  onChange,
  onInteractionStart,
  onInteractionCommit,
  onInteractionCancel
}) => {
  const [sampling, setSampling] = React.useState(false);

  const sample = async () => {
    if (disabled || sampling) return;
    setSampling(true);
    onInteractionStart?.();
    const sampled = await sampleScreenColor();
    setSampling(false);
    if (!sampled) {
      onInteractionCancel?.();
      return;
    }
    onChange(sampled);
    onInteractionCommit?.();
  };

  return (
    <span className={`color-swatch-field color-swatch-field--${size}`}>
      <label className="color-swatch-field__well" style={{ backgroundColor: value }}>
        <input type="color" value={value} disabled={disabled} aria-label={ariaLabel}
          onFocus={onInteractionStart}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onInteractionCommit}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !onInteractionCancel) return;
            event.preventDefault();
            onInteractionCancel();
            event.currentTarget.blur();
          }} />
      </label>
      <button type="button" className="color-swatch-field__sampler"
        disabled={disabled || sampling} aria-label={`Sample ${ariaLabel.toLowerCase()}`}
        title={`Sample ${ariaLabel.toLowerCase()}`} onClick={() => void sample()}>
        <img src={lightTableIcon('tool_sample_color.png')} alt="" aria-hidden="true" />
      </button>
    </span>
  );
};
