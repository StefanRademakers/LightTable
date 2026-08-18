import type { BasicAdjustments } from '../types';
import {
  materializeBasicAdjustments,
  type AdjustmentModuleInstance,
  type AdjustmentStack
} from './adjustmentStack';
import type { ProcessingModuleDefinition, ProcessingScope } from './moduleDefinitions';
import {
  currentProcessingModuleRegistry,
  type ProcessingModuleRegistry
} from './processingModuleRegistry';
import { buildProcessingPlan } from './processingNodeRuntime';

export interface ProcessingEvaluationStep {
  instance: AdjustmentModuleInstance;
  definition: ProcessingModuleDefinition;
}

export interface AdjustmentEvaluation {
  /**
   * Enabled, known modules in serialized document order.
   *
   * This order is authoritative for independent node executors. The current
   * compatibility aggregate is still evaluated by the fused Grade renderer,
   * whose internal photographic order is fixed and deliberately does not
   * pretend to support arbitrary reordering of its compound submodules.
   */
  steps: readonly ProcessingEvaluationStep[];
  /** Compatibility aggregate consumed by the current combined grade shader. */
  adjustments: BasicAdjustments;
}

export interface AdjustmentEvaluationOptions {
  scope?: ProcessingScope;
  registry?: ProcessingModuleRegistry;
}

/**
 * Produces one deterministic execution plan for a serializable stack.
 *
 * The compatibility aggregate keeps the current combined shader unchanged.
 * Future per-module GPU evaluators can consume `steps` without changing
 * document persistence or scope filtering. They may only expose arbitrary
 * module reordering after the fused Grade order has been split and parity-
 * tested; serialized inventory order alone is not such a guarantee.
 */
export const evaluateAdjustmentStack = (
  stack: AdjustmentStack,
  options: AdjustmentEvaluationOptions = {}
): AdjustmentEvaluation => {
  const registry = options.registry ?? currentProcessingModuleRegistry;
  const { steps } = buildProcessingPlan(stack, {
    registry,
    scope: options.scope
  });

  return {
    steps,
    adjustments: materializeBasicAdjustments(stack, registry, options.scope)
  };
};
