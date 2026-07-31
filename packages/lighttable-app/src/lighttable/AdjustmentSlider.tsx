import React from 'react';

export type AdjustmentSliderTrack = 'luminance' | 'temperature' | 'tint' | 'vibrance' | 'saturation';

const TRACK_BACKGROUNDS: Record<AdjustmentSliderTrack, string> = {
  luminance: 'linear-gradient(to right, #545960 0%, #f2f4f6 100%)',
  temperature: 'linear-gradient(to right, #4456d9 0%, #57a7d6 28%, #a6a8a3 52%, #d7c75b 76%, #f1ea35 100%)',
  tint: 'linear-gradient(to right, #38a35a 0%, #7ca777 30%, #9c969b 52%, #b45a9d 76%, #d638aa 100%)',
  vibrance: 'linear-gradient(to right, #536a91 0%, #4e9684 28%, #a1a471 55%, #d5a249 77%, #d54d54 100%)',
  saturation: 'linear-gradient(to right, #626870 0%, #4d79b8 20%, #4da882 42%, #d1b34e 70%, #d84b50 100%)'
};

interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  resetValue?: number;
  track?: AdjustmentSliderTrack;
  trackBackground?: string;
  disabled?: boolean;
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

export const AdjustmentSlider: React.FC<AdjustmentSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  format = (current) => String(Math.round(current)),
  resetValue = 0,
  track,
  trackBackground: customTrackBackground,
  disabled = false,
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
  const pointerGuardCleanupRef = React.useRef<(() => void) | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onInteractionStartRef = React.useRef(onInteractionStart);
  const onInteractionEndRef = React.useRef(onInteractionEnd);
  onChangeRef.current = onChange;
  onInteractionStartRef.current = onInteractionStart;
  onInteractionEndRef.current = onInteractionEnd;

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
    if (elapsed >= INTERACTION_PUBLISH_INTERVAL_MS) {
      publishLatestValue();
      return;
    }
    if (publishTimerRef.current !== null) return;
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      publishLatestValue();
    }, INTERACTION_PUBLISH_INTERVAL_MS - elapsed);
  }, [publishLatestValue]);

  const finishPointerInteraction = React.useCallback((pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    pointerGuardCleanupRef.current?.();
    pointerGuardCleanupRef.current = null;
    publishLatestValue(true);
    onInteractionEndRef.current?.();
  }, [publishLatestValue]);

  const installPointerGuards = React.useCallback((pointerId: number) => {
    pointerGuardCleanupRef.current?.();
    const finishWindowPointer = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finishPointerInteraction(pointerId);
    };
    const finishOnWindowBlur = () => finishPointerInteraction(pointerId);
    const cleanup = () => {
      window.removeEventListener('pointerup', finishWindowPointer, true);
      window.removeEventListener('pointercancel', finishWindowPointer, true);
      window.removeEventListener('blur', finishOnWindowBlur);
    };

    // Pointer capture normally supplies pointerup itself. These listeners are
    // installed only for the active control as a safety net for browser/window
    // transitions and DOM reparenting while a dockable panel is moving.
    window.addEventListener('pointerup', finishWindowPointer, true);
    window.addEventListener('pointercancel', finishWindowPointer, true);
    window.addEventListener('blur', finishOnWindowBlur);
    pointerGuardCleanupRef.current = cleanup;
  }, [finishPointerInteraction]);

  React.useEffect(() => {
    if (activePointerRef.current !== null || keyboardInteractionRef.current) return;
    latestValueRef.current = value;
    publishedValueRef.current = value;
    setDisplayValue(value);
  }, [value]);

  React.useEffect(() => () => {
      pointerGuardCleanupRef.current?.();
      pointerGuardCleanupRef.current = null;
      cancelScheduledPublish();
  }, [cancelScheduledPublish]);

  const percentage = ((displayValue - min) / (max - min)) * 100;
  const neutral = Math.min(100, Math.max(0, ((resetValue - min) / (max - min)) * 100));
  const trackBackground = customTrackBackground ?? (track
    ? TRACK_BACKGROUNDS[track]
    : `linear-gradient(to right, var(--lt-range-track-fill) 0%, var(--lt-range-track-fill) ${percentage}%, var(--lt-range-track) ${percentage}%, var(--lt-range-track) 100%)`);
  return (
    <label className={`lighttable-adjustment${disabled ? ' lighttable-adjustment--disabled' : ''}`}>
      <span
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
      </span>
      <span className="lighttable-adjustment__track-wrap">
        <span
          className="lighttable-adjustment__track-axis"
          style={{ ['--lighttable-slider-track' as string]: trackBackground }}
          aria-hidden="true"
        >
          <span className="lighttable-adjustment__neutral" style={{ left: `${neutral}%` }} />
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
            activePointerRef.current = event.pointerId;
            installPointerGuards(event.pointerId);
            onInteractionStartRef.current?.();

            // Keep ownership of the drag when the pointer leaves the small
            // thumb or crosses neighbouring controls in the scrolling panel.
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            // A native range can occasionally retain its internal drag state
            // after a missed release. Never let hover continue that drag.
            if (
              activePointerRef.current === event.pointerId
              && (event.buttons & 1) === 0
            ) {
              finishPointerInteraction(event.pointerId);
            }
          }}
          onPointerUp={(event) => finishPointerInteraction(event.pointerId)}
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
          onChange={(event) => {
            // Only a pointer interaction started by this control or an
            // intentional keyboard edit may alter the value. This guards
            // against native range controls that get stuck dragging and then
            // react to plain hover movement.
            if (activePointerRef.current === null && !keyboardInteractionRef.current) {
              event.currentTarget.value = String(displayValue);
              return;
            }
            const next = Number(event.currentTarget.value);
            latestValueRef.current = next;
            setDisplayValue(next);
            scheduleValuePublish();
          }}
          aria-label={label}
        />
      </span>
    </label>
  );
};
