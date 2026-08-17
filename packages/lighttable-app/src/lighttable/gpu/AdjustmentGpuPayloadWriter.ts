import { buildCurveLut, cloneCurves, CURVE_CHANNELS, CURVE_LUT_SIZE, type CurvesAdjustments } from '../curves';
import type { BasicAdjustments } from '../types';
import type { DocumentBitDepth, DocumentBlendProfile } from '../editor/document/documentTypes';
import { buildAdjustmentUniform, type ColorLookupUniform } from './adjustmentUniform';
import {
  buildPhotoshopColorVibranceLuts,
  PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
} from './photoshopColorVibranceLut';

export interface AdjustmentGpuPayloadTargets {
  readonly uniformBuffer: GPUBuffer;
  readonly curveTexture: GPUTexture;
  readonly colorVibranceWhiteBalanceTexture?: GPUTexture;
  readonly colorVibranceColorTexture?: GPUTexture;
}

export interface AdjustmentGpuPayloadChange {
  readonly uniformChanged: boolean;
  readonly curveChanged: boolean;
}

const floatArraysEqual = (left: Float32Array | null, right: Float32Array) =>
  left !== null
  && left.length === right.length
  && right.every((value, index) => value === left[index]);

const curvesEqual = (left: CurvesAdjustments | null, right: CurvesAdjustments) =>
  left !== null && CURVE_CHANNELS.every((channel) => {
    const leftPoints = left[channel];
    const rightPoints = right[channel];
    return leftPoints.length === rightPoints.length
      && rightPoints.every((point, index) => {
        const candidate = leftPoints[index];
        return candidate !== undefined
          && candidate.x === point.x
          && candidate.y === point.y;
      });
  });

/**
 * Owns the CPU-to-GPU publication boundary for one adjustment stack.
 *
 * Effect-only changes and ordinary slider gestures must not rebuild or upload
 * the curve LUT. Likewise, a curve edit whose active-mask is unchanged must
 * not rewrite the uniform buffer. Keeping the retained payload beside its GPU
 * targets makes that rule identical for document, layer and Adjustment Layer
 * grades without involving React or render scheduling.
 */
export class AdjustmentGpuPayloadWriter {
  private lastUniform: Float32Array | null = null;
  private lastCurves: CurvesAdjustments | null = null;
  private lastColorVibranceParameters: readonly number[] | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly targets: AdjustmentGpuPayloadTargets
  ) {}

  sync(
    adjustments: BasicAdjustments,
    width: number,
    height: number,
    inputIsLinearComposite: boolean,
    colorLookup: ColorLookupUniform | null = null,
    photoshopBlendProfile: DocumentBlendProfile = 'srgb',
    documentBitDepth: DocumentBitDepth = 16
  ): AdjustmentGpuPayloadChange {
    const uniform = buildAdjustmentUniform(
      adjustments,
      width,
      height,
      inputIsLinearComposite,
      colorLookup,
      photoshopBlendProfile,
      documentBitDepth
    );
    const uniformChanged = !floatArraysEqual(this.lastUniform, uniform);
    if (uniformChanged) {
      this.device.queue.writeBuffer(this.targets.uniformBuffer, 0, uniform);
      this.lastUniform = uniform;
    }

    const curveChanged = !curvesEqual(this.lastCurves, adjustments.curves);
    if (curveChanged) {
      this.device.queue.writeTexture(
        { texture: this.targets.curveTexture },
        buildCurveLut(adjustments.curves),
        { bytesPerRow: CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT },
        { width: CURVE_LUT_SIZE, height: 1 }
      );
      this.lastCurves = cloneCurves(adjustments.curves);
    }

    if (
      adjustments.photoshopAdjustment.kind === 'color-vibrance'
      && this.targets.colorVibranceWhiteBalanceTexture
      && this.targets.colorVibranceColorTexture
    ) {
      const settings = adjustments.photoshopAdjustment;
      const parameters = [
        settings.colorVibranceTemperature,
        settings.colorVibranceTint,
        settings.colorVibranceVibrance,
        settings.colorVibranceSaturation
      ];
      if (!this.lastColorVibranceParameters
        || parameters.some((value, index) => value !== this.lastColorVibranceParameters?.[index])) {
        const luts = buildPhotoshopColorVibranceLuts(settings);
        const layout = {
          bytesPerRow: PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE * 4,
          rowsPerImage: PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
        };
        const extent = {
          width: PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE,
          height: PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE,
          depthOrArrayLayers: PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
        };
        this.device.queue.writeTexture(
          { texture: this.targets.colorVibranceWhiteBalanceTexture }, luts.whiteBalance, layout, extent
        );
        this.device.queue.writeTexture(
          { texture: this.targets.colorVibranceColorTexture }, luts.color, layout, extent
        );
        this.lastColorVibranceParameters = parameters;
      }
    }

    return { uniformChanged, curveChanged };
  }
}
