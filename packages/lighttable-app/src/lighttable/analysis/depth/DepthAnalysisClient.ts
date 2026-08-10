import type { DepthAnalysisProgress, DepthAnalysisResult } from './types';
import { WorkerInferenceClient } from '../inference/WorkerInferenceClient';

export class DepthAnalysisClient {
  private readonly inference = new WorkerInferenceClient<Blob, DepthAnalysisResult>({
    createWorker: () => new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' }),
    createRequest: (requestId, source) => ({ type: 'estimate', requestId, source }),
    parseResult: (message) => ({
      width: Number(message.width),
      height: Number(message.height),
      data: new Float32Array(message.data as ArrayBuffer),
      nearIsOne: true
    }),
    cacheSize: 2,
    disposeMessage: { type: 'dispose' },
    defaultErrorMessage: 'Depth analysis failed'
  });

  async estimate(source: Blob, cacheKey: string, onProgress?: (progress: DepthAnalysisProgress) => void) {
    return this.inference.run(source, cacheKey, onProgress
      ? (progress) => onProgress({
          status: progress.status as DepthAnalysisProgress['status'],
          message: progress.message,
          progress: progress.progress
        })
      : undefined);
  }

  clear(cacheKey?: string) {
    this.inference.clear(cacheKey);
  }

  dispose() {
    this.inference.dispose();
  }
}

// The worker/model is deliberately shared across LightTable overlay sessions.
// Closing an editor frees GPU depth textures, but does not redownload the model.
export const lightTableDepthAnalysis = new DepthAnalysisClient();
