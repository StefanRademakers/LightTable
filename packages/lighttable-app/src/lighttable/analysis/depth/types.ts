export interface DepthAnalysisResult {
  width: number;
  height: number;
  data: Float32Array;
  nearIsOne: true;
}

export type DepthAnalysisStatus = 'idle' | 'loading-model' | 'estimating' | 'ready' | 'error';

export interface DepthAnalysisProgress {
  status: DepthAnalysisStatus;
  message?: string;
  progress?: number;
}
