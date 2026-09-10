import React, { useEffect, useRef } from 'react';
import { ButtonBase } from '../../../ui/ButtonBase';
import { Histogram } from '../../Histogram';
import type { BasicAdjustments, RgbHistogram } from '../../types';

export type GradeHistogramControlKey =
  | 'blacks'
  | 'shadows'
  | 'exposureEV'
  | 'highlights'
  | 'whites';

const CONTROLS: readonly GradeHistogramControlKey[] = [
  'blacks', 'shadows', 'exposureEV', 'highlights', 'whites'
];

const LABELS: Readonly<Record<GradeHistogramControlKey, string>> = {
  blacks: 'Blacks',
  shadows: 'Shadows',
  exposureEV: 'Exposure',
  highlights: 'Highlights',
  whites: 'Whites'
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export const gradeHistogramControlForPosition = (position: number): GradeHistogramControlKey =>
  CONTROLS[Math.min(CONTROLS.length - 1, Math.max(0, Math.floor(position * CONTROLS.length)))]!;

export const gradeHistogramDragValue = (
  key: GradeHistogramControlKey,
  startValue: number,
  horizontalFraction: number
): number => key === 'exposureEV'
  ? clamp(startValue + horizontalFraction * 5, -5, 5)
  : clamp(startValue + horizontalFraction * 200, -100, 100);

const edgeIsClipped = (histogram: RgbHistogram | null, index: 0 | 255): boolean => {
  if (!histogram) return false;
  const channels = [histogram.red, histogram.green, histogram.blue];
  const total = channels.reduce((sum, values) => (
    sum + values.reduce((channelSum, value) => channelSum + value, 0)
  ), 0);
  const edge = channels.reduce((sum, values) => sum + values[index], 0);
  return total > 0 && edge / total >= 0.001;
};

interface GradeHistogramControlProps {
  readonly histogram: RgbHistogram | null;
  readonly adjustments: BasicAdjustments;
  readonly disabled: boolean;
  readonly onChange: (key: GradeHistogramControlKey, value: number, handle: object | void) => void;
  readonly onInteractionStart: (key: GradeHistogramControlKey) => object | void;
  readonly onInteractionEnd: (key: GradeHistogramControlKey, handle: object | void) => void;
  readonly onInteractionCancel: (key: GradeHistogramControlKey, handle: object | void) => void;
}

interface HistogramGesture {
  readonly pointerId: number;
  readonly key: GradeHistogramControlKey;
  readonly startX: number;
  readonly width: number;
  readonly startValue: number;
  readonly handle: object | void;
}

export const GradeHistogramControl = ({
  histogram,
  adjustments,
  disabled,
  onChange,
  onInteractionStart,
  onInteractionEnd,
  onInteractionCancel
}: GradeHistogramControlProps) => {
  const gestureRef = useRef<HistogramGesture | null>(null);
  const cancelInteractionRef = useRef(onInteractionCancel);
  cancelInteractionRef.current = onInteractionCancel;

  const finishGesture = (element: HTMLElement, pointerId: number) => {
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== pointerId) return;
    gestureRef.current = null;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    onInteractionEnd(gesture.key, gesture.handle);
  };

  const cancelGesture = (element: HTMLElement, pointerId: number) => {
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== pointerId) return;
    gestureRef.current = null;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    onInteractionCancel(gesture.key, gesture.handle);
  };

  useEffect(() => () => {
    if (gestureRef.current) {
      cancelInteractionRef.current(gestureRef.current.key, gestureRef.current.handle);
    }
  }, []);

  return (
    <div className={`lighttable-grade-histogram${disabled ? ' lighttable-grade-histogram--disabled' : ''}`}>
      <Histogram histogram={histogram} fit="container" />
      <span
        className={`lighttable-grade-histogram__clip lighttable-grade-histogram__clip--shadows${
          edgeIsClipped(histogram, 0) ? ' lighttable-grade-histogram__clip--active' : ''
        }`}
        title="Shadow clipping"
        aria-hidden="true"
      />
      <span
        className={`lighttable-grade-histogram__clip lighttable-grade-histogram__clip--highlights${
          edgeIsClipped(histogram, 255) ? ' lighttable-grade-histogram__clip--active' : ''
        }`}
        title="Highlight clipping"
        aria-hidden="true"
      />
      <div className="lighttable-grade-histogram__ranges" aria-label="Interactive tonal ranges">
        {CONTROLS.map((key) => (
          <ButtonBase
            key={key}
            type="button"
            className="lighttable-grade-histogram__range"
            disabled={disabled}
            aria-label={`Drag to adjust ${LABELS[key]}`}
            title={`${LABELS[key]} · drag horizontally`}
            onPointerDown={(event) => {
              if (event.button !== 0 || disabled || gestureRef.current) return;
              const container = event.currentTarget.parentElement;
              if (!container) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const handle = onInteractionStart(key);
              gestureRef.current = {
                pointerId: event.pointerId,
                key,
                startX: event.clientX,
                width: Math.max(1, container.getBoundingClientRect().width),
                startValue: adjustments[key],
                handle
              };
            }}
            onPointerMove={(event) => {
              const gesture = gestureRef.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              onChange(
                gesture.key,
                gradeHistogramDragValue(
                  gesture.key,
                  gesture.startValue,
                  (event.clientX - gesture.startX) / gesture.width
                ),
                gesture.handle
              );
            }}
            onPointerUp={(event) => finishGesture(event.currentTarget, event.pointerId)}
            onPointerCancel={(event) => cancelGesture(event.currentTarget, event.pointerId)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const direction = event.key === 'ArrowLeft' ? -1 : 1;
              const step = key === 'exposureEV' ? 0.1 : 1;
              const handle = onInteractionStart(key);
              onChange(key, gradeHistogramDragValue(
                key,
                adjustments[key],
                direction * step / (key === 'exposureEV' ? 5 : 200)
              ), handle);
              onInteractionEnd(key, handle);
            }}
          >
            <span>{LABELS[key]}</span>
          </ButtonBase>
        ))}
      </div>
    </div>
  );
};
