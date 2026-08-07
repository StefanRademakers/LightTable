export type ResampleMethod =
  | 'automatic' | 'preserve-details' | 'preserve-details-2'
  | 'bicubic-smoother' | 'bicubic-sharper' | 'bicubic'
  | 'nearest' | 'bilinear';

export type ConcreteResampleMethod = Exclude<ResampleMethod, 'automatic'>;

export interface ResizePlan {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly requestedMethod: ResampleMethod;
  readonly resolvedMethod: ConcreteResampleMethod | null;
  readonly passes: readonly { readonly width: number; readonly height: number }[];
}
