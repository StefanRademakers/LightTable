import type { DepthAnalysisResult } from '../analysis/depth/types';
import {
  cloneAdjustmentStack,
  createAdjustmentStackFromBasicAdjustments,
  materializeBasicAdjustments,
  type AdjustmentModuleInstance,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import type { ProcessingScope } from '../processing/moduleDefinitions';
import { buildProcessingPlan } from '../processing/processingNodeRuntime';
import { currentProcessingModuleRegistry } from '../processing/processingModuleRegistry';
import type { BasicAdjustments } from '../types';
import {
  currentDocumentEffectNodeRegistry,
  type DocumentEffectFactoryContext,
  type DocumentEffectNodeDefinition,
  type DocumentEffectNodeRegistry,
  type DocumentGpuEffect
} from './documentEffectNodeRegistry';
import type {
  LightTableEffectRuntimeCallbacks,
  LightTableEffectStage
} from './types';

interface DocumentEffectRuntimeNode {
  readonly instanceId: string;
  readonly type: string;
  readonly updateRevision: string;
  readonly definition: DocumentEffectNodeDefinition;
  readonly effect: DocumentGpuEffect;
}

interface PlannedDocumentEffectNode {
  readonly instance: AdjustmentModuleInstance;
  readonly definition: DocumentEffectNodeDefinition;
  readonly nodeAdjustments: BasicAdjustments;
}

export interface LinearSpatialEffectOptions {
  visualizeDepth: boolean;
}

const EFFECT_STAGE_ORDER: Record<LightTableEffectStage, number> = {
  'source-geometry': 0,
  'linear-spatial': 1,
  'display-post': 2
};

const stackForInstance = (
  stack: AdjustmentStack,
  instance: AdjustmentModuleInstance
): AdjustmentStack => ({
  id: stack.id,
  revision: stack.revision,
  modules: [instance]
});

const isEffectCategory = (category: string) =>
  category === 'geometry' || category === 'lens' || category === 'output';

const effectUpdateRevision = (
  instance: AdjustmentModuleInstance,
  definition: DocumentEffectNodeDefinition,
  stack: AdjustmentStack
): string => {
  const dependencies = definition.aggregateDependencyTypes ?? [];
  if (dependencies.length === 0) return `${instance.revision}`;
  const modulesByType = new Map(stack.modules.map((module) => [module.type, module]));
  return [
    instance.revision,
    ...dependencies.map((type) => {
      const dependency = modulesByType.get(type);
      return dependency
        ? `${type}:${dependency.enabled ? 1 : 0}:${dependency.revision}`
        : `${type}:missing`;
    })
  ].join('|');
};

/**
 * Owns GPU effect instances for one processing-stack owner.
 *
 * Serialized node order is authoritative inside each render stage. Stage order
 * itself is constrained by texture domain: source geometry, linear spatial,
 * then display post. Every node instance owns its own effect resources, so
 * repeated node types cannot accidentally share mutable uniform state.
 */
export class DocumentEffectRuntime {
  private stack: AdjustmentStack;
  private readonly nodesByInstanceId = new Map<string, DocumentEffectRuntimeNode>();
  private orderedNodes: readonly DocumentEffectRuntimeNode[] = [];
  private width = 0;
  private height = 0;
  private interactionActive = false;
  private depthVisualization = false;
  private depthMap: DepthAnalysisResult | null = null;

  private constructor(
    private readonly factoryContext: DocumentEffectFactoryContext,
    stack: AdjustmentStack,
    private readonly scope: ProcessingScope,
    private readonly effectRegistry: DocumentEffectNodeRegistry
  ) {
    this.stack = cloneAdjustmentStack(stack);
    this.synchronizeNodes(this.stack);
  }

  static create(
    device: GPUDevice,
    sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    adjustments: BasicAdjustments,
    callbacks: LightTableEffectRuntimeCallbacks = {},
    scope: ProcessingScope = 'document-creative'
  ): DocumentEffectRuntime {
    return DocumentEffectRuntime.createFromStack(
      { device, sampler, vertexModule, callbacks },
      createAdjustmentStackFromBasicAdjustments(adjustments),
      scope
    );
  }

  static createFromStack(
    context: DocumentEffectFactoryContext,
    stack: AdjustmentStack,
    scope: ProcessingScope,
    registry: DocumentEffectNodeRegistry = currentDocumentEffectNodeRegistry
  ): DocumentEffectRuntime {
    return new DocumentEffectRuntime(context, stack, scope, registry);
  }

  setSettings(adjustments: BasicAdjustments): void {
    this.setAdjustmentStack(
      createAdjustmentStackFromBasicAdjustments(adjustments, this.stack)
    );
  }

  setAdjustmentStack(stack: AdjustmentStack): void {
    const nextStack = cloneAdjustmentStack(stack);
    this.synchronizeNodes(nextStack);
    this.stack = nextStack;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.forEachEffect((effect) => effect.resize(width, height));
  }

  encodeSourceGeometry(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    return this.encodeStage('source-geometry', encoder, input);
  }

  encodeLinearSpatial(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    options: LinearSpatialEffectOptions
  ): GPUTexture {
    return this.encodeStage(
      'linear-spatial',
      encoder,
      input,
      options.visualizeDepth ? new Set(['lt.halation']) : undefined
    );
  }

  encodeDisplayPost(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    bypass: boolean
  ): GPUTexture {
    return bypass ? input : this.encodeStage('display-post', encoder, input);
  }

  setDepthMap(depth: DepthAnalysisResult): boolean {
    if (this.depthMap === depth) return false;
    this.depthMap = depth;
    this.forEachEffect((effect) => effect.setDepthMap?.(depth));
    return true;
  }

  setInteractionActive(active: boolean): boolean {
    if (this.interactionActive === active) return false;
    this.interactionActive = active;
    this.forEachEffect((effect) => effect.setInteractionActive?.(active));
    return true;
  }

  setDepthVisualization(visible: boolean): boolean {
    if (this.depthVisualization === visible) return false;
    this.depthVisualization = visible;
    this.forEachEffect((effect) => effect.setDepthVisualization?.(visible));
    return true;
  }

  get hasDepth(): boolean {
    return this.orderedNodes.some((node) => node.effect.hasDepth === true);
  }

  estimatedTextureBytes(): number {
    let bytes = 0;
    this.forEachEffect((effect) => { bytes += effect.estimatedTextureBytes(); });
    return bytes;
  }

  destroyImageResources(): void {
    this.forEachEffect((effect) => effect.destroyImageResources());
  }

  destroy(): void {
    this.forEachEffect((effect) => effect.destroy());
    this.nodesByInstanceId.clear();
    this.orderedNodes = [];
  }

  private synchronizeNodes(stack: AdjustmentStack): void {
    const aggregateAdjustments = materializeBasicAdjustments(
      stack,
      currentProcessingModuleRegistry,
      this.scope
    );
    const plan = buildProcessingPlan(stack, { scope: this.scope });
    const plannedNodes: PlannedDocumentEffectNode[] = [];
    let previousStage = -1;

    for (const step of plan.steps) {
      if (!isEffectCategory(step.definition.category)) continue;
      const definition = this.effectRegistry.definition(step.instance.type);
      if (!definition) {
        throw new Error(
          `No document effect executor is registered for enabled node: ${step.instance.type}`
        );
      }
      const stageOrder = EFFECT_STAGE_ORDER[definition.stage];
      if (stageOrder < previousStage) {
        throw new Error(
          `Effect node ${step.instance.type} violates render-stage order in stack ${stack.id}`
        );
      }
      previousStage = stageOrder;
      plannedNodes.push({
        instance: step.instance,
        definition,
        nodeAdjustments: materializeBasicAdjustments(
          stackForInstance(stack, step.instance),
          currentProcessingModuleRegistry,
          this.scope
        )
      });
    }

    const nextNodes: DocumentEffectRuntimeNode[] = [];
    const createdNodes: DocumentEffectRuntimeNode[] = [];
    const createdEffects = new Set<DocumentGpuEffect>();
    try {
      for (const planned of plannedNodes) {
        const existing = this.nodesByInstanceId.get(planned.instance.id);
        if (existing?.type === planned.instance.type) {
          nextNodes.push(existing);
          continue;
        }
        const effect = planned.definition.create(
          this.factoryContext,
          planned.instance,
          planned.nodeAdjustments,
          aggregateAdjustments
        );
        if (effect.stage !== planned.definition.stage) {
          effect.destroy();
          throw new Error(
            `Effect ${planned.instance.type} declared ${planned.definition.stage} but created ${effect.stage}`
          );
        }
        if (this.width > 0 && this.height > 0) effect.resize(this.width, this.height);
        if (this.interactionActive) effect.setInteractionActive?.(true);
        if (this.depthVisualization) effect.setDepthVisualization?.(true);
        if (this.depthMap) effect.setDepthMap?.(this.depthMap);
        const node = {
          instanceId: planned.instance.id,
          type: planned.instance.type,
          updateRevision: effectUpdateRevision(
            planned.instance,
            planned.definition,
            stack
          ),
          definition: planned.definition,
          effect
        };
        createdNodes.push(node);
        createdEffects.add(effect);
        nextNodes.push(node);
      }
    } catch (error) {
      createdNodes.forEach((node) => node.effect.destroy());
      throw error;
    }

    try {
      for (let index = 0; index < plannedNodes.length; index += 1) {
        const planned = plannedNodes[index];
        const node = nextNodes[index];
        if (!planned || !node || createdEffects.has(node.effect)) continue;
        const updateRevision = effectUpdateRevision(
          planned.instance,
          planned.definition,
          stack
        );
        if (node.updateRevision === updateRevision) continue;
        planned.definition.update(
          node.effect,
          planned.instance,
          planned.nodeAdjustments,
          aggregateAdjustments
        );
        nextNodes[index] = { ...node, updateRevision };
      }
    } catch (error) {
      createdNodes.forEach((node) => node.effect.destroy());
      throw error;
    }

    const retainedEffects = new Set(nextNodes.map((node) => node.effect));
    for (const node of this.nodesByInstanceId.values()) {
      if (retainedEffects.has(node.effect)) continue;
      node.effect.destroy();
    }
    this.nodesByInstanceId.clear();
    nextNodes.forEach((node) => this.nodesByInstanceId.set(node.instanceId, node));
    this.orderedNodes = nextNodes;
  }

  private encodeStage(
    stage: LightTableEffectStage,
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    bypassTypes?: ReadonlySet<string>
  ): GPUTexture {
    let output = input;
    for (const node of this.orderedNodes) {
      if (node.definition.stage !== stage || bypassTypes?.has(node.type)) continue;
      output = node.effect.encode(encoder, output);
    }
    return output;
  }

  private forEachEffect(operation: (effect: DocumentGpuEffect) => void): void {
    this.orderedNodes.forEach((node) => operation(node.effect));
  }
}
