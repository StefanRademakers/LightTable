import type { BasicAdjustments } from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import type {
  AdjustmentInteractionToken,
  AdjustmentTransactionController
} from './useAdjustmentTransactionController';
import type { InteractionTransitionAdmission } from '../interactions/InteractionTransitionCoordinator';

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

export type AdjustmentInteractionAdmission = () => Promise<InteractionTransitionAdmission>;
export type AdjustmentInteractionOwnerIntent = string | null;
export type AdjustmentInteractionOwnerIntentReader = () => AdjustmentInteractionOwnerIntent;

interface PendingAdjustmentInteraction {
  readonly handle: AdjustmentInteractionHandle;
  readonly ownerIntent: AdjustmentInteractionOwnerIntent;
  token: AdjustmentInteractionToken | null;
  admitted: boolean;
  terminal: 'active' | 'end' | 'cancel';
  readonly changes: Array<{
    readonly mutate: (current: BasicAdjustments) => BasicAdjustments;
    readonly domain: AdjustmentPresentationDomain;
  }>;
}

/**
 * Binds UI control lifetimes to opaque transaction leases. A stale terminal
 * callback can therefore never close a newer control's transaction.
 */
export const createAdjustmentInteractionCoordinator = (
  controller: AdjustmentTransactionController,
  requestAdmission?: AdjustmentInteractionAdmission,
  readOwnerIntent?: AdjustmentInteractionOwnerIntentReader
): AdjustmentInteractionCoordinator => {
  let lease: AdjustmentInteractionHandle | null = null;
  const pending = new WeakMap<AdjustmentInteractionHandle, PendingAdjustmentInteraction>();

  const cancelLease = (handle: AdjustmentInteractionHandle) => {
    const state = pending.get(handle);
    if (state) {
      state.terminal = 'cancel';
      state.changes.length = 0;
      if (state.token) controller.cancel(state.token);
      else if (state.admitted) controller.reset();
      return;
    }
    if (handle.token) controller.cancel(handle.token);
    else controller.reset();
  };

  const admitPending = (
    state: PendingAdjustmentInteraction,
    admission: InteractionTransitionAdmission
  ) => {
    if (state.terminal === 'cancel'
      || admission.status === 'rejected'
      || (readOwnerIntent && state.ownerIntent !== readOwnerIntent())) {
      state.terminal = 'cancel';
      state.changes.length = 0;
      if (lease === state.handle) lease = null;
      return;
    }
    const token = controller.begin();
    state.admitted = true;
    state.token = token;
    if (!token) {
      state.terminal = 'cancel';
      state.changes.length = 0;
      if (lease === state.handle) lease = null;
      controller.reset();
      return;
    }
    state.changes.splice(0).forEach(({ mutate, domain }) => {
      controller.change(mutate, domain, token);
    });
    if (state.terminal === 'end') controller.end(token);
  };

  const begin = (key: AdjustmentInteractionKey) => {
    if (lease) cancelLease(lease);
    if (requestAdmission) {
      const handle = { key, token: null };
      const state: PendingAdjustmentInteraction = {
        handle,
        ownerIntent: readOwnerIntent?.() ?? null,
        token: null,
        admitted: false,
        terminal: 'active',
        changes: []
      };
      pending.set(handle, state);
      lease = handle;
      void requestAdmission().then((admission) => admitPending(state, admission));
      return handle;
    }
    const token = controller.begin();
    const handle = { key, token };
    lease = handle;
    return handle;
  };

  const end = (handle: AdjustmentInteractionHandle | void) => {
    if (!handle || lease !== handle) return;
    const current = lease;
    lease = null;
    const state = pending.get(current);
    if (state) {
      state.terminal = 'end';
      if (state.token) controller.end(state.token);
      else if (state.admitted) controller.reset();
    } else if (current.token) controller.end(current.token);
    else controller.reset();
  };

  const cancel = (handle: AdjustmentInteractionHandle | void) => {
    if (!handle || lease !== handle) return;
    const current = lease;
    lease = null;
    cancelLease(current);
  };

  const finish = () => {
    const current = lease;
    lease = null;
    if (!current) return;
    const state = pending.get(current);
    if (state) {
      state.terminal = 'end';
      if (state.token) controller.end(state.token);
      else if (state.admitted) controller.reset();
    } else if (current.token) controller.end(current.token);
    else controller.reset();
  };

  return {
    begin,
    change: (handle, mutate, domain = 'grade') => {
      if (!handle || lease !== handle) return false;
      const state = pending.get(handle);
      if (state) {
        if (state.terminal !== 'active') return false;
        if (!state.token) {
          // Adjustment samples are absolute snapshots. While admission waits,
          // retain only the newest sample instead of replaying a stale burst
          // of pointer-rate GPU previews after transform finalization.
          state.changes.length = 0;
          state.changes.push({ mutate, domain });
          return true;
        }
        return controller.change(mutate, domain, state.token);
      }
      if (!lease.token) return false;
      return controller.change(mutate, domain, lease.token);
    },
    end,
    cancel,
    finish,
    reset: () => {
      const current = lease;
      lease = null;
      if (current) cancelLease(current);
      else controller.reset();
    },
    discreteChange: (mutate, domain = 'grade') => {
      if (lease) finish();
      if (requestAdmission) {
        const ownerIntent = readOwnerIntent?.() ?? null;
        void requestAdmission().then((admission) => {
          if (admission.status === 'admitted'
            && (!readOwnerIntent || ownerIntent === readOwnerIntent())) {
            controller.change(mutate, domain);
          }
        });
        return true;
      }
      return controller.change(mutate, domain);
    }
  };
};
