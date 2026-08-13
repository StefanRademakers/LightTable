import type { SmartSelectionBackend } from './SmartSelectionBackend';
import { BalancedSmartSelectionBackend } from './BalancedSmartSelectionBackend';
import { Sam2SmartSelectionBackend } from './Sam2SmartSelectionBackend';
import { SlimSamSmartSelectionBackend } from './SlimSamSmartSelectionBackend';

export type SmartSelectionBackendProfile = 'balanced' | 'sam2-small' | 'slimsam';

export const createSmartSelectionBackend = (
  profile: SmartSelectionBackendProfile = 'balanced'
): SmartSelectionBackend => {
  if (profile === 'sam2-small') return new Sam2SmartSelectionBackend();
  if (profile === 'slimsam') return new SlimSamSmartSelectionBackend();
  return new BalancedSmartSelectionBackend();
};

/** Development-only comparison hook used by the repeatable desktop benchmark. */
export const configuredSmartSelectionBackendProfile = (): SmartSelectionBackendProfile => {
  if (!import.meta.env.DEV) return 'balanced';
  const requested = new URLSearchParams(globalThis.location.search)
    .get('lighttable-smart-selection-backend');
  return requested === 'sam2-small' || requested === 'slimsam' ? requested : 'balanced';
};
