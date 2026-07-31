import type { BasicAdjustments } from '../types';
import type { AdjustmentModuleInstance } from '../processing/adjustmentStack';
import type { DepthAnalysisResult } from '../analysis/depth/types';
import { ChromaticAberrationEffect } from './chromaticAberration/ChromaticAberrationEffect';
import { GrainEffect } from './grain/GrainEffect';
import { HalationEffect } from './halation/HalationEffect';
import { LensBlurEffect } from './lensBlur/LensBlurEffect';
import { LensDistortionEffect } from './lensDistortion/LensDistortionEffect';
import { WarpEffect } from './warp/WarpEffect';
import { readWarpNodeSettings } from './warp/warpTypes';
import type {
  LightTableEffectRuntimeCallbacks,
  LightTableEffectStage
} from './types';

export interface DocumentEffectFactoryContext {
  readonly device: GPUDevice;
  readonly sampler: GPUSampler;
  readonly vertexModule: GPUShaderModule;
  readonly callbacks: LightTableEffectRuntimeCallbacks;
}

export interface DocumentGpuEffect {
  readonly id: string;
  readonly stage: LightTableEffectStage;
  resize(width: number, height: number): void;
  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture;
  destroyImageResources(): void;
  destroy(): void;
  estimatedTextureBytes(): number;
  setDepthMap?(depth: DepthAnalysisResult): void;
  setInteractionActive?(active: boolean): void;
  setDepthVisualization?(visible: boolean): void;
  readonly hasDepth?: boolean;
}

export interface DocumentEffectNodeDefinition {
  readonly type: string;
  readonly stage: LightTableEffectStage;
  /**
   * Other serialized modules whose settings are consumed by this executor.
   * The runtime uses these revisions to avoid updating unchanged GPU state.
   */
  readonly aggregateDependencyTypes?: readonly string[];
  create(
    context: DocumentEffectFactoryContext,
    instance: AdjustmentModuleInstance,
    nodeAdjustments: BasicAdjustments,
    aggregateAdjustments: BasicAdjustments
  ): DocumentGpuEffect;
  update(
    effect: DocumentGpuEffect,
    instance: AdjustmentModuleInstance,
    nodeAdjustments: BasicAdjustments,
    aggregateAdjustments: BasicAdjustments
  ): void;
}

const definition = <Effect extends DocumentGpuEffect>(
  type: string,
  stage: LightTableEffectStage,
  create: (
    context: DocumentEffectFactoryContext,
    instance: AdjustmentModuleInstance,
    nodeAdjustments: BasicAdjustments,
    aggregateAdjustments: BasicAdjustments
  ) => Effect,
  update: (
    effect: Effect,
    instance: AdjustmentModuleInstance,
    nodeAdjustments: BasicAdjustments,
    aggregateAdjustments: BasicAdjustments
  ) => void,
  aggregateDependencyTypes?: readonly string[]
): DocumentEffectNodeDefinition => ({
  type,
  stage,
  aggregateDependencyTypes,
  create,
  update: (effect, instance, nodeAdjustments, aggregateAdjustments) => {
    update(effect as Effect, instance, nodeAdjustments, aggregateAdjustments);
  }
});

export const DOCUMENT_EFFECT_NODE_DEFINITIONS = [
  definition(
    'lt.warp',
    'source-geometry',
    (context, instance) => new WarpEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      readWarpNodeSettings(instance),
      context.callbacks
    ),
    (effect, instance) => effect.setSettings(readWarpNodeSettings(instance))
  ),
  definition(
    'lt.lens-distortion',
    'source-geometry',
    (context, _instance, node) => new LensDistortionEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      node.effects.lensDistortion,
      context.callbacks
    ),
    (effect, _instance, node) => effect.setSettings(node.effects.lensDistortion)
  ),
  definition(
    'lt.chromatic-aberration',
    'source-geometry',
    (context, _instance, node) => new ChromaticAberrationEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      node.effects.chromaticAberration,
      context.callbacks
    ),
    (effect, _instance, node) => effect.setSettings(node.effects.chromaticAberration)
  ),
  definition(
    'lt.lens-blur',
    'linear-spatial',
    (context, _instance, node, aggregate) => new LensBlurEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      node.effects.lensBlur,
      aggregate.effects.lensDistortion,
      context.callbacks
    ),
    (effect, _instance, node, aggregate) => {
      effect.setSettings(node.effects.lensBlur);
      effect.setDistortionSettings(aggregate.effects.lensDistortion);
    },
    ['lt.lens-distortion']
  ),
  definition(
    'lt.halation',
    'linear-spatial',
    (context, _instance, node) => new HalationEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      node.effects.halation,
      context.callbacks
    ),
    (effect, _instance, node) => effect.setSettings(node.effects.halation)
  ),
  definition(
    'lt.grain',
    'display-post',
    (context, _instance, node) => new GrainEffect(
      context.device,
      context.sampler,
      context.vertexModule,
      node.effects.grain,
      context.callbacks
    ),
    (effect, _instance, node) => effect.setSettings(node.effects.grain)
  )
] as const satisfies readonly DocumentEffectNodeDefinition[];

export class DocumentEffectNodeRegistry {
  private readonly definitionsByType = new Map<string, DocumentEffectNodeDefinition>();

  constructor(definitions: readonly DocumentEffectNodeDefinition[]) {
    for (const current of definitions) {
      if (this.definitionsByType.has(current.type)) {
        throw new Error(`Duplicate document effect node type: ${current.type}`);
      }
      this.definitionsByType.set(current.type, current);
    }
  }

  definition(type: string): DocumentEffectNodeDefinition | undefined {
    return this.definitionsByType.get(type);
  }

  definitions(): readonly DocumentEffectNodeDefinition[] {
    return [...this.definitionsByType.values()];
  }
}

export const currentDocumentEffectNodeRegistry = new DocumentEffectNodeRegistry(
  DOCUMENT_EFFECT_NODE_DEFINITIONS
);
