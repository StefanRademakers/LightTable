import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { DepthAnalysisProgress, DepthAnalysisResult } from '../../../analysis/depth/types';
import { lightTableDepthAnalysis } from '../../../analysis/depth/DepthAnalysisClient';
import { LensBlurDepthRequest, type LensBlurDepthRequestPorts } from './LensBlurDepthRequest';
export { depthReadyProgress } from './LensBlurDepthRequest';

export const retiredDepthProgress = (progress: DepthAnalysisProgress, sameSource: boolean): DepthAnalysisProgress =>
  sameSource && progress.status === 'error' ? progress : { status: 'idle' };

interface LensBlurDepthControllerOptions extends Pick<LensBlurDepthRequestPorts,
  'captureScope' | 'getTargetIdentity' | 'getRenderer' | 'finishAdjustment' | 'settleInteraction' | 'change'> {
  open: boolean;
  enabled: boolean;
  documentIdentity: object | string;
  rendererGeneration: number;
  rendererReady: boolean;
  sourceBlob: Blob | null;
  sourceIdentity: string;
  reportFailure(reason: unknown): void;
}

/** React binds an exact source subscription and observes its low-frequency results. */
export const useLensBlurDepthController = (options: LensBlurDepthControllerOptions) => {
  const { open, enabled, sourceBlob, sourceIdentity, documentIdentity, rendererGeneration, rendererReady } = options;
  const latest = useRef(options); latest.current = options;
  const request = useRef<LensBlurDepthRequest | null>(null);
  const presentationSource = useRef({ sourceBlob, sourceIdentity, documentIdentity });
  const [resetEpoch, setResetEpoch] = useState(0);
  const [depthResult, setDepthResult] = useState<DepthAnalysisResult | null>(null);
  const [depthProgress, setDepthProgress] = useState<DepthAnalysisProgress>({ status: 'idle' });
  const reset = useCallback(() => {
    request.current?.cancel();
    setDepthResult(null); setDepthProgress({ status: 'idle' });
    setResetEpoch(epoch => epoch + 1);
  }, []);

  useLayoutEffect(() => {
    setDepthResult(null);
    const previous = presentationSource.current;
    const sameSource = previous.sourceBlob === sourceBlob && previous.sourceIdentity === sourceIdentity
      && previous.documentIdentity === documentIdentity;
    presentationSource.current = { sourceBlob, sourceIdentity, documentIdentity };
    if (!open || !sourceBlob || !sourceIdentity || !enabled || !rendererReady) {
      setDepthProgress(progress => retiredDepthProgress(progress, sameSource));
      return;
    }
    const opening = latest.current;
    const operation = new LensBlurDepthRequest({
      captureScope: opening.captureScope,
      getTargetIdentity: opening.getTargetIdentity,
      getRenderer: opening.getRenderer,
      estimateDepth: (blob, identity, progress) => lightTableDepthAnalysis.estimate(blob, identity, progress),
      finishAdjustment: opening.finishAdjustment,
      settleInteraction: opening.settleInteraction,
      change: opening.change,
      isSourceCurrent: () => latest.current.sourceBlob === sourceBlob
        && latest.current.sourceIdentity === sourceIdentity
        && latest.current.documentIdentity === documentIdentity
        && latest.current.open && latest.current.enabled && latest.current.rendererReady,
      publishProgress: setDepthProgress,
      publishResult: setDepthResult
    });
    request.current = operation;
    void operation.run(sourceBlob, sourceIdentity).catch(reason => {
      if (operation.isCurrent()) opening.reportFailure(reason);
    });
    return () => {
      operation.cancel();
      if (request.current === operation) request.current = null;
    };
  }, [open, enabled, sourceBlob, sourceIdentity, documentIdentity, rendererGeneration, rendererReady, resetEpoch]);

  return { depthResult, depthProgress, reset };
};
