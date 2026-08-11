import React, { useCallback, useEffect, useRef } from 'react';
import type { RgbHistogram } from './types';

interface HistogramProps {
  histogram: RgbHistogram | null;
}

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

export const Histogram: React.FC<HistogramProps> = ({ histogram }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = '#0b0d10';
    context.fillRect(0, 0, rect.width, rect.height);
    if (!histogram) return;

    const channels = [
      smoothBins(histogram.red),
      smoothBins(histogram.green),
      smoothBins(histogram.blue)
    ];
    const displayPeak = resolveDisplayPeak(channels);
    const valueToY = (value: number) => {
      const normalized = Math.min(1, value / displayPeak);
      // A mild power curve keeps low-volume detail visible without the broad,
      // almost-flat plateau caused by the previous logarithmic scale.
      return rect.height - Math.pow(normalized, 0.72) * (rect.height - 5);
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

    context.globalCompositeOperation = 'screen';
    fillChannel(channels[2], 'rgba(45, 116, 255, 0.13)');
    fillChannel(channels[1], 'rgba(42, 230, 105, 0.11)');
    fillChannel(channels[0], 'rgba(255, 48, 62, 0.13)');
    strokeChannel(channels[2], '#488bff');
    strokeChannel(channels[1], '#34e070');
    strokeChannel(channels[0], '#ff424c');
    context.globalCompositeOperation = 'source-over';
  }, [histogram]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className="lighttable-histogram" aria-label="RGB histogram" />;
};
