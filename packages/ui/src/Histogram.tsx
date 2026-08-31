import React, { useCallback, useEffect, useRef } from 'react';
import { observeScopeTheme, type ScopeTheme } from './scopeTheme';

export interface RgbHistogram { red: Uint32Array; green: Uint32Array; blue: Uint32Array; }

export interface HistogramProps {
  fit?: 'plot' | 'container';
  histogram: RgbHistogram | null;
  channel?: HistogramChannel;
}

export type HistogramChannel = 'rgb' | 'red' | 'green' | 'blue';

const HISTOGRAM_TOP_INSET = 7;

const smoothBins = (values: Uint32Array): number[] => {
  const weights = [1, 2, 3, 2, 1];
  return Array.from(values, (_, index) => {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const sourceIndex = Math.max(0, Math.min(values.length - 1, index + offset));
      const weight = weights[offset + 2];
      weightedTotal += values[sourceIndex] * weight;
      weightTotal += weight;
    }
    return weightedTotal / weightTotal;
  });
};

const resolveDisplayPeak = (channels: number[][]) => {
  const counts = channels.flat().filter((value) => value > 0).sort((a, b) => a - b);
  if (!counts.length) return 1;
  // Ignore only the most extreme spikes so a single clipped bin cannot flatten
  // the useful tonal distribution shown by the rest of the histogram.
  return Math.max(1, counts[Math.floor((counts.length - 1) * 0.99)]);
};

export const Histogram: React.FC<HistogramProps> = ({ histogram, channel = 'rgb', fit = 'plot' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const themeRef = useRef<ScopeTheme | null>(null);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const theme = themeRef.current;
    if (!canvas || !theme) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = theme.backgroundCss;
    context.fillRect(0, 0, rect.width, rect.height);
    if (!histogram) return;

    const channels = [
      smoothBins(histogram.red),
      smoothBins(histogram.green),
      smoothBins(histogram.blue)
    ];
    const selectedChannels = channel === 'rgb'
      ? channels
      : [channels[channel === 'red' ? 0 : channel === 'green' ? 1 : 2]];
    const displayPeak = resolveDisplayPeak(selectedChannels);
    const valueToY = (value: number) => {
      const normalized = Math.min(1, value / displayPeak);
      // A mild power curve keeps low-volume detail visible without the broad,
      // almost-flat plateau caused by the previous logarithmic scale.
      return rect.height - Math.pow(normalized, 0.72) * (
        rect.height - HISTOGRAM_TOP_INSET
      );
    };
    const traceChannel = (values: number[]) => {
      context.beginPath();
      context.moveTo(0, rect.height);
      for (let index = 0; index < values.length; index += 1) {
        const x = (index / 255) * rect.width;
        context.lineTo(x, valueToY(values[index]));
      }
    };
    const fillChannel = (values: number[], color: string) => {
      traceChannel(values);
      context.lineTo(rect.width, rect.height);
      context.closePath();
      context.fillStyle = color;
      context.fill();
    };
    const strokeChannel = (values: number[], color: string) => {
      traceChannel(values);
      context.strokeStyle = color;
      context.lineWidth = 1.2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
    };

    context.globalCompositeOperation = theme.light ? 'source-over' : 'screen';
    const indices = channel === 'rgb' ? [2, 1, 0] : [channel === 'red' ? 0 : channel === 'green' ? 1 : 2];
    context.globalAlpha = channel === 'rgb' ? 0.12 : 0.18;
    for (const index of indices) fillChannel(channels[index], theme.channels[index]);
    context.globalAlpha = 1;
    for (const index of indices) strokeChannel(channels[index], theme.channels[index]);
    context.globalCompositeOperation = 'source-over';
  }, [channel, histogram]);

  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return observeScopeTheme(canvas, theme => { themeRef.current = theme; drawRef.current(); });
  }, []);

  return <canvas ref={canvasRef} className="ui-histogram" data-ui-component="histogram" data-suite-control="histogram" data-fit={fit} aria-label={`${channel.toUpperCase()} histogram`} />;
};
