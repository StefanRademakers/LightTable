import type { BasicAdjustments } from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import type {
  AdjustmentInteractionToken,
  AdjustmentTransactionController
} from './useAdjustmentTransactionController';

export type AdjustmentInteractionKey = string;

export interface AdjustmentInteractionHandle {
  readonly key: AdjustmentInteractionKey;
  readonly token: AdjustmentInteractionToken | null;
}

export interface AdjustmentInteractionCoordinator {
  begin(key: AdjustmentInteractionKey): AdjustmentInteractionHandle;
  change(
    handle: AdjustmentInteractionHandle | void,
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain
  ): boolean;
  end(handle: AdjustmentInteractionHandle | void): void;
  cancel(handle: AdjustmentInteractionHandle | void): void;
  finish(): void;
  reset(): void;
  discreteChange(
    mutate: (current: BasicAdjustments) => BasicAdjustments,
    domain?: AdjustmentPresentationDomain
  ): boolean;
}

/**
 * Binds UI control lifetimes to opaque transaction leases. A stale terminal
 * callback can therefore never close a newer control's transaction.
 */
export const createAdjustmentInteractionCoordinator = (
  controller: AdjustmentTransactionController
): AdjustmentInteractionCoordinator => {
  let lease: AdjustmentInteractionHandle | null = null;

  const begin = (key: AdjustmentInteractionKey) => {
    if (lease?.token) controller.cancel(lease.token);
    else if (lease) controller.reset();
    const token = controller.begin();
    const handle = { key, token };
    lease = handle;
    return handle;
  };

  const end = (handle: AdjustmentInteractionHandle | void) => {
    if (!handle || lease !== handle) return;
    const current = lease;
    lease = null;
    if (current.token) controller.end(current.token);
    else controller.reset();
  };

  const cancel = (handle: AdjustmentInteractionHandle | void) => {
    if (!handle || lease !== handle) return;
    const current = lease;
    lease = null;
    if (current.token) controller.cancel(current.token);
    else controller.reset();
  };

  const finish = () => {
    const current = lease;
    lease = null;
    if (current?.token) controller.end(current.token);
    else if (current) controller.reset();
  };

  return {
    begin,
    change: (handle, mutate, domain = 'grade') => {
      if (!handle || lease !== handle || !lease.token) return false;
      return controller.change(mutate, domain, lease.token);
    },
    end,
    cancel,
    finish,
    reset: () => {
      lease = null;
      controller.reset();
    },
    discreteChange: (mutate, domain = 'grade') => {
      if (lease) finish();
      return controller.change(mutate, domain);
    }
  };
};
