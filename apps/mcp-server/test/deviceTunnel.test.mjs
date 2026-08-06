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
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('Timed out waiting for tunnel state.');
};

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
  await waitFor(() => broker.status(deviceId).clients[0]?.approved === true);
  assert.deepEqual(broker.status(deviceId), { connected: true, clients: [{
    id: 'client-1', name: 'Test agent', requestedScopes: ['read', 'edit'], scopes: ['read'], approved: true
  }] });
  const secondPending = message(socket);
  broker.requestClient(deviceId, { id: 'client-2', name: 'Export agent', scopes: ['read', 'edit'] });
  assert.equal((await secondPending).clientId, 'client-2');
  socket.send(JSON.stringify({ type: 'client.approval', deviceId, clientId: 'client-2', scopes: ['edit'] }));
  await waitFor(() => broker.status(deviceId).clients.find(({ id }) => id === 'client-2')?.approved === true);
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

test('long command/reconnect soak leaves no cross-talk or orphan requests', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); const deviceId = 'd'.repeat(24);
  const broker = new DeviceTunnelBroker({ publicUrl: `http://127.0.0.1:${address.port}`,
    pairingCode: 'SOAK-ONE-TIME' });
  server.on('upgrade', (request, socket, head) => broker.handleUpgrade(request, socket, head));
  const session = broker.pair('SOAK-ONE-TIME', deviceId);
  let socket = await open(session.socketUrl, session.sessionToken);
  const approval = message(socket); broker.requestClient(deviceId, {
    id: 'soak-client', name: 'Soak client', scopes: ['read', 'edit']
  }); await approval;
  socket.send(JSON.stringify({ type: 'client.approval', deviceId, clientId: 'soak-client', scopes: ['read', 'edit'] }));
  await waitFor(() => broker.status(deviceId).clients[0]?.approved === true);
  const serve = (target) => {
    const responder = (bytes) => {
    const request = JSON.parse(bytes.toString());
    if (request.type === 'invoke') target.send(JSON.stringify({ type: 'result',
      requestId: request.requestId, value: { sequence: request.parameters.sequence, deviceId } }));
    };
    target.on('message', responder); return responder;
  };
  let responder = serve(socket);
  for (let sequence = 0; sequence < 100; sequence += 1) {
    assert.deepEqual(await broker.invoke(deviceId, 'soak-client', 'workspace.query', { sequence }),
      { sequence, deviceId });
  }
  socket.off('message', responder);
  const orphan = broker.invoke(deviceId, 'soak-client', 'workspace.query', { sequence: 'orphan' });
  socket.close(); await assert.rejects(orphan, /device-offline/u);
  socket = await open(session.socketUrl, session.sessionToken); responder = serve(socket);
  for (let sequence = 100; sequence < 200; sequence += 1) {
    assert.deepEqual(await broker.invoke(deviceId, 'soak-client', 'workspace.query', { sequence }),
      { sequence, deviceId });
  }
  assert.equal(broker.pending.size, 0); assert.equal(broker.status('e'.repeat(24)).clients.length, 0);
  socket.close(); broker.close(); await new Promise((resolve) => server.close(resolve));
});
