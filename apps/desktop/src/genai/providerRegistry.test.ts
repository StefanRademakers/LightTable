import { describe, expect, it, vi } from 'vitest';
import type { DesktopGenAiProviderController } from './providerRegistry';
import { GenAiProviderRegistry } from './providerRegistry';
import type { GenAiProviderId, GenAiProviderSnapshot } from '@lighttable/genai-core';

const controller = (id: string): DesktopGenAiProviderController => {
  let listener: ((snapshot: GenAiProviderSnapshot) => void) | undefined;
  const snapshot = { id: id as GenAiProviderId, label: id, status: 'disconnected' as const };
  return {
    providerId: snapshot.id,
    snapshot: () => snapshot,
    subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
    connect: async () => { listener?.({ ...snapshot, status: 'connected' }); return snapshot; },
    disconnect: async () => snapshot,
    listModels: async () => [],
    loadWorkflow: async () => { throw new Error('unused'); },
    estimateCost: async () => null
  };
};

describe('GenAiProviderRegistry', () => {
  it('routes provider calls without knowing provider-specific implementations', async () => {
    const registry = new GenAiProviderRegistry();
    const local = controller('lighttable-local');
    const openArt = controller('openart');
    registry.register(openArt);
    registry.register(local);
    expect(registry.snapshots().map(({ id }) => id)).toEqual(['openart', 'lighttable-local']);
    expect(registry.provider(local.providerId)).toBe(local);
    expect(() => registry.provider('missing' as GenAiProviderId)).toThrow(
      'Unsupported GenAI provider: missing.'
    );
  });

  it('publishes changes from every registered provider through one channel', async () => {
    const registry = new GenAiProviderRegistry();
    const local = controller('lighttable-local');
    registry.register(local);
    const listener = vi.fn();
    registry.subscribe(listener);
    await local.connect();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'lighttable-local', status: 'connected' }));
  });

  it('can remove and re-register a provider without retaining its old subscription', async () => {
    const registry = new GenAiProviderRegistry();
    const first = controller('local-http');
    const replacement = controller('local-http');
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(first);
    registry.unregister(first.providerId);
    await first.connect();
    expect(listener).not.toHaveBeenCalled();
    registry.register(replacement);
    await replacement.connect();
    expect(listener).toHaveBeenCalledOnce();
    expect(registry.provider(replacement.providerId)).toBe(replacement);
  });
});
