import type { FaceWarpPoint } from './faceWarpTypes';

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
    }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };
