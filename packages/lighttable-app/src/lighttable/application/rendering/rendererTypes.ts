import type { RgbHistogram } from '../../types';

export type LightTableImageDecodeMode = 'fast' | 'preserve-precision';

export interface LightTableLoadImageOptions {
  decodeMode?: LightTableImageDecodeMode;
  signal?: AbortSignal;
}

export interface ReferenceDifferenceMetrics {
  sampledPixels: number;
  differingPixels: number;
  differingPixelPercentage: number;
  meanAbsoluteRgbError: number;
  maximumChannelError: number;
  meanAbsoluteAlphaError: number;
  maximumAlphaError: number;
  threshold: number;
  stride: number;
}

export interface DocumentRendererCallbacks {
  onHistogram?: (histogram: RgbHistogram) => void;
  onDeviceLost?: (message: string) => void;
  onScopeError?: (message: string) => void;
  onFeatureError?: (featureId: string, message: string) => void;
  onFirstFrame?: () => void;
  onGpuMemoryEstimate?: (bytes: number) => void;
}

export interface DocumentRendererScopeCanvases {
  hueDistribution: HTMLCanvasElement;
  colorMixerHueDistribution?: HTMLCanvasElement;
  parade: HTMLCanvasElement;
  vectorscope: HTMLCanvasElement;
}
