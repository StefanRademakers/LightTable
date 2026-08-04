import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedLightTableMcpAdapter,
  LIGHTTABLE_MCP_PROTOCOL_VERSION
} from './lightTableMcpAdapter';
import type { LightTableAutomationDriver } from './lightTableCommandService';

const token = '0123456789abcdef0123456789abcdef';

const createDriver = (): LightTableAutomationDriver => ({
  beginGesture: vi.fn(async () => ({ status: 'started' as const, gestureId: 'gesture-1', sampleCount: 1 })),
  updateGesture: vi.fn(async () => ({ status: 'updated' as const, gestureId: 'gesture-1', sampleCount: 2 })),
  finishGesture: vi.fn(async () => ({ status: 'completed' as const, gestureId: 'gesture-1', sampleCount: 2 })),
  registerInputArtifact: vi.fn(),
  queryArtifact: vi.fn(() => null),
  listArtifacts: vi.fn(() => []),
  releaseArtifact: vi.fn(() => true),
  queryTask: vi.fn(() => null),
  queryWorkspace: vi.fn(() => ({ revision: 1, activeDocumentId: null, documents: [] })),
  queryDocument: vi.fn(() => null),
  queryLayers: vi.fn(() => null),
  queryLayerEffects: vi.fn(() => null),
  queryCapabilities: vi.fn(() => null),
  execute: vi.fn(async (request: unknown) => ({
    requestId: (request as { requestId: string }).requestId,
    status: 'completed' as const, value: {}, revisions: { workspace: 1 }
  }))
});

const request = (method: string, parameters: Record<string, unknown> = {}, suppliedToken = token) => ({
  protocolVersion: LIGHTTABLE_MCP_PROTOCOL_VERSION,
  requestId: `request-${method}`,
  token: suppliedToken,
  method,
  parameters
});

describe('AuthenticatedLightTableMcpAdapter', () => {
  it('is opt-in and authenticates short-lived capability tokens', async () => {
    const driver = createDriver();
    const disabled = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: false, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await disabled.invoke(request('workspace.query'))).toMatchObject({
      status: 'rejected', code: 'adapter-disabled'
    });
    const enabled = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await enabled.invoke(request('workspace.query', {}, 'wrong-token-value-that-is-long')))
      .toMatchObject({ status: 'rejected', code: 'authentication-failed' });
    expect(await enabled.invoke(request('workspace.query')))
      .toMatchObject({ status: 'completed', value: { revision: 1 } });
  });

  it('allows only the explicit command surface and supports revocation', async () => {
    const driver = createDriver();
    const adapter = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000
    });
    expect(await adapter.invoke(request('command.execute', {
      command: 'layer.rename', documentId: 'document-1',
      commandRequestId: 'rename-1', commandParameters: { layerId: 'layer-1', name: 'Renamed' }
    }))).toMatchObject({ status: 'completed' });
    expect(driver.execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'layer.rename' }));
    expect(await adapter.invoke(request('command.execute', { command: 'file.openArtifact' })))
      .toMatchObject({ status: 'rejected', code: 'command-not-allowed' });
    adapter.revoke();
    expect(await adapter.invoke(request('artifact.list')))
      .toMatchObject({ status: 'rejected', code: 'session-revoked' });
    expect(adapter.activity()).toHaveLength(3);
  });

  it('expires and bounds sessions and their activity history', async () => {
    const driver = createDriver();
    const expired = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 1_000, now: () => 1_000
    });
    expect(await expired.invoke(request('workspace.query')))
      .toMatchObject({ status: 'rejected', code: 'session-expired' });

    const bounded = new AuthenticatedLightTableMcpAdapter({
      driver, enabled: true, token, expiresAt: 2_000, now: () => 1_000, requestLimit: 1
    });
    expect((await bounded.invoke(request('workspace.query'))).status).toBe('completed');
    expect(await bounded.invoke(request('workspace.query')))
      .toMatchObject({ status: 'rejected', code: 'request-limit-reached' });
  });
});
