import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { AgentAccessBridge, type AgentAccessCredentialStore } from './agentAccessBridge';

const credentials = { deviceId: 'a'.repeat(24), token: 't'.repeat(43) };
const store = (): AgentAccessCredentialStore => ({
  loadOrCreate: async () => credentials,
  rotate: async () => ({ deviceId: 'b'.repeat(24), token: 'r'.repeat(43) })
});

describe('AgentAccessBridge', () => {
  it('binds loopback, exposes only public health metadata and invokes an authenticated driver', async () => {
    const calls: Array<{ method: string; parameters: unknown }> = [];
    const bridge = new AgentAccessBridge(store(), async (method, parameters) => {
      calls.push({ method, parameters });
      return { documents: [] };
    }, '0.1.0', ['commands', 'artifacts']);
    const status = await bridge.enable();
    expect(status).toMatchObject({ enabled: true, state: 'running', deviceId: credentials.deviceId });
    expect(status.address).toMatch(/^http:\/\/127\.0\.0\.1:/u);

    const health = await fetch(`${status.address}/health`).then((response) => response.json());
    expect(health).toEqual({ status: 'ok', version: '0.1.0' });
    expect(await fetch(`${status.address}/invoke`, { method: 'POST' })).toMatchObject({ status: 401 });
    const response = await fetch(`${status.address}/invoke`, {
      method: 'POST', headers: { authorization: `Bearer ${credentials.token}` },
      body: JSON.stringify({ requestId: 'one', method: 'workspace.query', parameters: {} })
    });
    expect(await response.json()).toMatchObject({ requestId: 'one', status: 'completed' });
    expect(calls).toEqual([{ method: 'workspace.query', parameters: {} }]);
    expect(await bridge.disable()).toMatchObject({ enabled: false, state: 'stopped' });
    await expect(fetch(`${status.address}/health`)).rejects.toThrow();
  });

  it('rejects foreign origins, unknown methods and oversized bodies', async () => {
    const bridge = new AgentAccessBridge(store(), async () => null, '0.1.0', []);
    const status = await bridge.enable();
    const auth = { authorization: `Bearer ${credentials.token}` };
    expect(await fetch(`${status.address}/health`, { headers: { origin: 'https://attacker.example' } }))
      .toMatchObject({ status: 403 });
    expect(await fetch(`${status.address}/invoke`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ requestId: 'x', method: 'window.eval' })
    })).toMatchObject({ status: 400 });
    expect(await fetch(`${status.address}/invoke`, {
      method: 'POST', headers: auth, body: 'x'.repeat(1024 * 1024 + 1)
    })).toMatchObject({ status: 413 });
    await bridge.disable();
  });

  it('reports a configured port conflict without taking over the listener', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Test port unavailable.');
    const bridge = new AgentAccessBridge(store(), async () => null, '0.1.0', []);
    expect(await bridge.enable(address.port)).toMatchObject({ enabled: false, state: 'error' });
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  });

  it('rotates credentials without restarting or changing the listening port', async () => {
    const bridge = new AgentAccessBridge(store(), async () => null, '0.1.0', []);
    const before = await bridge.enable();
    const after = await bridge.rotateCredentials();
    expect(after.port).toBe(before.port);
    expect(after.token).not.toBe(before.token);
    expect(after.deviceId).not.toBe(before.deviceId);
    await bridge.disable();
  });

  it('fails a request cleanly when the renderer driver is unavailable', async () => {
    const bridge = new AgentAccessBridge(store(), async () => {
      throw new Error('renderer unavailable');
    }, '0.1.0', []);
    const status = await bridge.enable();
    const response = await fetch(`${status.address}/invoke`, {
      method: 'POST', headers: { authorization: `Bearer ${credentials.token}` },
      body: JSON.stringify({ requestId: 'crash', method: 'workspace.query' })
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'renderer unavailable' });
    await bridge.disable();
  });
});
