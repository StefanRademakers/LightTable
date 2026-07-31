import type { BasicAdjustments } from '../types';
import { createDefaultAdjustments } from '../types';
import { evaluateAdjustmentStack } from './adjustmentEvaluator';
import {
  cloneAdjustmentStack,
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from './adjustmentStack';

/**
 * Canonical document-level grade state.
 *
 * The editable stack and its materialized shader input must move together.
 * Keeping that invariant outside the renderer prevents a document switch or
 * stack replacement from exposing settings from different revisions.
 */
export class DocumentAdjustmentState {
  private stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
  private materialized = this.evaluate(this.stack);

  get current(): BasicAdjustments {
    return this.materialized;
  }

  replaceBasic(adjustments: BasicAdjustments): boolean {
    const nextStack = createAdjustmentStackFromBasicAdjustments(adjustments, this.stack);
    if (nextStack.revision === this.stack.revision) return false;
    this.stack = nextStack;
    this.materialized = this.evaluate(nextStack);
    return true;
  }

  replaceStack(stack: AdjustmentStack): boolean {
    if (adjustmentStackRevisionsEqual(this.stack, stack)) return false;
    this.stack = cloneAdjustmentStack(stack);
    this.materialized = this.evaluate(this.stack);
    return true;
  }

  stackSnapshot(): AdjustmentStack {
    return cloneAdjustmentStack(this.stack);
  }

  private evaluate(stack: AdjustmentStack): BasicAdjustments {
    return evaluateAdjustmentStack(stack, {
      scope: 'document-creative'
    }).adjustments;
  }
}

const adjustmentStackRevisionsEqual = (
  left: AdjustmentStack,
  right: AdjustmentStack
): boolean => left.id === right.id
  && left.revision === right.revision
  && left.modules.length === right.modules.length
  && left.modules.every((module, index) => {
    const candidate = right.modules[index];
    return candidate !== undefined
      && module.id === candidate.id
      && module.type === candidate.type
      && module.enabled === candidate.enabled
      && module.revision === candidate.revision;
  });
