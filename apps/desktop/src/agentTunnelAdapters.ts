import { checkServerIdentity, type TLSSocket } from 'node:tls';
import https from 'node:https';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import type { CredentialProtector } from './agentAccessCredentialStore';
import type {
  AgentApprovalPolicy,
  AgentApprovalPolicyStore,
  AgentPairingClient,
  AgentTunnelConnection,
  AgentTunnelSession,
  AgentTunnelSessionStore,
  AgentTunnelTransport
} from './agentTunnel';
import { atomicWriteFile } from './atomicFileWriter';

const MAX_TUNNEL_MESSAGE_BYTES = 48 * 1024 * 1024;
const MAX_PROTECTED_STATE_BYTES = 1024 * 1024;

const boundedString = (value: unknown, maximum = 32_768): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;
const validSession = (value: unknown): value is AgentTunnelSession => Boolean(
  value && typeof value === 'object'
  && boundedString((value as AgentTunnelSession).serverUrl)
  && boundedString((value as AgentTunnelSession).socketUrl)
  && boundedString((value as AgentTunnelSession).serverId, 1024)
  && /^[a-f\d]{64}$/iu.test((value as AgentTunnelSession).certificateSha256)
  && boundedString((value as AgentTunnelSession).deviceId, 1024)
  && boundedString((value as AgentTunnelSession).sessionToken, 16_384)
  && Number.isFinite((value as AgentTunnelSession).expiresAt)
);
const readProtectedState = async <T>(
  filePath: string,
  protector: CredentialProtector,
  validate: (value: unknown) => value is T
): Promise<T | null> => {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1 || info.size > MAX_PROTECTED_STATE_BYTES) return null;
  const encrypted = new Uint8Array(await readFile(filePath));
  if (encrypted.byteLength !== info.size) return null;
  const value: unknown = JSON.parse(protector.unprotect(encrypted));
  return validate(value) ? value : null;
};
const writeProtectedState = async (
  filePath: string,
  protector: CredentialProtector,
  value: unknown
): Promise<void> => {
  const bytes = protector.protect(JSON.stringify(value));
  if (bytes.byteLength > MAX_PROTECTED_STATE_BYTES) throw new Error('Protected Agent state exceeds the storage boundary.');
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile({ targetPath: filePath, bytes });
};

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
            const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 201) throw new Error('The pairing code was rejected or expired.');
            if (!payload || typeof payload !== 'object') throw new Error('The pairing server returned an invalid session.');
            const observed = fingerprint(observedCertificate.fingerprint256 ?? '');
            if (!/^[a-f\d]{64}$/u.test(observed)) throw new Error('Pairing server identity is unavailable.');
            if (input.expectedCertificateSha256
              && observed !== fingerprint(input.expectedCertificateSha256)) {
              throw new Error('The pairing server certificate does not match the pinned identity.');
            }
            const session = {
              ...payload,
              serverUrl: boundedString((payload as Partial<AgentTunnelSession>).serverUrl)
                ? (payload as Partial<AgentTunnelSession>).serverUrl : input.serverUrl,
              certificateSha256: observed
            };
            if (!validSession(session)) throw new Error('The pairing server returned an invalid session.');
            resolve(session);
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
        maxPayload: MAX_TUNNEL_MESSAGE_BYTES,
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
      return await readProtectedState(this.filePath, this.protector, validSession);
    } catch { return null; }
  }
  async save(session: AgentTunnelSession): Promise<void> {
    if (!this.protector.available()) throw new Error('OS-protected tunnel storage is unavailable.');
    await writeProtectedState(this.filePath, this.protector, session);
  }
  async clear(): Promise<void> { await rm(this.filePath, { force: true }); }
}

export class ProtectedAgentApprovalPolicyStore implements AgentApprovalPolicyStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}
  async load(): Promise<AgentApprovalPolicy | null> {
    if (!this.protector.available()) return null;
    try {
      return await readProtectedState(this.filePath, this.protector, (value): value is AgentApprovalPolicy => Boolean(
        value && typeof value === 'object'
          && (value as AgentApprovalPolicy).version === 1
          && boundedString((value as AgentApprovalPolicy).serverId, 1024)
          && /^[a-f\d]{64}$/iu.test((value as AgentApprovalPolicy).certificateSha256)
          && Array.isArray((value as AgentApprovalPolicy).grants)
          && (value as AgentApprovalPolicy).grants.length <= 1024
          && (value as AgentApprovalPolicy).grants.every((grant) => grant && boundedString(grant.clientId, 1024)
            && Array.isArray(grant.scopes) && grant.scopes.length <= 2
            && grant.scopes.every((scope: unknown) => scope === 'read' || scope === 'edit'))
      ));
    } catch { return null; }
  }
  async save(policy: AgentApprovalPolicy): Promise<void> {
    if (!this.protector.available()) throw new Error('OS-protected approval storage is unavailable.');
    await writeProtectedState(this.filePath, this.protector, policy);
  }
  async clear(): Promise<void> { await rm(this.filePath, { force: true }); }
}
