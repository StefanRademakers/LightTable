import { describe, expect, it } from 'vitest';
import type { GenAiProviderId, GenAiProviderSnapshot } from './contracts';
import { transitionGenAiProvider } from './providerState';

const snapshot = (status: GenAiProviderSnapshot['status']): GenAiProviderSnapshot => ({
  id: 'openart' as GenAiProviderId,
  label: 'OpenArt',
  status
});

describe('transitionGenAiProvider', () => {
  it('supports an explicit connection lifecycle', () => {
    const connecting = transitionGenAiProvider(snapshot('disconnected'), 'connecting');
    const connected = transitionGenAiProvider(connecting, 'connected', { connectedAt: 42 });
    const expired = transitionGenAiProvider(connected, 'expired', { message: 'Sign in again.' });

    expect(connected).toMatchObject({ status: 'connected', connectedAt: 42 });
    expect(expired).toMatchObject({ status: 'expired', message: 'Sign in again.' });
  });

  it('rejects impossible direct transitions', () => {
    expect(() => transitionGenAiProvider(snapshot('disconnected'), 'connected'))
      .toThrow('disconnected -> connected');
  });
});
