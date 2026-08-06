import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const equal = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};
const validDevice = (value) => typeof value === 'string' && /^[a-f\d]{24}$/iu.test(value);

export class DeviceTunnelBroker {
  constructor({ publicUrl, pairingCode, serverId = 'lighttable-mcp', now = () => Date.now() }) {
    this.publicUrl = new URL(publicUrl); this.serverId = serverId; this.now = now;
    this.pairing = { codeHash: hash(pairingCode), expiresAt: now() + 10 * 60_000, attempts: 0, used: false };
    this.sessions = new Map(); this.connections = new Map(); this.clients = new Map();
    this.pending = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, clientTracking: false });
  }

  pair(code, deviceId) {
    if (!validDevice(deviceId)) throw new Error('invalid-device');
    const supplied = hash(code); const record = this.pairing;
    if (record.used || record.expiresAt <= this.now() || record.attempts >= 8
      || !equal(supplied, record.codeHash)) {
      record.attempts += 1;
      throw new Error('invalid-or-expired-code');
    }
    record.used = true;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + 60 * 60_000;
    this.sessions.set(hash(token), { deviceId, expiresAt, revoked: false });
    const socketUrl = new URL('/agent/tunnel', this.publicUrl);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return { serverUrl: this.publicUrl.origin, socketUrl: socketUrl.href,
      serverId: this.serverId, certificateSha256: '0'.repeat(64), deviceId,
      sessionToken: token, expiresAt };
  }

  installRoutes(app) {
    app.post('/agent/pair', (request, response) => {
      try { response.status(201).set('cache-control', 'no-store').json(this.pair(request.body?.code, request.body?.deviceId)); }
      catch { response.status(400).json({ error: 'pairing-rejected' }); }
    });
  }

  handleUpgrade(request, socket, head) {
    const url = new URL(request.url ?? '/', this.publicUrl);
    if (url.pathname !== '/agent/tunnel') return false;
    const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/iu);
    const session = match ? this.sessions.get(hash(match[1])) : null;
    if (!session || session.revoked || session.expiresAt <= this.now()) { socket.destroy(); return true; }
    this.wss.handleUpgrade(request, socket, head, (websocket) => {
      const previous = this.connections.get(session.deviceId); previous?.close(4001, 'replaced');
      this.connections.set(session.deviceId, websocket);
      websocket.on('message', (bytes) => this.receive(session.deviceId, bytes));
      websocket.on('error', () => websocket.close(1009, 'invalid-message'));
      websocket.on('close', () => {
        if (this.connections.get(session.deviceId) === websocket) {
          this.connections.delete(session.deviceId);
          this.rejectPending(session.deviceId, null, 'device-offline');
        }
      });
    });
    return true;
  }

  requestClient(deviceId, client) {
    const socket = this.connections.get(deviceId);
    if (!socket) throw new Error('device-offline');
    const record = { id: client.id, name: String(client.name).slice(0, 128),
      requestedScopes: client.scopes.filter((scope) => scope === 'read' || scope === 'edit'),
      scopes: [], approved: false };
    this.clients.set(`${deviceId}:${client.id}`, record);
    socket.send(JSON.stringify({ type: 'client.request', deviceId, clientId: record.id,
      name: record.name, scopes: record.requestedScopes }));
  }

  revokeClient(deviceId, clientId) {
    this.clients.delete(`${deviceId}:${clientId}`);
    this.connections.get(deviceId)?.send(JSON.stringify({ type: 'client.revoked', deviceId, clientId }));
    this.rejectPending(deviceId, clientId, 'client-revoked');
  }

  revokeDevice(deviceId) {
    for (const session of this.sessions.values()) if (session.deviceId === deviceId) session.revoked = true;
    const socket = this.connections.get(deviceId);
    socket?.send(JSON.stringify({ type: 'session.revoked', deviceId })); socket?.close(4003, 'revoked');
    this.rejectPending(deviceId, null, 'device-revoked');
  }

  rotateSession(deviceId) {
    const current = [...this.sessions.entries()].find(([, session]) => session.deviceId === deviceId && !session.revoked);
    if (!current) throw new Error('unknown-device');
    this.sessions.delete(current[0]); current[1].revoked = true;
    const sessionToken = randomBytes(32).toString('base64url'); const expiresAt = this.now() + 60 * 60_000;
    this.sessions.set(hash(sessionToken), { deviceId, expiresAt, revoked: false });
    this.connections.get(deviceId)?.send(JSON.stringify({ type: 'session.rotated', deviceId, sessionToken, expiresAt }));
    return { expiresAt };
  }

  dropDevice(deviceId) { this.connections.get(deviceId)?.close(1012, 'test/restart'); }

  invoke(deviceId, clientId, method, parameters = {}) {
    const client = this.clients.get(`${deviceId}:${clientId}`);
    const edit = method === 'command.execute' || method.startsWith('gesture.');
    if (!client?.approved || !client.scopes.includes(edit ? 'edit' : 'read')) {
      return Promise.reject(new Error('client-not-approved'));
    }
    const socket = this.connections.get(deviceId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('device-offline'));
    if (this.pending.size >= 64) return Promise.reject(new Error('device-concurrency-limit'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error('device-timeout')); }, 15_000);
      this.pending.set(requestId, { deviceId, clientId, resolve, reject, timeout, chunks: new Map(), chunkTotal: null, chunkBytes: 0 });
      socket.send(JSON.stringify({ type: 'invoke', deviceId, clientId, requestId,
        nonce: randomBytes(18).toString('base64url'), timestamp: this.now(), method, parameters }));
    });
  }

  receive(deviceId, bytes) {
    try {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'result.chunk' && typeof message.requestId === 'string') {
        const pending = this.pending.get(message.requestId);
        if (!pending || pending.deviceId !== deviceId || !Number.isInteger(message.index)
          || !Number.isInteger(message.total) || message.total < 1 || message.total > 128
          || message.index < 0 || message.index >= message.total || typeof message.data !== 'string'
          || message.data.length > 524_288 || (pending.chunkTotal !== null && pending.chunkTotal !== message.total)) return;
        pending.chunkTotal = message.total;
        if (!pending.chunks.has(message.index)) { pending.chunks.set(message.index, message.data); pending.chunkBytes += message.data.length; }
        if (pending.chunkBytes > 48 * 1024 * 1024) { clearTimeout(pending.timeout); this.pending.delete(message.requestId); pending.reject(new Error('artifact-too-large')); }
        return;
      }
      if (message.type === 'result' && typeof message.requestId === 'string') {
        const pending = this.pending.get(message.requestId);
        if (!pending || pending.deviceId !== deviceId) return;
        this.pending.delete(message.requestId); clearTimeout(pending.timeout);
        if (typeof message.error === 'string') pending.reject(new Error(message.error));
        else if (message.value?.bytesChunked === true) {
          if (pending.chunkTotal === null || pending.chunks.size !== pending.chunkTotal) pending.reject(new Error('artifact-chunks-incomplete'));
          else pending.resolve({ ...message.value, bytesChunked: undefined,
            bytesBase64: Array.from({ length: pending.chunkTotal }, (_, index) => pending.chunks.get(index)).join('') });
        } else pending.resolve(message.value);
        return;
      }
      if (message.deviceId !== deviceId || typeof message.clientId !== 'string') return;
      const key = `${deviceId}:${message.clientId}`; const client = this.clients.get(key);
      if (message.type === 'client.approval' && client) {
        const scopes = message.scopes.filter((scope) => client.requestedScopes.includes(scope));
        this.clients.set(key, { ...client, approved: scopes.length > 0, scopes });
      } else if (message.type === 'client.revoke') this.clients.delete(key);
    } catch { /* Hostile messages cannot mutate broker state. */ }
  }

  status(deviceId) {
    return { connected: this.connections.has(deviceId), clients: [...this.clients.entries()]
      .filter(([key]) => key.startsWith(`${deviceId}:`)).map(([, client]) => client) };
  }

  close() {
    for (const socket of this.connections.values()) socket.close(1001, 'server shutdown');
    this.connections.clear(); this.rejectPending(null, null, 'server-shutdown'); this.wss.close();
  }

  rejectPending(deviceId, clientId, reason) {
    for (const [requestId, pending] of this.pending) {
      if ((deviceId && pending.deviceId !== deviceId) || (clientId && pending.clientId !== clientId)) continue;
      clearTimeout(pending.timeout); pending.reject(new Error(reason)); this.pending.delete(requestId);
    }
  }
}
