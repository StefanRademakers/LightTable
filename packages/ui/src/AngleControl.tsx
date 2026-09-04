import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { NumberField } from './NumberField';

const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const PUBLISH_INTERVAL_MS = 33;

export interface AngleControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label: string;
  value: number;
  resetValue?: number;
  disabled?: boolean;
  tabIndex?: number;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

/** Pointer, keyboard and numeric angle input with throttled live publication. */
export function AngleControl({ label, value, resetValue = 0, disabled = false, tabIndex = -1,
  onChange, onInteractionStart, onInteractionEnd, className = '', ...props }: AngleControlProps) {
  const dial = useRef<HTMLDivElement | null>(null);
  const pointerId = useRef<number | null>(null);
  const [displayValue, setDisplayValue] = useState(() => normalizeAngle(value));
  const latestValue = useRef(displayValue);
  const publishedValue = useRef(displayValue);
  const lastPublishTime = useRef(0);
  const publishTimer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const normalized = normalizeAngle(displayValue);

  const cancelScheduledPublish = useCallback(() => {
    if (publishTimer.current === null) return;
    window.clearTimeout(publishTimer.current);
    publishTimer.current = null;
  }, []);
  const publishLatestValue = useCallback((force = false) => {
    const next = latestValue.current;
    if (!force && next === publishedValue.current) return;
    cancelScheduledPublish();
    publishedValue.current = next;
    lastPublishTime.current = performance.now();
    onChangeRef.current(next);
  }, [cancelScheduledPublish]);
  const scheduleValuePublish = useCallback(() => {
    const elapsed = performance.now() - lastPublishTime.current;
    if (elapsed >= PUBLISH_INTERVAL_MS) return publishLatestValue();
    if (publishTimer.current !== null) return;
    publishTimer.current = window.setTimeout(() => {
      publishTimer.current = null;
      publishLatestValue();
    }, PUBLISH_INTERVAL_MS - elapsed);
  }, [publishLatestValue]);
  const previewValue = useCallback((next: number) => {
    const normalizedNext = normalizeAngle(next);
    latestValue.current = normalizedNext;
    setDisplayValue(normalizedNext);
    scheduleValuePublish();
  }, [scheduleValuePublish]);
  const finishPointerInteraction = useCallback((currentPointerId: number) => {
    if (pointerId.current !== currentPointerId) return;
    pointerId.current = null;
    publishLatestValue(true);
    onInteractionEnd?.();
  }, [onInteractionEnd, publishLatestValue]);
  useEffect(() => {
    if (pointerId.current !== null) return;
    const next = normalizeAngle(value);
    latestValue.current = next;
    publishedValue.current = next;
    setDisplayValue(next);
  }, [value]);
  useEffect(() => cancelScheduledPublish, [cancelScheduledPublish]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const bounds = dial.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = clientX - (bounds.left + bounds.width / 2);
    const y = clientY - (bounds.top + bounds.height / 2);
    if (Math.hypot(x, y) >= 1) previewValue(Math.atan2(-y, x) * 180 / Math.PI);
  };

  return <div {...props} className={`ui-angle-control ${className}`} data-ui-component="angle-control"
    data-suite-control="panel-angle" data-disabled={disabled || undefined}>
    <div ref={dial} className="ui-angle-control__dial" role="slider" tabIndex={disabled ? -1 : tabIndex}
      aria-disabled={disabled || undefined} aria-label={label} aria-valuemin={0} aria-valuemax={359}
      aria-valuenow={Math.round(normalized)} aria-valuetext={`${Math.round(normalized)} degrees`}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        pointerId.current = event.pointerId;
        onInteractionStart?.();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event.clientX, event.clientY);
      }}
      onPointerMove={event => { if (pointerId.current === event.pointerId) updateFromPointer(event.clientX, event.clientY); }}
      onPointerUp={event => finishPointerInteraction(event.pointerId)}
      onPointerCancel={event => finishPointerInteraction(event.pointerId)}
      onLostPointerCapture={event => finishPointerInteraction(event.pointerId)}
      onDoubleClick={() => { if (!disabled) onChange(normalizeAngle(resetValue)); }}
      onKeyDown={event => {
        if (disabled) return;
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault(); onChange(normalizeAngle(normalized - step));
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault(); onChange(normalizeAngle(normalized + step));
        } else if (event.key === 'Home') {
          event.preventDefault(); onChange(normalizeAngle(resetValue));
        }
      }}>
      <span className="ui-angle-control__hand" style={{ transform: `rotate(${-normalized}deg)` }} aria-hidden="true" />
    </div>
    <span className="ui-angle-control__number">
      <NumberField updateMode="input" align="right" min={0} max={359} step={1}
        value={Math.round(normalized)} disabled={disabled} tabIndex={tabIndex}
        aria-label={`${label} degrees`} onValueChange={next => onChange(normalizeAngle(next))} />
      <span>°</span>
    </span>
  </div>;
}
