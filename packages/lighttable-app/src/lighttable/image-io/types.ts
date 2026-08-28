export type SourceColorSpace = 'srgb';
export type SourceTransferFunction = 'srgb';
export type SourceAlphaMode = 'none' | 'straight' | 'premultiplied';

export interface SourceImageDescriptor {
  width: number;
  height: number;
  channels: 4;
  storage: 'external-image';
  colorSpace: SourceColorSpace;
  transferFunction: SourceTransferFunction;
  alphaMode: SourceAlphaMode;
  orientationApplied: boolean;
  sourceBitDepth: 8;
  contentType: string;
}

export interface NativeDecodedImage {
  kind: 'native-bitmap';
  bitmap: ImageBitmap;
  descriptor: SourceImageDescriptor;
  close(): void;
}

export type DecodedPixelStorage = 'u8' | 'u16' | 'f16-display' | 'f32';
export type SourceProfileDisposition = 'embedded-icc-to-srgb' | 'assumed-srgb';

export interface AdvancedSourceImageDescriptor {
  width: number;
  height: number;
  channels: 4;
  storage: DecodedPixelStorage;
  colorSpace: SourceColorSpace;
  transferFunction: SourceTransferFunction;
  alphaMode: SourceAlphaMode;
  orientationApplied: boolean;
  sourceBitDepth: 8 | 16 | 32;
  contentType: string;
  sourceFormat: string;
  sourceInterpretation: string;
  /**
   * Advanced import always normalizes into sRGB. This field makes explicit
   * whether that transform used an embedded profile or the documented
   * no-profile default.
   */
  sourceProfile: SourceProfileDisposition;
  iccProfile: ArrayBuffer | null;
  iccProfileAppliedToSrgb: boolean;
}

export interface AdvancedDecodedImage {
  kind: 'advanced-pixels';
  pixels: ArrayBuffer;
  descriptor: AdvancedSourceImageDescriptor;
}
