import { expect, it, vi } from 'vitest';
import { createInteractionTransitionCoordinator } from './InteractionTransitionCoordinator';
import { deactivateHostPresentation } from './HostPresentationDeactivation';

it('preserves selection/transform ownership and synchronously cancels only the named presentation participants in order', () => {
  const order: string[] = [], settle = vi.fn(async () => {});
  const coordinator = createInteractionTransitionCoordinator({ settleMountedInteraction: settle, reportFailure: vi.fn() });
  deactivateHostPresentation({
    interactions: { request: (policy, scope) => { order.push(policy); return coordinator.request(policy, scope); } },
    viewport: { cancelActiveGesture: () => { order.push('viewport'); } },
    adjustments: { reset: () => { order.push('adjustment'); } },
    rasterGradient: { cancel: () => { order.push('raster-gradient'); } },
    cancelAutoAlign: () => { order.push('auto-align'); }
  });
  expect(order).toEqual(['preserve', 'viewport', 'adjustment', 'raster-gradient', 'auto-align']);
  expect(settle).not.toHaveBeenCalled();
});
it('does not disguise a real participant failure as successful deactivation or attempt alternate cleanup', () => {
  const later = vi.fn();
  expect(() => deactivateHostPresentation({
    interactions: { request: async () => ({ status: 'admitted' }) },
    viewport: { cancelActiveGesture: () => { throw new Error('Gesture cleanup failed'); } },
    adjustments: { reset: later }, rasterGradient: { cancel: later }, cancelAutoAlign: later
  })).toThrow('Gesture cleanup failed');
  expect(later).not.toHaveBeenCalled();
});
