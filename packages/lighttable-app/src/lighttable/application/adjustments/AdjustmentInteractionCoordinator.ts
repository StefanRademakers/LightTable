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
  finishForFile(): Promise<void>;
  reset(): void;
  discreteChange(mutate: (current: BasicAdjustments) => BasicAdjustments, domain?: AdjustmentPresentationDomain): boolean;
}
export type AdjustmentInteractionAdmission = () => Promise<InteractionTransitionAdmission>;
export type AdjustmentInteractionOwner = { isCurrent(): boolean };
export type AdjustmentInteractionController = Omit<AdjustmentTransactionController, 'change'>;
type Mutation = { mutate: (current: BasicAdjustments) => BasicAdjustments; domain: AdjustmentPresentationDomain };
interface PendingInteraction {
  handle: AdjustmentInteractionHandle;
  owner: AdjustmentInteractionOwner | null;
  epoch: number;
  token: AdjustmentInteractionToken | null;
  terminal: 'active' | 'end' | 'cancel';
  latest: Mutation | null;
  failure: Error | null;
}
type DeliveryOutcome = { ok: true } | { ok: false; error: unknown };
interface PendingDelivery { outcome: Promise<DeliveryOutcome>; relevant(): boolean }

/** One admitted route. Pending samples retain opening ownership, not a later UI target. */
export const createAdjustmentInteractionCoordinator = (
  controller: AdjustmentInteractionController,
  requestAdmission: AdjustmentInteractionAdmission,
  captureOwner: () => AdjustmentInteractionOwner | null,
  reportFailure: (error: unknown) => void
): AdjustmentInteractionCoordinator => {
  let lease: PendingInteraction | null = null;
  let epoch = 0;
  // Observe existing admissions; this neither schedules nor serializes work.
  const deliveries = new Set<PendingDelivery>();
  const trackDelivery = (operation: Promise<Error | null>, relevant: () => boolean) => {
    const outcome = operation.then<DeliveryOutcome, DeliveryOutcome>(
      error => error ? { ok: false, error } : { ok: true },
      error => ({ ok: false, error })
    );
    const delivery = { outcome, relevant };
    deliveries.add(delivery);
    void outcome.then(() => deliveries.delete(delivery));
    void operation.catch(reportFailure);
  };
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
    if (state.failure) { cancelState(state); throw state.failure; }
    if (!current(state)) { cancelState(state); return; }
    state.terminal = 'end';
    if (state.token && controller.end(state.token) === 'rejected') {
      throw new Error('The adjustment owner rejected its changed edit before completion.');
    }
  };
  const finishUi = () => {
    try { finish(); } catch (error) { reportFailure(error); }
  };
  const begin = (key: AdjustmentInteractionKey): AdjustmentInteractionHandle => {
    if (lease) cancelState(lease);
    const state: PendingInteraction = {
      handle: { key, token: null }, owner: captureOwner(), epoch,
      token: null, terminal: 'active', latest: null, failure: null
    };
    lease = state;
    if (!current(state)) { cancelState(state); return state.handle; }
    trackDelivery(requestAdmission().then(admission => {
      if (state.terminal === 'cancel' || admission.status === 'rejected' || !current(state)) {
        cancelState(state); return new Error(admission.status === 'rejected'
          ? admission.reason : 'The adjustment file target was retired before admission.');
      }
      state.token = controller.begin();
      if (!state.token) {
        cancelState(state); controller.reset();
        throw new Error('The adjustment owner could not begin its pending edit.');
      }
      const latest = state.latest; state.latest = null;
      try {
        if (latest && controller.changeResult(latest.mutate, latest.domain, state.token) === 'rejected') {
          throw new Error('The adjustment owner rejected its pending edit.');
        }
        if (state.terminal === 'end' && controller.end(state.token) === 'rejected') {
          throw new Error('The adjustment owner rejected its changed edit before completion.');
        }
      } catch (error) {
        // This continuation acquired this token. Retire it before surfacing the
        // failure; never reset a newer controller transaction indiscriminately.
        try { cancelState(state); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Adjustment delivery and cancellation both failed.'); }
        throw error;
      }
      return null;
    }), () => state.terminal !== 'cancel' && current(state));
    return state.handle;
  };
  return {
    begin,
    change: (handle, mutate, domain = 'grade') => {
      const state = lease;
      if (!handle || state?.handle !== handle || state.terminal !== 'active') return false;
      if (!current(state)) { cancelState(state); return false; }
      if (state.token) {
        const result = controller.changeResult(mutate, domain, state.token);
        if (result === 'rejected') state.failure = new Error('The adjustment owner rejected its active edit.');
        return result === 'applied';
      }
      // Absolute control samples: only the newest sample survives pending admission.
      state.latest = { mutate, domain };
      return true;
    },
    end: handle => { if (handle && lease?.handle === handle) finishUi(); },
    cancel: handle => { if (handle && lease?.handle === handle) cancelState(lease); },
    finish,
    finishForFile: async () => {
      if (lease && !current(lease)) cancelState(lease);
      const owner = lease?.owner ?? captureOwner();
      const openingEpoch = epoch;
      // Retired deliveries still clean themselves up, but cannot block a new
      // document or replacement gesture's file operation. Once captured, a
      // subsequent cancellation must still reject this particular file wait.
      const pending = [...deliveries].filter(delivery => delivery.relevant()).map(delivery => delivery.outcome);
      if (!lease && pending.length === 0) return;
      finish();
      const results = await Promise.all(pending);
      if (openingEpoch !== epoch || !owner?.isCurrent()) {
        throw new Error('The adjustment file target was retired before completion.');
      }
      const failure = results.find(result => !result.ok);
      if (failure && !failure.ok) throw failure.error;
    },
    reset: () => {
      ++epoch; // Also invalidates ended-but-unadmitted and discrete continuations.
      if (lease) cancelState(lease);
      else controller.reset();
    },
    discreteChange: (mutate, domain = 'grade') => {
      try { finish(); } catch (error) { reportFailure(error); return false; }
      const owner = captureOwner(); const openingEpoch = epoch;
      if (!owner?.isCurrent()) return false;
      trackDelivery(requestAdmission().then(admission => {
        if (admission.status === 'admitted' && openingEpoch === epoch && owner.isCurrent()) {
          if (controller.changeResult(mutate, domain) === 'rejected') {
            throw new Error('The adjustment owner rejected its discrete edit.');
          }
          return null;
        }
        return new Error(admission.status === 'rejected'
          ? admission.reason : 'The discrete adjustment file target was retired before admission.');
      }), () => openingEpoch === epoch && owner.isCurrent());
      // Acceptance for UI intents, not semantic command completion.
      return true;
    }
  };
};
