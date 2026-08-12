import type { FaceWarpPoint } from './faceWarpTypes';

export interface FaceWarpDetectorObservation {
  readonly score: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly keypoints: readonly { readonly x: number; readonly y: number; readonly label?: string }[];
}

export type FaceWarpDetectionRequest =
  {
      readonly type: 'detect';
      readonly requestId: number;
      readonly image: ImageBitmap;
      readonly sourceWidth: number;
      readonly sourceHeight: number;
    };

export type FaceWarpDetectionResponse =
  | {
      readonly type: 'result';
      readonly requestId: number;
      readonly meshes: readonly (readonly FaceWarpPoint[])[];
      readonly poseMatrices: readonly (readonly number[])[];
      readonly observations: readonly FaceWarpDetectorObservation[];
      readonly detectorMemory: {
        readonly beforeBytes: number | null;
        readonly afterBytes: number | null;
        readonly deltaBytes: number | null;
      };
    }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };
