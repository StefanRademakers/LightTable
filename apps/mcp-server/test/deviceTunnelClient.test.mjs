import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceTunnelLightTableClient } from '../src/deviceTunnelClient.mjs';

test('outbound device client requests approval then carries commands and artifacts', async () => {
  const clients = []; const calls = [];
  const broker = {
    status: () => ({ connected: true, clients }),
    requestClient: (_deviceId, client) => clients.push({ ...client, approved: false, requestedScopes: client.scopes, scopes: [] }),
    invoke: async (_deviceId, _clientId, method, parameters) => {
      calls.push({ method, parameters });
      if (method === 'artifact.resolve') return { bytesBase64: 'AQID', name: 'preview.png', mediaType: 'image/png' };
      return { id: 'artifact-1' };
    }
  };
  const client = new DeviceTunnelLightTableClient({ broker, deviceId: 'a'.repeat(24), clientId: 'mcp-client' });
  await assert.rejects(client.invoke('workspace.query'), /approval-required/u);
  clients[0] = { ...clients[0], approved: true, scopes: ['read', 'edit'] };
  assert.deepEqual(await client.invoke('workspace.query'), { id: 'artifact-1' });
  assert.deepEqual(await client.uploadArtifact({ bytes: new Uint8Array([1, 2, 3]), name: 'input.png', mediaType: 'image/png' }),
    { id: 'artifact-1' });
  const artifact = await client.readArtifact('artifact-1');
  assert.deepEqual([...artifact.bytes], [1, 2, 3]);
  assert.equal(calls.find(({ method }) => method === 'artifact.register').parameters.bytesBase64, 'AQID');
});
