import type {
  AdjustmentLayer,
  RasterLayer
} from '../editor/document/documentTypes';
import {
  adjustmentStackHasOwner
} from '../processing/adjustmentStack';

export interface LayerGradeEncoder {
  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture;
}

export interface LayerEffectStageEncoder {
  encodeSourceGeometry(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture;
  encodeLinearSpatial(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture;
  encodeDisplayPost(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture;
}

/**
 * Authoritative per-layer processing order.
 *
 * Geometry must run in layer/source space before tonal work. Spatial effects
 * then see the graded pixels, while display-post effects remain last. Merge,
 * flatten, export and interactive compositing all enter through this boundary.
 */
export class LayerProcessingRenderer {
  constructor(
    private readonly gradeEncoder: LayerGradeEncoder,
    private readonly effectEncoder: LayerEffectStageEncoder
  ) {}

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    layer: AdjustmentLayer | RasterLayer
  ): GPUTexture {
    const stack = layer.adjustmentStack;
    if (!stack) return source;

    const hasGrade = adjustmentStackHasOwner(stack, 'grade');
    const hasEffects = adjustmentStackHasOwner(stack, 'lens-fx');
    const geometry = hasEffects
      ? this.effectEncoder.encodeSourceGeometry(encoder, source, layer)
      : source;
    const graded = hasGrade
      ? this.gradeEncoder.encode(encoder, geometry, layer)
      : geometry;
    const spatial = hasEffects
      ? this.effectEncoder.encodeLinearSpatial(encoder, graded, layer)
      : graded;
    return hasEffects
      ? this.effectEncoder.encodeDisplayPost(encoder, spatial, layer)
      : spatial;
  }
}
