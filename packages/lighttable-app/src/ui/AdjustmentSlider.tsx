import React from 'react';

export type AdjustmentSliderTrack =
  | 'luminance'
  | 'temperature'
  | 'tint'
  | 'vibrance'
  | 'saturation'
  | 'hue'
  | 'cyan-red'
  | 'magenta-green'
  | 'yellow-blue'
  | 'red-cyan'
  | 'green-magenta'
  | 'blue-yellow'
  | 'white-black';

const TRACK_BACKGROUNDS: Record<AdjustmentSliderTrack, string> = {
  luminance: 'linear-gradient(to right, #545960 0%, #f2f4f6 100%)',
  temperature: 'linear-gradient(to right, #4456d9 0%, #57a7d6 28%, #a6a8a3 52%, #d7c75b 76%, #f1ea35 100%)',
  tint: 'linear-gradient(to right, #38a35a 0%, #7ca777 30%, #9c969b 52%, #b45a9d 76%, #d638aa 100%)',
  vibrance: 'linear-gradient(to right, #536a91 0%, #4e9684 28%, #a1a471 55%, #d5a249 77%, #d54d54 100%)',
  saturation: 'linear-gradient(to right, #626870 0%, #4d79b8 20%, #4da882 42%, #d1b34e 70%, #d84b50 100%)',
  hue: 'linear-gradient(to right, #f33 0%, #ff0 16.67%, #0f6 33.33%, #0df 50%, #35f 66.67%, #f3c 83.33%, #f33 100%)',
  'cyan-red': 'linear-gradient(to right, #25aeb9 0%, #777c82 50%, #d94f56 100%)',
  'magenta-green': 'linear-gradient(to right, #c84ba5 0%, #777c82 50%, #48a45e 100%)',
  'yellow-blue': 'linear-gradient(to right, #d8bd42 0%, #777c82 50%, #4c6fd1 100%)',
  'red-cyan': 'linear-gradient(to right, #d94f56 0%, #777c82 50%, #25aeb9 100%)',
  'green-magenta': 'linear-gradient(to right, #48a45e 0%, #777c82 50%, #c84ba5 100%)',
  'blue-yellow': 'linear-gradient(to right, #4c6fd1 0%, #777c82 50%, #d8bd42 100%)',
  'white-black': 'linear-gradient(to right, #f2f4f6 0%, #777c82 50%, #1b1d20 100%)'
};

export interface AdjustmentSliderProps {
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  resetValue?: number;
  track?: AdjustmentSliderTrack;
  trackBackground?: string;
  layout?: 'stacked' | 'inline' | 'bare' | 'layer-row' | 'tool-bar' | 'tool-panel';
  density?: 'default' | 'spaced' | 'compact';
  showResetMarker?: boolean;
  disabled?: boolean;
  /** Maximum publication cadence for expensive consumers; the thumb remains pointer-rate. */
  publishIntervalMs?: number;
  resetModifierActive?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const RANGE_EDIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
// Keep the native control responsive on lower-power GPUs. The thumb and label
// update locally at pointer speed, while expensive React/WebGPU work is
// coalesced to an interactive preview rate. The final value is always flushed.
const INTERACTION_PUBLISH_INTERVAL_MS = 33;

export const adjustmentSliderValueAtPosition = (
  clientX: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number
) => {
  const ratio = width > 0 ? Math.min(1, Math.max(0, (clientX - left) / width)) : 0;
  const raw = min + ratio * (max - min);
  const increment = Number.isFinite(step) && step > 0 ? step : 1;
  const snapped = min + Math.round((raw - min) / increment) * increment;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(10))));
};

export const AdjustmentSlider: React.FC<AdjustmentSliderProps> = ({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  format = (current) => String(Math.round(current)),
  resetValue = 0,
  track,
  trackBackground: customTrackBackground,
  layout = 'stacked',
  density = 'default',
  showResetMarker = true,
  disabled = false,
  publishIntervalMs = INTERACTION_PUBLISH_INTERVAL_MS,
  resetModifierActive = false,
  onChange,
  onReset,
  onInteractionStart,
  onInteractionEnd
}) => {
  const activePointerRef = React.useRef<number | null>(null);
  const keyboardInteractionRef = React.useRef(false);
  const [displayValue, setDisplayValue] = React.useState(value);
  const latestValueRef = React.useRef(value);
  const publishedValueRef = React.useRef(value);
  const lastPublishTimeRef = React.useRef(0);
  const publishTimerRef = React.useRef<number | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onInteractionStartRef = React.useRef(onInteractionStart);
  const onInteractionEndRef = React.useRef(onInteractionEnd);
  const publishIntervalRef = React.useRef(publishIntervalMs);
  onChangeRef.current = onChange;
  onInteractionStartRef.current = onInteractionStart;
  onInteractionEndRef.current = onInteractionEnd;
  publishIntervalRef.current = Math.max(0, publishIntervalMs);

  const cancelScheduledPublish = React.useCallback(() => {
    if (publishTimerRef.current === null) return;
    window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = null;
  }, []);

  const publishLatestValue = React.useCallback((force = false) => {
    if (!force && latestValueRef.current === publishedValueRef.current) return;
    cancelScheduledPublish();
    const next = latestValueRef.current;
    publishedValueRef.current = next;
    lastPublishTimeRef.current = performance.now();
    onChangeRef.current(next);
  }, [cancelScheduledPublish]);

  const scheduleValuePublish = React.useCallback(() => {
    const elapsed = performance.now() - lastPublishTimeRef.current;
    const interval = publishIntervalRef.current;
    if (elapsed >= interval) {
      publishLatestValue();
      return;
    }
    if (publishTimerRef.current !== null) return;
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      publishLatestValue();
    }, interval - elapsed);
  }, [publishLatestValue]);

  const finishPointerInteraction = React.useCallback((pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    publishLatestValue(true);
    onInteractionEndRef.current?.();
  }, [publishLatestValue]);

  const updateFromPointer = React.useCallback((input: HTMLInputElement, clientX: number) => {
    const bounds = input.getBoundingClientRect();
    const next = adjustmentSliderValueAtPosition(
      clientX,
      bounds.left,
      bounds.width,
      min,
      max,
      step
    );
    latestValueRef.current = next;
    setDisplayValue(next);
    scheduleValuePublish();
  }, [max, min, scheduleValuePublish, step]);

  React.useEffect(() => {
    if (activePointerRef.current !== null || keyboardInteractionRef.current) return;
    latestValueRef.current = value;
    publishedValueRef.current = value;
    setDisplayValue(value);
  }, [value]);

  React.useEffect(() => () => {
      cancelScheduledPublish();
  }, [cancelScheduledPublish]);

  const percentage = ((displayValue - min) / (max - min)) * 100;
  const neutral = Math.min(100, Math.max(0, ((resetValue - min) / (max - min)) * 100));
  const trackBackground = customTrackBackground ?? (track
    ? TRACK_BACKGROUNDS[track]
    : `linear-gradient(to right, var(--lt-range-track-fill) 0%, var(--lt-range-track-fill) ${percentage}%, var(--lt-range-track) ${percentage}%, var(--lt-range-track) 100%)`);
  return (
    <label className={`lighttable-adjustment lighttable-adjustment--${layout} lighttable-adjustment--density-${density}${disabled ? ' lighttable-adjustment--disabled' : ''}`}
      data-suite-control="adjustment-slider" data-suite-variant={`${layout}:${density}`}>
      {layout !== 'bare' ? <span
        className="lighttable-adjustment__header"
        title={resetModifierActive ? `Reset ${label}` : label}
        onPointerDown={(event) => {
          // Pointer-down makes modifier-reset deterministic even when the
          // browser synthesizes a later label click without modifier flags.
          if (event.button === 0 && !disabled && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }
        }}
        onClick={(event) => {
          if (!disabled && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }
        }}
        onDoubleClick={(event) => {
          if (!disabled) {
            event.preventDefault();
            onReset();
          }
        }}
      >
        <span>{label}</span>
        <output>{format(displayValue)}</output>
      </span> : null}
      <span className="lighttable-adjustment__track-wrap">
        <span
          className="lighttable-adjustment__track-axis"
          style={{ ['--lighttable-slider-track' as string]: trackBackground }}
          aria-hidden="true"
        >
          {showResetMarker ? (
            <span className="lighttable-adjustment__neutral" style={{ left: `${neutral}%` }} />
          ) : null}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          disabled={disabled}
          onPointerDown={(event) => {
            if (
              event.button !== 0
              || !event.isPrimary
              || activePointerRef.current !== null
            ) return;
            // Pointer editing is explicit so native range dragging, React's
            // controlled value and pointer capture have only one writer.
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            activePointerRef.current = event.pointerId;
            onInteractionStartRef.current?.();
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromPointer(event.currentTarget, event.clientX);
          }}
          onPointerMove={(event) => {
            if (activePointerRef.current === event.pointerId) {
              updateFromPointer(event.currentTarget, event.clientX);
            }
          }}
          onPointerUp={(event) => {
            if (activePointerRef.current !== event.pointerId) return;
            updateFromPointer(event.currentTarget, event.clientX);
            finishPointerInteraction(event.pointerId);
          }}
          onPointerCancel={(event) => finishPointerInteraction(event.pointerId)}
          onLostPointerCapture={(event) => finishPointerInteraction(event.pointerId)}
          onKeyDown={(event) => {
            if (RANGE_EDIT_KEYS.has(event.key) && !keyboardInteractionRef.current) {
              keyboardInteractionRef.current = true;
              onInteractionStartRef.current?.();
            }
          }}
          onKeyUp={(event) => {
            if (RANGE_EDIT_KEYS.has(event.key) && keyboardInteractionRef.current) {
              keyboardInteractionRef.current = false;
              publishLatestValue(true);
              onInteractionEndRef.current?.();
            }
          }}
          onBlur={() => {
            if (keyboardInteractionRef.current) {
              keyboardInteractionRef.current = false;
              publishLatestValue(true);
              onInteractionEndRef.current?.();
            }
          }}
          onDragStart={(event) => event.preventDefault()}
          // React still uses `onChange` to classify a controlled range as
          // editable. Continuous native range updates arrive through input;
          // Chromium/WebKit may defer change until pointer-up.
          onChange={() => undefined}
          onInput={(event) => {
            // Pointer values come from updateFromPointer. Native input remains
            // available for keyboard and assistive-technology edits.
            if (activePointerRef.current !== null) return;
            const next = Number(event.currentTarget.value);
            latestValueRef.current = next;
            setDisplayValue(next);
            if (keyboardInteractionRef.current) {
              scheduleValuePublish();
            } else {
              onInteractionStartRef.current?.();
              publishLatestValue(true);
              onInteractionEndRef.current?.();
            }
          }}
          aria-label={ariaLabel ?? label}
        />
      </span>
    </label>
  );
};
