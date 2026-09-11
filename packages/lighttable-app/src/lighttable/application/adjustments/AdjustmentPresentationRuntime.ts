import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import { AdjustmentPresentationStore } from './adjustmentPresentationStore';
import { AdjustmentPresentationSynchronizer } from './AdjustmentPresentationSynchronizer';

/** One mounted inspector projection; survives tab rebinds, owns no canonical processing. */
export class AdjustmentPresentationRuntime {
  private staged = createDefaultAdjustments();
  readonly store = new AdjustmentPresentationStore(this.staged);
  readonly synchronizer = new AdjustmentPresentationSynchronizer((next, domain) => {
    this.staged = next;
    this.store.publish(next, domain);
  });
  getSnapshot = (): BasicAdjustments => this.staged;
  stage = (next: BasicAdjustments): void => { this.staged = next; };
}
