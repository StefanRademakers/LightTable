import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { DeviceTunnelBroker } from '../src/deviceTunnel.mjs';

const open = (url, token) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.once('open', () => resolve(socket)); socket.once('error', reject);
});
const message = (socket) => new Promise((resolve) => socket.once('message', (bytes) => resolve(JSON.parse(bytes.toString()))));

test('device tunnel consumes one-time pairing and isolates approved clients by device', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const publicUrl = `http://127.0.0.1:${address.port}`;
  const broker = new DeviceTunnelBroker({ publicUrl, pairingCode: 'ONE-TIME-123', serverId: 'local-test' });
  server.on('upgrade', (request, socket, head) => {
    if (!broker.handleUpgrade(request, socket, head)) socket.destroy();
  });
  const deviceId = 'a'.repeat(24);
  const session = broker.pair('ONE-TIME-123', deviceId);
  assert.throws(() => broker.pair('ONE-TIME-123', 'b'.repeat(24)), /invalid-or-expired/u);
  const socket = await open(session.socketUrl, session.sessionToken);
  const pending = message(socket);
  broker.requestClient(deviceId, { id: 'client-1', name: 'Test agent', scopes: ['read', 'edit'] });
  assert.deepEqual(await pending, { type: 'client.request', deviceId, clientId: 'client-1',
    name: 'Test agent', scopes: ['read', 'edit'] });
  socket.send(JSON.stringify({ type: 'client.approval', deviceId, clientId: 'client-1', scopes: ['read'] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(broker.status(deviceId), { connected: true, clients: [{
    id: 'client-1', name: 'Test agent', requestedScopes: ['read', 'edit'], scopes: ['read'], approved: true
  }] });
  const secondPending = message(socket);
  broker.requestClient(deviceId, { id: 'client-2', name: 'Export agent', scopes: ['read', 'edit'] });
  assert.equal((await secondPending).clientId, 'client-2');
  socket.send(JSON.stringify({ type: 'client.approval', deviceId, clientId: 'client-2', scopes: ['edit'] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(broker.status(deviceId).clients.map(({ id, scopes }) => ({ id, scopes })), [
    { id: 'client-1', scopes: ['read'] }, { id: 'client-2', scopes: ['edit'] }
  ]);
  broker.revokeClient(deviceId, 'client-1');
  assert.deepEqual(broker.status(deviceId).clients.map(({ id, scopes }) => ({ id, scopes })), [
    { id: 'client-2', scopes: ['edit'] }
  ]);
  broker.revokeDevice(deviceId);
  await new Promise((resolve) => socket.once('close', resolve));
  assert.equal(broker.status(deviceId).connected, false);
  broker.close(); await new Promise((resolve) => server.close(resolve));
});

test('device tunnel rejects invalid tokens and hostile messages', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const broker = new DeviceTunnelBroker({ publicUrl: `http://127.0.0.1:${address.port}`,
    pairingCode: 'ONE-TIME-456' });
  server.on('upgrade', (request, socket, head) => broker.handleUpgrade(request, socket, head));
  const session = broker.pair('ONE-TIME-456', 'c'.repeat(24));
  await assert.rejects(open(session.socketUrl, 'wrong-token'));
  const socket = await open(session.socketUrl, session.sessionToken);
  socket.send('{broken json'); socket.send(JSON.stringify({ deviceId: 'other-device', type: 'client.approval' }));
  assert.deepEqual(broker.status(session.deviceId).clients, []);
  socket.close(); broker.close(); await new Promise((resolve) => server.close(resolve));
});
