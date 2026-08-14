import { RawImage, type Tensor } from '@huggingface/transformers';
import {
  buildAdaptiveTrimap,
  constrainMatteContourExpansion,
  refineMatteFromLogits,
  type MatteRefinementImage,
  type MatteRefinementQuality,
  type MatteRefinementRoi
} from './matteRefinement';

export interface NeuralMatteModelPort {
  _call(inputs: { pixel_values: Tensor }): Promise<{ alphas: Tensor }>;
}

export type NeuralMatteProcessorPort = ((image: RawImage, trimap: RawImage) => Promise<{
  readonly pixel_values: Tensor;
  /** Original ROI size and resized content size, both in [height, width] order. */
  readonly original_sizes?: readonly (readonly [number, number])[];
  readonly reshaped_input_sizes?: readonly (readonly [number, number])[];
}>) & Record<string, unknown>;

export interface NeuralMatteRuntime {
  readonly model: NeuralMatteModelPort;
  readonly processor: NeuralMatteProcessorPort;
}

const sampleAlpha = (
  data: ArrayLike<number>, sourceWidth: number, sourceHeight: number, rowStride: number,
  x: number, y: number
) => {
  const sx = Math.max(0, Math.min(sourceWidth - 1, x));
  const sy = Math.max(0, Math.min(sourceHeight - 1, y));
  const left = Math.floor(sx);
  const top = Math.floor(sy);
  const right = Math.min(sourceWidth - 1, left + 1);
  const bottom = Math.min(sourceHeight - 1, top + 1);
  const fx = sx - left;
  const fy = sy - top;
  const a = (data[top * rowStride + left] ?? 0) * (1 - fx)
    + (data[top * rowStride + right] ?? 0) * fx;
  const b = (data[bottom * rowStride + left] ?? 0) * (1 - fx)
    + (data[bottom * rowStride + right] ?? 0) * fx;
  return a * (1 - fy) + b * fy;
};

export const compositeNeuralAlpha = (
  coarse: Uint8Array,
  trimap: Uint8Array,
  roi: MatteRefinementRoi,
  alpha: ArrayLike<number>,
  alphaWidth: number,
  alphaHeight: number,
  documentWidth: number,
  alphaContentWidth = alphaWidth,
  alphaContentHeight = alphaHeight
) => {
  // ViTMatte pads resized input on the right/bottom to a model-compatible
  // extent. `alphas` includes that padding. Sampling the complete tensor and
  // stretching it over the unpadded ROI shifts and scales the final selection
  // contour. Only the processor-reported reshaped content is image data.
  const contentWidth = Math.max(1, Math.min(alphaWidth, alphaContentWidth));
  const contentHeight = Math.max(1, Math.min(alphaHeight, alphaContentHeight));
  const output = coarse.slice();
  for (let y = 0; y < roi.height; y += 1) for (let x = 0; x < roi.width; x += 1) {
    const local = y * roi.width + x;
    const target = (roi.y + y) * documentWidth + roi.x + x;
    if (trimap[local] === 255) output[target] = 255;
    else if (trimap[local] === 0) output[target] = 0;
    else {
      const sourceX = roi.width === 1 ? 0 : x * (contentWidth - 1) / (roi.width - 1);
      const sourceY = roi.height === 1 ? 0 : y * (contentHeight - 1) / (roi.height - 1);
      output[target] = Math.max(0, Math.min(255, Math.round(
        sampleAlpha(alpha, contentWidth, contentHeight, alphaWidth, sourceX, sourceY) * 255
      )));
    }
  }
  return output;
};

/**
 * Runs true RGB + trimap alpha matting on the selected ROI. SAM, trimap
 * generation and matting remain separate boundaries so the model can be
 * replaced without changing the Object Selection interaction contract.
 */
export const refineMatteWithNeuralRuntime = async (
  runtime: NeuralMatteRuntime,
  logits: ArrayLike<number>,
  offset: number,
  width: number,
  height: number,
  image: RawImage,
  quality: Exclude<MatteRefinementQuality, 'fast'>
) => {
  const trimap = buildAdaptiveTrimap(logits, offset, width, height, quality);
  const coarse = refineMatteFromLogits(logits, offset, width, height,
    image as MatteRefinementImage, 'fast');
  if (trimap.roi.width === 0 || trimap.roi.height === 0) return coarse;
  const { roi } = trimap;
  const roiImage = await image.crop([roi.x, roi.y, roi.x + roi.width, roi.y + roi.height]) as RawImage;
  const trimapImage = new RawImage(trimap.data, roi.width, roi.height, 1);
  const inputs = await runtime.processor(roiImage, trimapImage);
  try {
    const { alphas } = await runtime.model._call(inputs);
    try {
      const alphaHeight = alphas.dims.at(-2) ?? roi.height;
      const alphaWidth = alphas.dims.at(-1) ?? roi.width;
      const [reshapedHeight = alphaHeight, reshapedWidth = alphaWidth]
        = inputs.reshaped_input_sizes?.[0] ?? [];
      const composited = compositeNeuralAlpha(
        coarse, trimap.data, roi, alphas.data as ArrayLike<number>,
        alphaWidth, alphaHeight, width, reshapedWidth, reshapedHeight
      );
      // ViTMatte needs broad context for translucent hair, but that context
      // must not become an equally broad hard-selection expansion.
      return constrainMatteContourExpansion(
        composited, logits, offset, width, height, quality === 'high' ? 3 : 2
      );
    } finally {
      alphas.dispose();
    }
  } finally {
    inputs.pixel_values.dispose();
  }
};
