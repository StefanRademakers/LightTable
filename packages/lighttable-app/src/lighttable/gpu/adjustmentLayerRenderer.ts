import type {
  AdjustmentLayer,
  DocumentBitDepth,
  DocumentBlendProfile,
  RasterLayer
} from '../editor/document/documentTypes';
import { evaluateAdjustmentStack, type AdjustmentEvaluation } from '../processing/adjustmentEvaluator';
import type { BasicAdjustments } from '../types';
import { AdjustmentLayerGpuResources } from './adjustmentLayerGpuResources';
import { encodeFullscreenPass } from './fullscreenPass';

const SPATIAL_EPSILON = 0.00001;

export interface AdjustmentLayerRenderPlan {
  evaluation: AdjustmentEvaluation;
  requiresSpatialInput: boolean;
}

export const createAdjustmentLayerRenderPlan = (
  layer: AdjustmentLayer | RasterLayer
): AdjustmentLayerRenderPlan => {
  if (!layer.adjustmentStack) {
    throw new Error(`Layer "${layer.name}" has no local grade.`);
  }
  const evaluation = evaluateAdjustmentStack(
    layer.adjustmentStack,
    { scope: layer.type === 'adjustment' ? 'adjustment-layer' : 'layer' }
  );
  return {
    evaluation,
    requiresSpatialInput: adjustmentsRequireSpatialInput(evaluation.adjustments)
  };
};

export const adjustmentsRequireSpatialInput = (
  adjustments: Pick<BasicAdjustments, 'clarity' | 'dehaze'>
): boolean =>
  Math.abs(adjustments.clarity) > SPATIAL_EPSILON
  || Math.abs(adjustments.dehaze) > SPATIAL_EPSILON;

export interface AdjustmentLayerRendererDependencies {
  sampler: GPUSampler;
  basicPipeline: GPURenderPipeline;
  downsamplePipeline: GPURenderPipeline;
  blurPipeline: GPURenderPipeline;
  creativePipeline: GPURenderPipeline;
  correctedTexture: GPUTexture;
  downsampleTexture: GPUTexture;
  blurTexture: GPUTexture;
  creativeTexture: GPUTexture;
  downsampleBindGroup: GPUBindGroup;
  blurHorizontalBindGroup: GPUBindGroup;
  blurVerticalBindGroup: GPUBindGroup;
  width: number;
  height: number;
  blendProfile: DocumentBlendProfile;
  bitDepth: DocumentBitDepth;
}

/**
 * Encodes one Adjustment Layer using document-generation GPU resources.
 *
 * The renderer deliberately owns command ordering but not document state:
 * evaluation remains pure, per-layer uniforms/LUTs belong to the resource
 * owner, and the caller decides where the returned texture is composited.
 */
export class AdjustmentLayerRenderer {
  private dependencies: AdjustmentLayerRendererDependencies | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly resources: AdjustmentLayerGpuResources
  ) {}

  configure(dependencies: AdjustmentLayerRendererDependencies): void {
    this.dependencies = dependencies;
  }

  setDocumentColorContext(blendProfile: DocumentBlendProfile, bitDepth: DocumentBitDepth): void {
    if (!this.dependencies) return;
    this.dependencies = { ...this.dependencies, blendProfile, bitDepth };
  }

  reset(): void {
    this.dependencies = null;
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const dependencies = this.dependencies;
    if (!dependencies) {
      throw new Error('Adjustment Layer renderer is not configured for the active document.');
    }

    const plan = createAdjustmentLayerRenderPlan(layer);
    const adjustments = plan.evaluation.adjustments;
    const runtime = this.resources.getOrCreate(layer);
    runtime.payloadWriter.sync(
      adjustments,
      dependencies.width,
      dependencies.height,
      true,
      runtime.colorLookupUniform,
      dependencies.blendProfile,
      dependencies.bitDepth
    );

    const basicBindGroup = this.device.createBindGroup({
      layout: dependencies.basicPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: dependencies.sampler },
        { binding: 2, resource: { buffer: runtime.uniformBuffer } }
      ]
    });
    encodeFullscreenPass(
      encoder,
      dependencies.basicPipeline,
      basicBindGroup,
      dependencies.correctedTexture.createView(),
      { label: `LightTable Adjustment Layer basic: ${layer.name}` }
    );

    if (plan.requiresSpatialInput) {
      encodeFullscreenPass(
        encoder,
        dependencies.downsamplePipeline,
        dependencies.downsampleBindGroup,
        dependencies.downsampleTexture.createView()
      );
      encodeFullscreenPass(
        encoder,
        dependencies.blurPipeline,
        dependencies.blurHorizontalBindGroup,
        dependencies.blurTexture.createView()
      );
      encodeFullscreenPass(
        encoder,
        dependencies.blurPipeline,
        dependencies.blurVerticalBindGroup,
        dependencies.downsampleTexture.createView()
      );
    }

    encodeFullscreenPass(
      encoder,
      dependencies.creativePipeline,
      runtime.creativeBindGroup,
      dependencies.creativeTexture.createView(),
      { label: `LightTable Adjustment Layer creative: ${layer.name}` }
    );
    return dependencies.creativeTexture;
  }
}
