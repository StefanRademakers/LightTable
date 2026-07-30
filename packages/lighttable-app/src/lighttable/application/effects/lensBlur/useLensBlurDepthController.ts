import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DepthAnalysisProgress,
  DepthAnalysisResult
} from '../../../analysis/depth/types';

interface LensBlurDepthRendererPort {
  setDepthMap(depth: DepthAnalysisResult): void;
}

interface LensBlurDepthControllerOptions {
  open: boolean;
  enabled: boolean;
  sourceBlob: Blob | null;
  sourceIdentity: string;
  getRenderer: () => LensBlurDepthRendererPort | null;
  estimateDepth: (
    blob: Blob,
    identity: string,
    onProgress: (progress: DepthAnalysisProgress) => void
  ) => Promise<DepthAnalysisResult>;
  disableLensBlur(): void;
}

export interface LensBlurDepthController {
  depthResult: DepthAnalysisResult | null;
  depthProgress: DepthAnalysisProgress;
  reset(): void;
}

export const depthReadyProgress = (
  result: Pick<DepthAnalysisResult, 'width' | 'height'>
): DepthAnalysisProgress => ({
  status: 'ready',
  message: `Depth ready (${result.width} x ${result.height})`
});

/**
 * Owns optional Lens Blur analysis for one document.
 *
 * Source identity is part of the cache key and every async publication is
 * canceled on source/document changes. A failed optional analysis disables
 * Lens Blur without failing the base image or renderer.
 */
export const useLensBlurDepthController = ({
  open,
  enabled,
  sourceBlob,
  sourceIdentity,
  getRenderer,
  estimateDepth,
  disableLensBlur
}: LensBlurDepthControllerOptions): LensBlurDepthController => {
  const [depthResult, setDepthResult] = useState<DepthAnalysisResult | null>(null);
  const [depthIdentity, setDepthIdentity] = useState('');
  const [depthProgress, setDepthProgress] = useState<DepthAnalysisProgress>({
    status: 'idle'
  });
  const rendererRef = useRef(getRenderer);
  const estimateDepthRef = useRef(estimateDepth);
  const disableLensBlurRef = useRef(disableLensBlur);
  rendererRef.current = getRenderer;
  estimateDepthRef.current = estimateDepth;
  disableLensBlurRef.current = disableLensBlur;

  const reset = useCallback(() => {
    setDepthResult(null);
    setDepthIdentity('');
    setDepthProgress({ status: 'idle' });
  }, []);

  useEffect(() => {
    if (!open || !sourceBlob || !sourceIdentity || !enabled) return;
    if (depthResult && depthIdentity === sourceIdentity) {
      rendererRef.current()?.setDepthMap(depthResult);
      setDepthProgress(depthReadyProgress(depthResult));
      return;
    }

    let canceled = false;
    setDepthProgress({
      status: 'loading-model',
      message: 'Preparing depth analysis…'
    });
    void estimateDepthRef.current(
      sourceBlob,
      sourceIdentity,
      (progress) => {
        if (!canceled) setDepthProgress(progress);
      }
    ).then((result) => {
      if (canceled) return;
      setDepthResult(result);
      setDepthIdentity(sourceIdentity);
      rendererRef.current()?.setDepthMap(result);
      setDepthProgress(depthReadyProgress(result));
    }).catch((reason: unknown) => {
      if (canceled) return;
      setDepthProgress({
        status: 'error',
        message: reason instanceof Error
          ? reason.message
          : 'Depth analysis failed.'
      });
      disableLensBlurRef.current();
    });

    return () => {
      canceled = true;
    };
  }, [depthIdentity, depthResult, enabled, open, sourceBlob, sourceIdentity]);

  return { depthResult, depthProgress, reset };
};

