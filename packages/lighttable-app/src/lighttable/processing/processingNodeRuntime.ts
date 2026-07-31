import type { AdjustmentModuleInstance, AdjustmentStack } from './adjustmentStack';
import type { ProcessingModuleDefinition, ProcessingScope } from './moduleDefinitions';
import {
  currentProcessingModuleRegistry,
  type ProcessingModuleRegistry
} from './processingModuleRegistry';

export type ProcessingPlanSkipReason =
  | 'disabled'
  | 'unknown-module'
  | 'scope-not-allowed';

export interface ProcessingPlanSkippedNode {
  readonly instance: AdjustmentModuleInstance;
  readonly reason: ProcessingPlanSkipReason;
}

export interface ProcessingPlanStep {
  readonly instance: AdjustmentModuleInstance;
  readonly definition: ProcessingModuleDefinition;
}

export interface ProcessingPlan {
  /** Enabled, known and in-scope nodes in serialized document order. */
  readonly steps: readonly ProcessingPlanStep[];
  /** Explicit bypass diagnostics; callers decide what is user-visible. */
  readonly skipped: readonly ProcessingPlanSkippedNode[];
}

export interface BuildProcessingPlanOptions {
  readonly scope?: ProcessingScope;
  readonly registry?: ProcessingModuleRegistry;
}

/**
 * Builds the authoritative execution plan without touching GPU resources.
 *
 * Ordering belongs to the serialized stack. The registry describes node
 * capabilities; it must never silently reorder user-authored processing.
 */
export const buildProcessingPlan = (
  stack: AdjustmentStack,
  options: BuildProcessingPlanOptions = {}
): ProcessingPlan => {
  const registry = options.registry ?? currentProcessingModuleRegistry;
  const steps: ProcessingPlanStep[] = [];
  const skipped: ProcessingPlanSkippedNode[] = [];

  for (const instance of stack.modules) {
    if (!instance.enabled) {
      skipped.push({ instance, reason: 'disabled' });
      continue;
    }
    const definition = registry.definition(instance.type);
    if (!definition) {
      skipped.push({ instance, reason: 'unknown-module' });
      continue;
    }
    if (options.scope && !definition.allowedScopes.includes(options.scope)) {
      skipped.push({ instance, reason: 'scope-not-allowed' });
      continue;
    }
    steps.push({ instance, definition });
  }

  return { steps, skipped };
};

export interface ProcessingNodeExecutor<
  Value,
  Context,
  Instance extends AdjustmentModuleInstance = AdjustmentModuleInstance
> {
  readonly type: string;
  encode(context: Context, input: Value, instance: Instance): Value;
}

export interface ProcessingExecutionResult<Value> extends ProcessingPlan {
  readonly output: Value;
}

/**
 * Runtime boundary for ordered processing nodes.
 *
 * It is deliberately generic over the render value and context so the same
 * contract can drive WebGPU textures, CPU reference tests and future export
 * renderers. Missing executors fail loudly; an installed node may never
 * silently disappear from the rendered result.
 */
export class ProcessingNodeRuntime<Value, Context> {
  private readonly executors = new Map<string, ProcessingNodeExecutor<Value, Context>>();

  constructor(
    executors: readonly ProcessingNodeExecutor<Value, Context>[],
    private readonly registry: ProcessingModuleRegistry = currentProcessingModuleRegistry
  ) {
    for (const executor of executors) {
      if (this.executors.has(executor.type)) {
        throw new Error(`Duplicate processing executor type: ${executor.type}`);
      }
      if (!registry.has(executor.type)) {
        throw new Error(`Processing executor has no module definition: ${executor.type}`);
      }
      this.executors.set(executor.type, executor);
    }
  }

  execute(
    stack: AdjustmentStack,
    input: Value,
    context: Context,
    scope?: ProcessingScope
  ): ProcessingExecutionResult<Value> {
    const plan = buildProcessingPlan(stack, { registry: this.registry, scope });
    let output = input;

    for (const step of plan.steps) {
      const executor = this.executors.get(step.instance.type);
      if (!executor) {
        throw new Error(
          `No processing executor is registered for enabled node: ${step.instance.type}`
        );
      }
      output = executor.encode(context, output, step.instance);
    }

    return { ...plan, output };
  }
}
