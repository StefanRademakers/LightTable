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

  replaceBasic(adjustments: BasicAdjustments): void {
    this.stack = createAdjustmentStackFromBasicAdjustments(adjustments, this.stack);
    this.materialized = this.evaluate(this.stack);
  }

  replaceStack(stack: AdjustmentStack): void {
    this.stack = cloneAdjustmentStack(stack);
    this.materialized = this.evaluate(this.stack);
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
