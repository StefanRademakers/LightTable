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

export interface TextRenderPresentationSnapshot {
  readonly publicationRevision: number;
  readonly readyLayerCount: number;
  readonly textureBytes: number;
  readonly mode: 'placeholder' | 'atlas' | 'cached';
  readonly rebuildingLayerCount: number;
  readonly cacheBudgetBytes: number;
  readonly cacheEvictions: number;
  readonly atlasLayerCount: number;
  readonly cachedLayerCount: number;
  readonly atlasEncodes: number;
  readonly layoutCacheBytes: number;
  readonly layoutCacheBudgetBytes: number;
  readonly layoutCacheHits: number;
  readonly layoutCacheMisses: number;
  readonly layoutCacheEvictions: number;
  readonly atlasBytes: number;
  readonly atlasHits: number;
  readonly atlasMisses: number;
  readonly atlasEvictions: number;
  readonly sourceDecisionMeasurements: number;
  readonly lastSourceDecision: string | null;
}

export interface DocumentRendererCallbacks {
  onHistogram?: (histogram: RgbHistogram) => void;
  onDeviceLost?: (message: string) => void;
  onScopeError?: (message: string) => void;
  onFeatureError?: (featureId: string, message: string) => void;
  onFirstFrame?: () => void;
  onGpuMemoryEstimate?: (bytes: number) => void;
  onTextRenderPresentation?: (snapshot: TextRenderPresentationSnapshot) => void;
}

export interface DocumentRendererScopeCanvases {
  hueDistribution: HTMLCanvasElement;
  colorMixerHueDistribution?: HTMLCanvasElement;
  parade: HTMLCanvasElement;
  vectorscope: HTMLCanvasElement;
}
