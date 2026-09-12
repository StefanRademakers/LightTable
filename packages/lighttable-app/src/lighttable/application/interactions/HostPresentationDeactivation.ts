import type { InteractionTransitionCoordinator } from './InteractionTransitionCoordinator';

export interface HostPresentationDeactivationPorts {
  readonly interactions: Pick<InteractionTransitionCoordinator, 'request'>;
  readonly viewport: { cancelActiveGesture(): void };
  readonly adjustments: { reset(): void };
  readonly rasterGradient: { cancel(): unknown };
  cancelAutoAlign(): void;
}

/** Blur preserves committed/transform state; only active presentation gestures are canceled. */
export const deactivateHostPresentation = (ports: HostPresentationDeactivationPorts): void => {
  void ports.interactions.request('preserve');
  ports.viewport.cancelActiveGesture();
  ports.adjustments.reset();
  ports.rasterGradient.cancel();
  ports.cancelAutoAlign();
};
