import type { FaceWarpDetectionResponse, FaceWarpDetectorObservation } from './faceWarpDetectorProtocol';
import type { FaceWarpPoint } from './faceWarpTypes';

export interface FaceWarpDetectionInput {
  readonly blob: Blob;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface FaceWarpDetectionResult {
  readonly meshes: readonly (readonly FaceWarpPoint[])[];
  readonly poseMatrices: readonly (readonly number[])[];
  readonly observations: readonly FaceWarpDetectorObservation[];
  readonly detectorMemory: {
    readonly beforeBytes: number | null;
    readonly afterBytes: number | null;
    readonly deltaBytes: number | null;
  };
}

export class FaceWarpDetector {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private disposed = false;
  private pending = new Map<number, {
    resolve: (result: FaceWarpDetectionResult) => void;
    reject: (error: Error) => void;
  }>();

  async detect(input: FaceWarpDetectionInput): Promise<FaceWarpDetectionResult> {
    if (this.disposed) throw new Error('Face detection is closed.');
    const image = await createImageBitmap(input.blob);
    if (this.disposed) {
      image.close();
      throw new Error('Face detection is closed.');
    }
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage({
          type: 'detect', requestId, image,
          sourceWidth: input.sourceWidth,
          sourceHeight: input.sourceHeight
        }, [image]);
      } catch (reason) {
        this.pending.delete(requestId);
        image.close();
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const { reject } of this.pending.values()) reject(new Error('Face detection was cancelled.'));
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./faceWarpDetector.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FaceWarpDetectionResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.type === 'result') pending.resolve({
        meshes: response.meshes,
        poseMatrices: response.poseMatrices,
        observations: response.observations,
        detectorMemory: response.detectorMemory
      });
      else pending.reject(new Error(response.message));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The face detector worker failed.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    worker.onmessageerror = () => {
      const error = new Error('The face detector worker returned an unreadable response.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
