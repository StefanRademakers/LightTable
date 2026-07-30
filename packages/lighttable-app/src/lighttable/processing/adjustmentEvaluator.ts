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

export interface ProcessingEvaluationStep {
  instance: AdjustmentModuleInstance;
  definition: ProcessingModuleDefinition;
}

export interface AdjustmentEvaluation {
  /** Enabled, known modules in authoritative registry order. */
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
 * document persistence, scope filtering or ordering semantics.
 */
export const evaluateAdjustmentStack = (
  stack: AdjustmentStack,
  options: AdjustmentEvaluationOptions = {}
): AdjustmentEvaluation => {
  const registry = options.registry ?? currentProcessingModuleRegistry;
  const instancesByType = new Map(stack.modules.map((instance) => [instance.type, instance]));
  const steps = registry.definitions().flatMap((definition) => {
    const instance = instancesByType.get(definition.type);
    if (
      !instance?.enabled
      || (options.scope && !definition.allowedScopes.includes(options.scope))
    ) {
      return [];
    }
    return [{ instance, definition }];
  });

  return {
    steps,
    adjustments: materializeBasicAdjustments(stack, registry, options.scope)
  };
};
