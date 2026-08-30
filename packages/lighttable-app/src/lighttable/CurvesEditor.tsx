import { ButtonBase } from '../ui/ButtonBase';
import React, { useMemo, useRef } from 'react';
import { SegmentedControl, type SegmentOption } from '@lighttable/ui';
import { lightTableIcon } from '../assets/icons';
import {
  evaluateToneCurve,
  normalizeCurvePoints,
  type CurveChannel,
  type CurvesAdjustments,
  type ToneCurve
} from './curves';
import type { RgbHistogram } from './types';

const WIDTH = 280;
const HEIGHT = 210;
const PADDING = 12;
const CHANNEL_OPTIONS: Array<SegmentOption<CurveChannel>> = [
  { value: 'master', label: 'RGB' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' }
];
const CHANNEL_COLOR: Record<CurveChannel, string> = {
  master: '#e6e9ee', red: '#f05a62', green: '#55cf78', blue: '#5595ff'
};

interface CurvesEditorProps {
  curves: CurvesAdjustments;
  channel: CurveChannel;
  histogram: RgbHistogram | null;
  disabled?: boolean;
  onChannelChange: (channel: CurveChannel) => void;
  onChange: (channel: CurveChannel, points: ToneCurve) => void;
  onReset: (channel: CurveChannel) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

const toSvgPoint = (event: React.PointerEvent<SVGSVGElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - PADDING) / (rect.width - PADDING * 2))),
    y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top - PADDING) / (rect.height - PADDING * 2)))
  };
};

const graphX = (value: number) => PADDING + value * (WIDTH - PADDING * 2);
const graphY = (value: number) => PADDING + (1 - value) * (HEIGHT - PADDING * 2);

const histogramPath = (values: Uint32Array) => {
  let maximum = 1;
  for (const value of values) maximum = Math.max(maximum, value);
  const points = Array.from(values, (value, index) => {
    const x = graphX(index / Math.max(1, values.length - 1));
    const normalized = Math.pow(value / maximum, 0.42);
    return `${x.toFixed(2)},${graphY(normalized).toFixed(2)}`;
  });
  return `M ${graphX(0)},${graphY(0)} L ${points.join(' L ')} L ${graphX(1)},${graphY(0)} Z`;
};

export const CurvesEditor: React.FC<CurvesEditorProps> = ({
  curves,
  channel,
  histogram,
  disabled = false,
  onChannelChange,
  onChange,
  onReset,
  onInteractionStart,
  onInteractionEnd
}) => {
  const dragIndexRef = useRef<number | null>(null);
  const previewPointsRef = useRef<ToneCurve | null>(null);
  const [previewPoints, setPreviewPoints] = React.useState<ToneCurve | null>(null);
  const points = previewPoints ?? curves[channel];
  const publishPreview = (next: ToneCurve) => {
    previewPointsRef.current = next;
    setPreviewPoints(next);
    onChange(channel, next);
  };
  const curvePath = useMemo(() => {
    const samples = Array.from({ length: 129 }, (_, index) => {
      const x = index / 128;
      return `${index ? 'L' : 'M'} ${graphX(x).toFixed(2)} ${graphY(evaluateToneCurve(points, x)).toFixed(2)}`;
    });
    return samples.join(' ');
  }, [points]);

  const beginPointDrag = (event: React.PointerEvent<SVGCircleElement>, index: number) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragIndexRef.current = index;
    previewPointsRef.current = points.map((point) => ({ ...point }));
    setPreviewPoints(previewPointsRef.current);
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    onInteractionStart();
  };

  const addPoint = (event: React.PointerEvent<SVGRectElement>) => {
    if (disabled || event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left - PADDING) / (rect.width - PADDING * 2))),
      y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top - PADDING) / (rect.height - PADDING * 2)))
    };
    const next = normalizeCurvePoints([...points, point]);
    dragIndexRef.current = next.findIndex((candidate) => Math.abs(candidate.x - point.x) < 1e-5);
    svg.setPointerCapture(event.pointerId);
    onInteractionStart();
    publishPreview(next);
  };

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = dragIndexRef.current;
    if (index === null || disabled) return;
    const point = toSvgPoint(event);
    const current = previewPointsRef.current ?? points;
    const next = current.map((candidate) => ({ ...candidate }));
    const minimumX = index === 0 ? 0 : next[index - 1].x + 0.005;
    const maximumX = index === next.length - 1 ? 1 : next[index + 1].x - 0.005;
    next[index] = { x: Math.max(minimumX, Math.min(maximumX, point.x)), y: point.y };
    publishPreview(next);
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndexRef.current === null) return;
    dragIndexRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onInteractionEnd();
    previewPointsRef.current = null;
    setPreviewPoints(null);
  };

  const removePoint = (event: React.MouseEvent<SVGCircleElement>, index: number) => {
    if (disabled || index === 0 || index === points.length - 1) return;
    event.preventDefault();
    event.stopPropagation();
    onInteractionEnd();
    onInteractionStart();
    onChange(channel, points.filter((_, pointIndex) => pointIndex !== index));
    onInteractionEnd();
  };

  return (
    <div className={`lighttable-curves-editor${disabled ? ' lighttable-curves-editor--disabled' : ''}`}>
      <div className="lighttable-curves-editor__toolbar">
        <SegmentedControl
          value={channel}
          options={CHANNEL_OPTIONS}
          onChange={onChannelChange}
          label="Custom Curve channel"
        />
        <ButtonBase type="button" onClick={() => onReset(channel)} disabled={disabled} title={`Reset ${channel} curve`}>
          <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
        </ButtonBase>
      </div>
      <svg
        className="lighttable-curves-editor__graph"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="application"
        aria-label={`${channel} custom curve`}
        onPointerMove={movePoint}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect className="lighttable-curves-editor__hit" x={PADDING} y={PADDING} width={WIDTH - PADDING * 2} height={HEIGHT - PADDING * 2} onPointerDown={addPoint} />
        {[0.25, 0.5, 0.75].map((position) => (
          <React.Fragment key={position}>
            <line className="lighttable-curves-editor__grid" x1={graphX(position)} y1={graphY(0)} x2={graphX(position)} y2={graphY(1)} />
            <line className="lighttable-curves-editor__grid" x1={graphX(0)} y1={graphY(position)} x2={graphX(1)} y2={graphY(position)} />
          </React.Fragment>
        ))}
        {histogram ? (['red', 'green', 'blue'] as const).map((histogramChannel) => (
          <path
            key={histogramChannel}
            className={`lighttable-curves-editor__histogram lighttable-curves-editor__histogram--${histogramChannel}`}
            d={histogramPath(histogram[histogramChannel])}
          />
        )) : null}
        <path className="lighttable-curves-editor__line-shadow" d={curvePath} />
        <path className="lighttable-curves-editor__line" d={curvePath} style={{ stroke: CHANNEL_COLOR[channel] }} />
        {points.map((point, index) => (
          <circle
            key={`${index}-${point.x.toFixed(4)}`}
            className="lighttable-curves-editor__point"
            cx={graphX(point.x)}
            cy={graphY(point.y)}
            r="5"
            style={{ fill: CHANNEL_COLOR[channel] }}
            onPointerDown={(event) => beginPointDrag(event, index)}
            onDoubleClick={(event) => removePoint(event, index)}
            onContextMenu={(event) => removePoint(event, index)}
          />
        ))}
      </svg>
    </div>
  );
};
