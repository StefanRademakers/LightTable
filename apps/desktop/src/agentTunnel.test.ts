import { describe, expect, it, vi } from 'vitest';
import {
  AgentTunnelController,
  type AgentTunnelConnection,
  type AgentTunnelSession,
  type AgentTunnelSessionStore,
  type AgentTunnelTransport
} from './agentTunnel';

const deviceId = 'a'.repeat(24);
const session = (now = Date.now()): AgentTunnelSession => ({
  serverUrl: 'https://agent.example', socketUrl: 'wss://agent.example/agent/tunnel',
  serverId: 'test-server', certificateSha256: 'b'.repeat(64), deviceId,
  sessionToken: 's'.repeat(43), expiresAt: now + 60_000
});

const memoryStore = (): AgentTunnelSessionStore & { value: AgentTunnelSession | null } => ({
  value: null,
  async load() { return this.value; },
  async save(value) { this.value = value; },
  async clear() { this.value = null; }
});

const harness = (now = Date.now()) => {
  const sent: unknown[] = [];
  let handlers: Parameters<AgentTunnelTransport['connect']>[1] | null = null;
  const connection: AgentTunnelConnection = { send: (message) => sent.push(message), close: vi.fn(async () => {}) };
  const transport: AgentTunnelTransport = { connect: vi.fn(async (_session, next) => {
    handlers = next; next.onOpen(); return connection;
  }) };
  const store = memoryStore();
  const invoke = vi.fn(async () => ({ ok: true }));
  const pairing = { pair: vi.fn(async () => session(now)) };
  const controller = new AgentTunnelController(deviceId, pairing, transport, store, invoke, () => now);
  return { controller, pairing, transport, store, invoke, sent,
    message: (value: unknown) => handlers?.onMessage(value),
    close: (reason = 'network down') => handlers?.onClose(reason) };
};

describe('AgentTunnelController', () => {
  it('pairs once, pins a bounded session and reconnects without touching documents', async () => {
    const test = harness();
    expect(await test.controller.pair('https://agent.example', 'ABC-123')).toMatchObject({ state: 'connected' });
    expect(test.store.value).toMatchObject({ serverId: 'test-server', deviceId });
    test.close();
    expect(test.controller.status()).toMatchObject({ state: 'degraded' });
    expect(await test.controller.disconnect()).toMatchObject({ state: 'offline' });
    expect(test.store.value).not.toBeNull();
  });

  it('requires explicit scoped client approval and rejects replay and cross-device commands', async () => {
    const now = Date.now(); const test = harness(now);
    await test.controller.pair('https://agent.example', 'ABC-123');
    test.message({ type: 'client.request', deviceId, clientId: 'client-1', name: 'Design agent', scopes: ['read', 'edit'] });
    await Promise.resolve();
    expect(test.controller.status().clients[0]).toMatchObject({ approved: false, scopes: [] });
    test.message({ type: 'invoke', deviceId, clientId: 'client-1', requestId: 'before', nonce: 'n0',
      timestamp: now, method: 'workspace.query' });
    await Promise.resolve();
    expect(test.sent).toContainEqual({ type: 'result', requestId: 'before', error: 'client-not-approved' });
    await test.controller.approveClient('client-1', ['read']);
    test.message({ type: 'invoke', deviceId: 'other-device', clientId: 'client-1', requestId: 'cross', nonce: 'n1',
      timestamp: now, method: 'workspace.query' });
    test.message({ type: 'invoke', deviceId, clientId: 'client-1', requestId: 'read', nonce: 'n2',
      timestamp: now, method: 'workspace.query', parameters: {} });
    await vi.waitFor(() => expect(test.invoke).toHaveBeenCalledTimes(1));
    test.message({ type: 'invoke', deviceId, clientId: 'client-1', requestId: 'replay', nonce: 'n2',
      timestamp: now, method: 'workspace.query' });
    test.message({ type: 'invoke', deviceId, clientId: 'client-1', requestId: 'edit', nonce: 'n3',
      timestamp: now, method: 'command.execute' });
    await Promise.resolve();
    expect(test.sent).toContainEqual({ type: 'result', requestId: 'replay', error: 'replay-rejected' });
    expect(test.sent).toContainEqual({ type: 'result', requestId: 'edit', error: 'client-not-approved' });
    await test.controller.approveClient('client-1', ['read', 'edit']);
    expect(test.controller.status().clients[0]).toMatchObject({ approved: true, scopes: ['read', 'edit'] });
    expect(test.sent).toContainEqual({ type: 'client.approval', deviceId, clientId: 'client-1', scopes: ['read', 'edit'] });
    test.message({ type: 'invoke', deviceId, clientId: 'client-1', requestId: 'edit-after-upgrade', nonce: 'n4',
      timestamp: now, method: 'command.execute' });
    await vi.waitFor(() => expect(test.invoke).toHaveBeenCalledTimes(2));
    expect(test.sent).toContainEqual({ type: 'result', requestId: 'edit-after-upgrade', value: { ok: true } });
  });

  it('rejects insecure servers, expired sessions and clears all access on revoke', async () => {
    const now = Date.now(); const test = harness(now);
    expect(await test.controller.pair('http://agent.example', 'ABC-123')).toMatchObject({ state: 'offline' });
    test.pairing.pair.mockResolvedValueOnce({ ...session(now), expiresAt: now - 1 });
    expect(await test.controller.pair('https://agent.example', 'ABC-123')).toMatchObject({ state: 'offline' });
    await test.controller.pair('https://agent.example', 'ABC-123');
    test.message({ type: 'session.revoked', deviceId });
    await vi.waitFor(() => expect(test.controller.status().state).toBe('revoked'));
    expect(test.store.value).toBeNull();
    expect(test.controller.status().clients).toEqual([]);
  });

  it('bounds privacy-safe event history', async () => {
    const test = harness(); await test.controller.pair('https://agent.example', 'ABC-123');
    for (let index = 0; index < 140; index += 1) {
      test.message({ type: 'client.request', deviceId, clientId: `client-${index}`, name: `Agent ${index}`, scopes: ['read'] });
    }
    await Promise.resolve();
    expect(test.controller.status().events).toHaveLength(100);
  });

  it('persists a rotated short-lived session without exposing its token in events', async () => {
    const now = Date.now(); const test = harness(now);
    await test.controller.pair('https://agent.example', 'ABC-123');
    const nextToken = 'n'.repeat(43);
    test.message({ type: 'session.rotated', deviceId, sessionToken: nextToken, expiresAt: now + 120_000 });
    await vi.waitFor(() => expect(test.store.value?.sessionToken).toBe(nextToken));
    expect(JSON.stringify(test.controller.status().events)).not.toContain(nextToken);
  });

  it('pins the observed server identity on a same-origin re-pair', async () => {
    const test = harness();
    await test.controller.pair('https://agent.example', 'ABC-123');
    await test.controller.pair('https://agent.example', 'NEW-456');
    expect(test.pairing.pair).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedCertificateSha256: 'b'.repeat(64)
    }));
  });

  it('restores a protected session after restart and reconnects without pairing again', async () => {
    const now = Date.now(); const test = harness(now);
    test.store.value = session(now);
    expect(await test.controller.restore()).toMatchObject({ state: 'connected', deviceId });
    expect(test.pairing.pair).not.toHaveBeenCalled();
    expect(test.transport.connect).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'test-server', deviceId
    }), expect.any(Object));
  });

  it('transfers bounded artifacts over the JSON tunnel without weakening edit scopes', async () => {
    const now = Date.now(); const test = harness(now); await test.controller.pair('https://agent.example', 'ABC-123');
    test.message({ type: 'client.request', deviceId, clientId: 'asset-client', name: 'Asset client', scopes: ['read', 'edit'] });
    await test.controller.approveClient('asset-client', ['read']);
    test.message({ type: 'invoke', deviceId, clientId: 'asset-client', requestId: 'upload-denied', nonce: 'asset-1',
      timestamp: now, method: 'artifact.register', parameters: { bytesBase64: 'AQID', name: 'asset.bin' } });
    await Promise.resolve();
    expect(test.sent).toContainEqual({ type: 'result', requestId: 'upload-denied', error: 'client-not-approved' });
    await test.controller.approveClient('asset-client', ['read', 'edit']);
    test.invoke.mockResolvedValueOnce({ ok: true });
    test.message({ type: 'invoke', deviceId, clientId: 'asset-client', requestId: 'upload', nonce: 'asset-2',
      timestamp: now, method: 'artifact.register', parameters: { bytesBase64: 'AQID', name: 'asset.bin' } });
    await vi.waitFor(() => expect(test.invoke).toHaveBeenCalledWith('artifact.register', expect.objectContaining({
      bytes: new Uint8Array([1, 2, 3])
    })));
  });

  it('surfaces named design progress and offers one-step undo after completion', async () => {
    const now = Date.now(); const test = harness(now); await test.controller.pair('https://agent.example', 'ABC-123');
    test.message({ type: 'client.request', deviceId, clientId: 'design-client', name: 'Design client', scopes: ['read', 'edit'] });
    await test.controller.approveClient('design-client', ['read', 'edit']);
    test.message({ type: 'invoke', deviceId, clientId: 'design-client', requestId: 'design', nonce: 'design-1',
      timestamp: now, method: 'command.execute', parameters: { documentId: 'document-1', command: 'command.batch',
        commandParameters: { name: 'Create launch card', operations: [] } } });
    await vi.waitFor(() => expect(test.controller.status().activity).toMatchObject({
      name: 'Create launch card', status: 'completed', progress: 1, documentId: 'document-1'
    }));
    test.invoke.mockResolvedValueOnce({ status: 'completed', artifact: {
      id: 'artifact-preview', name: 'launch-card.png', mediaType: 'image/png'
    } } as never);
    test.message({ type: 'invoke', deviceId, clientId: 'design-client', requestId: 'preview', nonce: 'design-2',
      timestamp: now, method: 'task.query', parameters: { documentId: 'document-1', taskId: 'preview-task' } });
    await vi.waitFor(() => expect(test.controller.status().activity?.results).toEqual([
      { id: 'artifact-preview', name: 'launch-card.png', mediaType: 'image/png' }
    ]));
    await test.controller.undoActivity();
    expect(test.invoke).toHaveBeenLastCalledWith('command.execute', expect.objectContaining({
      documentId: 'document-1', command: 'history.undo'
    }));
    expect(test.controller.status().activity).toBeUndefined();
  });
});
