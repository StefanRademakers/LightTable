import type { GenAiProviderSnapshot, GenAiProviderStatus } from './contracts';

const ALLOWED_PROVIDER_TRANSITIONS: Record<GenAiProviderStatus, readonly GenAiProviderStatus[]> = {
  disconnected: ['connecting'],
  connecting: ['connected', 'disconnected', 'error', 'expired'],
  connected: ['connecting', 'disconnected', 'expired', 'error'],
  error: ['connecting', 'disconnected'],
  expired: ['connecting', 'disconnected']
};

export const transitionGenAiProvider = (
  current: GenAiProviderSnapshot,
  status: GenAiProviderStatus,
  change: Pick<GenAiProviderSnapshot, 'message' | 'connectedAt'> = {}
): GenAiProviderSnapshot => {
  if (current.status === status) return { ...current, ...change };
  if (!ALLOWED_PROVIDER_TRANSITIONS[current.status].includes(status)) {
    throw new Error(`Invalid GenAI provider transition: ${current.status} -> ${status}`);
  }
  return {
    ...current,
    status,
    message: change.message,
    connectedAt: status === 'connected' ? change.connectedAt : current.connectedAt
  };
};
