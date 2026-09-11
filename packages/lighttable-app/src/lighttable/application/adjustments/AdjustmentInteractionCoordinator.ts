import type { BasicAdjustments } from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import type { AdjustmentInteractionToken, AdjustmentTransactionController } from './useAdjustmentTransactionController';
import type { InteractionTransitionAdmission } from '../interactions/InteractionTransitionCoordinator';

export type AdjustmentInteractionKey = string;
export interface AdjustmentInteractionHandle {
  readonly key: AdjustmentInteractionKey;
  readonly token: AdjustmentInteractionToken | null;
}
export interface AdjustmentInteractionCoordinator {
  begin(key: AdjustmentInteractionKey): AdjustmentInteractionHandle;
  change(handle: AdjustmentInteractionHandle | void,
    mutate: (current: BasicAdjustments) => BasicAdjustments, domain?: AdjustmentPresentationDomain): boolean;
  end(handle: AdjustmentInteractionHandle | void): void;
  cancel(handle: AdjustmentInteractionHandle | void): void;
  finish(): void;
  reset(): void;
  discreteChange(mutate: (current: BasicAdjustments) => BasicAdjustments, domain?: AdjustmentPresentationDomain): boolean;
}
export type AdjustmentInteractionAdmission = () => Promise<InteractionTransitionAdmission>;
export type AdjustmentInteractionOwner = { isCurrent(): boolean };
type Mutation = { mutate: (current: BasicAdjustments) => BasicAdjustments; domain: AdjustmentPresentationDomain };
interface PendingInteraction {
  handle: AdjustmentInteractionHandle;
  owner: AdjustmentInteractionOwner | null;
  epoch: number;
  token: AdjustmentInteractionToken | null;
  terminal: 'active' | 'end' | 'cancel';
  latest: Mutation | null;
}

/** One admitted route. Pending samples retain opening ownership, not a later UI target. */
export const createAdjustmentInteractionCoordinator = (
  controller: AdjustmentTransactionController,
  requestAdmission: AdjustmentInteractionAdmission,
  captureOwner: () => AdjustmentInteractionOwner | null,
  reportFailure: (error: unknown) => void
): AdjustmentInteractionCoordinator => {
  let lease: PendingInteraction | null = null;
  let epoch = 0;
  const current = (state: PendingInteraction) => state.epoch === epoch && Boolean(state.owner?.isCurrent());
  const cancelState = (state: PendingInteraction) => {
    state.terminal = 'cancel';
    state.latest = null;
    if (state.token) controller.cancel(state.token);
    if (lease === state) lease = null;
  };
  const finish = () => {
    const state = lease; lease = null;
    if (!state) return;
    if (!current(state)) { cancelState(state); return; }
    state.terminal = 'end';
    if (state.token) controller.end(state.token);
  };
  const begin = (key: AdjustmentInteractionKey): AdjustmentInteractionHandle => {
    if (lease) cancelState(lease);
    const state: PendingInteraction = {
      handle: { key, token: null }, owner: captureOwner(), epoch,
      token: null, terminal: 'active', latest: null
    };
    lease = state;
    if (!current(state)) { cancelState(state); return state.handle; }
    void requestAdmission().then(admission => {
      if (state.terminal === 'cancel' || admission.status === 'rejected' || !current(state)) {
        cancelState(state); return;
      }
      state.token = controller.begin();
      if (!state.token) { cancelState(state); controller.reset(); return; }
      const latest = state.latest; state.latest = null;
      try {
        if (latest) controller.change(latest.mutate, latest.domain, state.token);
        if (state.terminal === 'end') controller.end(state.token);
      } catch (error) {
        // This continuation acquired this token. Retire it before surfacing the
        // failure; never reset a newer controller transaction indiscriminately.
        try { cancelState(state); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Adjustment delivery and cancellation both failed.'); }
        throw error;
      }
    }).catch(reportFailure);
    return state.handle;
  };
  return {
    begin,
    change: (handle, mutate, domain = 'grade') => {
      const state = lease;
      if (!handle || state?.handle !== handle || state.terminal !== 'active') return false;
      if (!current(state)) { cancelState(state); return false; }
      if (state.token) return controller.change(mutate, domain, state.token);
      // Absolute control samples: only the newest sample survives pending admission.
      state.latest = { mutate, domain };
      return true;
    },
    end: handle => { if (handle && lease?.handle === handle) finish(); },
    cancel: handle => { if (handle && lease?.handle === handle) cancelState(lease); },
    finish,
    reset: () => {
      ++epoch; // Also invalidates ended-but-unadmitted and discrete continuations.
      if (lease) cancelState(lease);
      else controller.reset();
    },
    discreteChange: (mutate, domain = 'grade') => {
      finish();
      const owner = captureOwner(); const openingEpoch = epoch;
      if (!owner?.isCurrent()) return false;
      void requestAdmission().then(admission => {
        if (admission.status === 'admitted' && openingEpoch === epoch && owner.isCurrent()) {
          controller.change(mutate, domain);
        }
      }).catch(reportFailure);
      // Acceptance for UI intents, not semantic command completion.
      return true;
    }
  };
};
