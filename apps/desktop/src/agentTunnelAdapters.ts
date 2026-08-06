import { checkServerIdentity, type TLSSocket } from 'node:tls';
import https from 'node:https';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import type { CredentialProtector } from './agentAccessCredentialStore';
import type {
  AgentPairingClient,
  AgentTunnelConnection,
  AgentTunnelSession,
  AgentTunnelSessionStore,
  AgentTunnelTransport
} from './agentTunnel';

const fingerprint = (value: string): string => value.replaceAll(':', '').toLowerCase();
const local = (url: URL): boolean => url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';

export class HttpsAgentPairingClient implements AgentPairingClient {
  constructor(private readonly allowInsecureLocalhost = false) {}

  pair(input: Parameters<AgentPairingClient['pair']>[0]): Promise<AgentTunnelSession> {
    const endpoint = new URL('/agent/pair', input.serverUrl);
    const body = Buffer.from(JSON.stringify({ code: input.code, deviceId: input.deviceId }));
    const insecure = this.allowInsecureLocalhost && local(endpoint);
    return new Promise((resolve, reject) => {
      const request = https.request(endpoint, {
        method: 'POST', rejectUnauthorized: !insecure,
        headers: { 'content-type': 'application/json', 'content-length': body.byteLength },
        checkServerIdentity: (host, certificate) => {
          const standard = checkServerIdentity(host, certificate);
          if (standard) return standard;
          if (input.expectedCertificateSha256
            && fingerprint(certificate.fingerprint256) !== fingerprint(input.expectedCertificateSha256)) {
            return new Error('The pairing server certificate does not match the pinned identity.');
          }
          return undefined;
        }
      }, (response) => {
        const observedCertificate = (response.socket as TLSSocket).getPeerCertificate();
        const chunks: Buffer[] = []; let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.byteLength;
          if (length > 64 * 1024) request.destroy(new Error('Pairing response is too large.'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AgentTunnelSession;
            if (response.statusCode !== 201) throw new Error('The pairing code was rejected or expired.');
            const observed = fingerprint(observedCertificate.fingerprint256 ?? '');
            if (!/^[a-f\d]{64}$/u.test(observed)) throw new Error('Pairing server identity is unavailable.');
            if (input.expectedCertificateSha256
              && observed !== fingerprint(input.expectedCertificateSha256)) {
              throw new Error('The pairing server certificate does not match the pinned identity.');
            }
            resolve({ ...payload, certificateSha256: observed });
          } catch (reason) { reject(reason); }
        });
      });
      request.once('error', reject);
      request.end(body);
    });
  }
}

export class WebSocketAgentTunnelTransport implements AgentTunnelTransport {
  constructor(private readonly allowInsecureLocalhost = false) {}

  connect(session: AgentTunnelSession, handlers: Parameters<AgentTunnelTransport['connect']>[1]): Promise<AgentTunnelConnection> {
    const url = new URL(session.socketUrl);
    if (url.protocol !== 'wss:') return Promise.reject(new Error('Agent tunnel URLs must use WSS.'));
    const insecure = this.allowInsecureLocalhost && local(url);
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url, {
        rejectUnauthorized: !insecure,
        headers: { authorization: `Bearer ${session.sessionToken}` }
      });
      socket.once('upgrade', (response) => {
        const observed = fingerprint((response.socket as TLSSocket).getPeerCertificate().fingerprint256 ?? '');
        if (observed !== fingerprint(session.certificateSha256)) {
          socket.terminate();
          if (!settled) reject(new Error('The tunnel server certificate does not match the paired identity.'));
        }
      });
      socket.once('open', () => {
        settled = true;
        handlers.onOpen();
        resolve({
          send: (message) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
          },
          close: () => new Promise<void>((done) => {
            if (socket.readyState === WebSocket.CLOSED) return done();
            socket.once('close', () => done()); socket.close(1000, 'LightTable stopped Agent Access');
          })
        });
      });
      socket.on('message', (data) => {
        try { handlers.onMessage(JSON.parse(data.toString())); } catch { /* Hostile non-JSON messages are ignored. */ }
      });
      socket.on('close', (_code, reason) => handlers.onClose(reason.toString()));
      socket.on('error', (reason) => { if (!settled) reject(reason); });
    });
  }
}

export class ProtectedAgentTunnelSessionStore implements AgentTunnelSessionStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}
  async load(): Promise<AgentTunnelSession | null> {
    if (!this.protector.available()) return null;
    try {
      return JSON.parse(this.protector.unprotect(new Uint8Array(await readFile(this.filePath)))) as AgentTunnelSession;
    } catch { return null; }
  }
  async save(session: AgentTunnelSession): Promise<void> {
    if (!this.protector.available()) throw new Error('OS-protected tunnel storage is unavailable.');
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.protector.protect(JSON.stringify(session)), { mode: 0o600 });
  }
  async clear(): Promise<void> { await rm(this.filePath, { force: true }); }
}
