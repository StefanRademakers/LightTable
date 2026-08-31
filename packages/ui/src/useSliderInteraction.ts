import { useEffect, useRef, useState } from 'react';

/** Local feedback is immediate; only the consumer's preview is rate limited. */
export function useSliderInteraction<T>(value: T, options: {
  onChange: (value: T) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  publishIntervalMs?: number | 'animation-frame';
}) {
  const [display, setDisplay] = useState(value);
  const [interacting, setInteracting] = useState(false);
  const latest = useRef(value);
  const published = useRef(value);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const lastPublish = useRef(0);
  const callbacks = useRef(options);
  callbacks.current = options;
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const publish = () => {
    clear();
    if (Object.is(published.current, latest.current)) return;
    published.current = latest.current;
    lastPublish.current = performance.now();
    callbacks.current.onChange(latest.current);
  };
  const begin = () => {
    if (active.current) return;
    active.current = true;
    setInteracting(true);
    callbacks.current.onInteractionStart?.();
  };
  const update = (next: T) => {
    latest.current = next;
    setDisplay(next);
    if (callbacks.current.publishIntervalMs === 'animation-frame') {
      if (frame.current === null) frame.current = requestAnimationFrame(publish);
      return;
    }
    const remaining = Math.max(0, callbacks.current.publishIntervalMs ?? 33) - (performance.now() - lastPublish.current);
    if (remaining <= 0) publish();
    else if (timer.current === null) timer.current = setTimeout(publish, remaining);
  };
  const end = () => {
    if (!active.current) return;
    publish();
    active.current = false;
    setInteracting(false);
    callbacks.current.onInteractionEnd?.();
  };
  useEffect(() => {
    if (active.current) return;
    latest.current = value;
    published.current = value;
    setDisplay(value);
  }, [value, interacting]);
  useEffect(() => () => {
    // Flush before releasing the transaction; never leave an app preview open.
    clear();
    if (active.current) {
      if (!Object.is(published.current, latest.current)) callbacks.current.onChange(latest.current);
      active.current = false;
      callbacks.current.onInteractionEnd?.();
    }
  }, []);
  return { display, latest, active, begin, update, end };
}

export const sliderEditKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
export const sliderValueAtPosition = (x: number, left: number, width: number, min: number, max: number, step: number) => {
  if (!(max > min)) return min;
  const ratio = width > 0 ? Math.min(1, Math.max(0, (x - left) / width)) : 0;
  const increment = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.min(max, Math.max(min, Number((min + Math.round(ratio * (max - min) / increment) * increment).toFixed(10))));
};
