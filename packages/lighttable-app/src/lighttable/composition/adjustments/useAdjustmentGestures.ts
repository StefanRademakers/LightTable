import { useLayoutEffect, useMemo, useRef } from 'react';
import { createAdjustmentInteractionCoordinator, type AdjustmentInteractionAdmission,
  type AdjustmentInteractionHandle } from '../../application/adjustments/AdjustmentInteractionCoordinator';
import type { AdjustmentTransactionController } from '../../application/adjustments/useAdjustmentTransactionController';
import type { captureInteractionScope } from '../../application/interactions/captureInteractionScope';

interface Ports {
  controller: AdjustmentTransactionController;
  requestAdmission: AdjustmentInteractionAdmission;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  getTargetIdentity(): string | null;
  reportFailure(error: unknown): void;
}

/** Mounted adapter only; existing coordinator owns admission and control leases. */
export const useAdjustmentGestures = (documentIdentity: object | string, ports: Ports) => {
  const latest = useRef(ports); latest.current = ports;
  const interactions = useMemo(() => createAdjustmentInteractionCoordinator(
    ports.controller,
    () => latest.current.requestAdmission(),
    () => {
      const scope = latest.current.captureScope();
      const target = latest.current.getTargetIdentity();
      return target === null ? null : { isCurrent: () => scope.isCurrent()
        && latest.current.getTargetIdentity() === target };
    },
    error => latest.current.reportFailure(error)
  ), [ports.controller]);
  useLayoutEffect(() => () => interactions.reset(), [interactions, documentIdentity]);
  return useMemo(() => ({
    interactions,
    beginAdjustment: interactions.begin,
    endAdjustment: (handle?: AdjustmentInteractionHandle | void) => handle
      ? interactions.end(handle) : interactions.finish(),
    cancelAdjustment: (handle?: AdjustmentInteractionHandle | void) => handle
      ? interactions.cancel(handle) : interactions.reset(),
    changeAdjustments: (recipe: Parameters<AdjustmentTransactionController['change']>[0],
      domain?: Parameters<AdjustmentTransactionController['change']>[1], handle?: AdjustmentInteractionHandle | void) => handle
      ? interactions.change(handle, recipe, domain) : interactions.discreteChange(recipe, domain)
  }), [interactions]);
};
