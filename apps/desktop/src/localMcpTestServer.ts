import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import selfsigned from 'selfsigned';
import type { CredentialProtector } from './agentAccessCredentialStore';
// JavaScript workspace package; Vite bundles this implementation into desktop main.
// @ts-expect-error The MCP server package intentionally publishes runtime JavaScript only.
import { createLightTableMcpApp } from '../../mcp-server/src/server.mjs';
// @ts-expect-error The MCP server package intentionally publishes runtime JavaScript only.
import { EncryptedJsonFileStore } from '../../mcp-server/src/durableState.mjs';
// @ts-expect-error The MCP server package intentionally publishes runtime JavaScript only.
import { DeviceTunnelLightTableClient } from '../../mcp-server/src/deviceTunnelClient.mjs';
import { atomicWriteFile } from './atomicFileWriter';

export interface LocalMcpTestStatus {
  readonly state: 'stopped' | 'starting' | 'running' | 'authorizing' | 'error';
  readonly endpoint?: string;
  readonly message?: string;
  readonly error?: string;
  readonly restartCodexRequired: boolean;
}

interface LocalMcpIdentity {
  readonly certificate: string;
  readonly privateKey: string;
  readonly oauthPairingCode: string;
  readonly devicePairingCode: string;
  readonly stateSecret: string;
  readonly serverId: string;
}

interface LocalMcpService {
  readonly app: any;
  readonly deviceTunnel: {
    readonly connections: Map<string, unknown>;
    handleUpgrade(request: unknown, socket: { destroy(): void }, head: unknown): boolean;
  };
  close(): Promise<void>;
}

const validIdentity = (value: unknown): value is LocalMcpIdentity => Boolean(
  value && typeof value === 'object'
  && typeof (value as LocalMcpIdentity).certificate === 'string'
  && typeof (value as LocalMcpIdentity).privateKey === 'string'
  && typeof (value as LocalMcpIdentity).oauthPairingCode === 'string'
  && typeof (value as LocalMcpIdentity).devicePairingCode === 'string'
  && typeof (value as LocalMcpIdentity).stateSecret === 'string'
  && typeof (value as LocalMcpIdentity).serverId === 'string'
);

class ProtectedLocalMcpIdentityStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}
  async loadOrCreate(): Promise<LocalMcpIdentity> {
    if (!this.protector.available()) throw new Error('OS-protected local MCP storage is unavailable.');
    try {
      const info = await stat(this.filePath);
      if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024) throw new Error('Invalid local MCP identity.');
      const encrypted = new Uint8Array(await readFile(this.filePath));
      if (encrypted.byteLength !== info.size) throw new Error('Local MCP identity changed while reading.');
      const parsed: unknown = JSON.parse(this.protector.unprotect(encrypted));
      if (validIdentity(parsed)) return parsed;
    } catch { /* A missing/corrupt identity is replaced before any server starts. */ }
    const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 3650, keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }
      ] }]
    });
    const nonce = randomBytes(16).toString('hex').toUpperCase();
    const identity: LocalMcpIdentity = {
      certificate: certificate.cert,
      privateKey: certificate.private,
      oauthPairingCode: `LOCAL-${nonce}`,
      devicePairingCode: `DEVICE-${nonce}`,
      stateSecret: randomBytes(48).toString('base64url'),
      serverId: `lighttable-local-${randomBytes(6).toString('hex')}`
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = this.protector.protect(JSON.stringify(identity));
    if (bytes.byteLength > 1024 * 1024) throw new Error('Local MCP identity exceeds the storage boundary.');
    await atomicWriteFile({ targetPath: this.filePath, bytes });
    return identity;
  }
}

class DynamicLocalDeviceClient {
  private client: InstanceType<typeof DeviceTunnelLightTableClient> | null = null;
  constructor(private readonly broker: any) {}
  private inner() {
    const deviceId = [...this.broker.connections.keys()][0];
    if (!deviceId) throw new Error('device-offline');
    if (!this.client || (this.client as { deviceId: string }).deviceId !== deviceId) {
      this.client = new DeviceTunnelLightTableClient({
        broker: this.broker, deviceId, clientId: 'lighttable-local-codex',
        clientName: 'Local Codex', scopes: ['read', 'edit']
      });
    }
    return this.client!;
  }
  invoke(method: string, parameters: unknown) { return this.inner().invoke(method, parameters); }
  uploadArtifact(input: unknown) { return this.inner().uploadArtifact(input); }
  readArtifact(id: string) { return this.inner().readArtifact(id); }
}

const closeServer = (server: HttpServer | HttpsServer) => new Promise<void>((resolve) => {
  server.closeAllConnections?.(); server.close(() => resolve());
});

const quarantineUnreadableOAuthState = async (store: InstanceType<typeof EncryptedJsonFileStore>,
  filePath: string): Promise<boolean> => {
  try {
    store.load();
    return false;
  } catch {
    try {
      await rename(filePath, `${filePath}.invalid-${Date.now()}`);
      return true;
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw reason;
    }
  }
};

const run = (executable: string, args: readonly string[], timeoutMs = 120_000) =>
  new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(executable, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (value) => { output += value.toString(); });
    child.stderr.on('data', (value) => { output += value.toString(); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Codex setup timed out.')); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); resolve({ code: code ?? 1, output }); });
  });

const existing = async (candidate: string): Promise<string | null> => {
  try { await access(candidate); return candidate; } catch { return null; }
};

const findCodexExecutable = async (): Promise<string> => {
  const candidates: string[] = [];
  if (process.env.CODEX_EXECUTABLE) candidates.push(process.env.CODEX_EXECUTABLE);
  if (process.platform === 'win32') {
    const localBin = path.join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
    try {
      for (const entry of await readdir(localBin, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(localBin, entry.name, 'codex.exe'));
      }
    } catch { /* Optional install location. */ }
    const extensions = path.join(process.env.USERPROFILE ?? '', '.vscode', 'extensions');
    try {
      for (const entry of await readdir(extensions, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('openai.chatgpt-')) {
          candidates.push(path.join(extensions, entry.name, 'bin', 'windows-x86_64', 'codex.exe'));
        }
      }
    } catch { /* Optional VS Code extension location. */ }
  }
  const found = (await Promise.all(candidates.map(existing))).filter((value): value is string => Boolean(value));
  if (!found.length) throw new Error('Codex executable was not found. Install Codex or set CODEX_EXECUTABLE.');
  const dated = await Promise.all(found.map(async (file) => ({ file, modified: (await stat(file)).mtimeMs })));
  return dated.sort((left, right) => right.modified - left.modified)[0].file;
};

export class LocalMcpTestServerController {
  private current: LocalMcpTestStatus = { state: 'stopped', restartCodexRequired: false };
  private service: LocalMcpService | null = null;
  private http: HttpServer | null = null;
  private https: HttpsServer | null = null;
  private readonly listeners = new Set<(status: LocalMcpTestStatus) => void>();
  constructor(
    private readonly directory: string,
    protector: CredentialProtector,
    private readonly pairDesktop: (serverUrl: string, code: string) => Promise<unknown>,
    private readonly disconnectDesktop: () => Promise<unknown>,
    private readonly mcpPort = 8787,
    private readonly devicePort = 8788
  ) { this.identityStore = new ProtectedLocalMcpIdentityStore(path.join(directory, 'identity.bin'), protector); }
  private readonly identityStore: ProtectedLocalMcpIdentityStore;
  status() { return this.current; }
  subscribe(listener: (status: LocalMcpTestStatus) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private publish(status: LocalMcpTestStatus) {
    this.current = status; for (const listener of this.listeners) listener(status); return status;
  }
  async start(): Promise<LocalMcpTestStatus> {
    if (this.service) return this.current;
    this.publish({ state: 'starting', message: 'Starting loopback MCP server…', restartCodexRequired: false });
    try {
      const identity = await this.identityStore.loadOrCreate();
      const mcpOrigin = `http://127.0.0.1:${this.mcpPort}`;
      const deviceOrigin = `https://localhost:${this.devicePort}`;
      const oauthStatePath = path.join(this.directory, 'oauth-state.bin');
      const oauthStateStore = new EncryptedJsonFileStore({
        path: oauthStatePath, secret: identity.stateSecret
      });
      const recoveredOAuthState = await quarantineUnreadableOAuthState(oauthStateStore, oauthStatePath);
      let dynamicClient: DynamicLocalDeviceClient;
      this.service = await createLightTableMcpApp({
        publicUrl: mcpOrigin, devicePublicUrl: deviceOrigin,
        pairingCode: identity.oauthPairingCode, devicePairingCode: identity.devicePairingCode,
        serverId: identity.serverId, allowInsecure: true,
        trustedLocalAuthorization: true, allowedHosts: ['127.0.0.1', 'localhost'],
        oauthStateStore,
        client: (broker: unknown) => (dynamicClient = new DynamicLocalDeviceClient(broker))
      }) as LocalMcpService;
      void dynamicClient!;
      this.http = createHttpServer(this.service.app);
      this.https = createHttpsServer({ key: identity.privateKey, cert: identity.certificate }, this.service.app);
      this.https.on('upgrade', (request, socket, head) => {
        if (!this.service?.deviceTunnel.handleUpgrade(request, socket, head)) socket.destroy();
      });
      await Promise.all([
        new Promise<void>((resolve, reject) => this.http!.once('error', reject).listen(this.mcpPort, '127.0.0.1', resolve)),
        new Promise<void>((resolve, reject) => this.https!.once('error', reject).listen(this.devicePort, '127.0.0.1', resolve))
      ]);
      await this.pairDesktop(deviceOrigin, identity.devicePairingCode);
      return this.publish({ state: 'running', endpoint: `${mcpOrigin}/mcp`,
        message: recoveredOAuthState
          ? 'Local MCP recovered unreadable OAuth state. Connect Codex again, then start a fresh session.'
          : 'Local MCP is running. Authorize Codex once, then start a fresh Codex session.',
        restartCodexRequired: true });
    } catch (reason) {
      await this.stop(false);
      return this.publish({ state: 'error', error: reason instanceof Error ? reason.message : String(reason),
        restartCodexRequired: false });
    }
  }
  async authorizeCodex(): Promise<LocalMcpTestStatus> {
    if (!this.service) await this.start();
    if (!this.service || this.current.state === 'error') return this.current;
    const endpoint = this.current.endpoint!;
    this.publish({ ...this.current, state: 'authorizing', message: 'Opening Codex authorization…' });
    try {
      const executable = await findCodexExecutable();
      const configured = await run(executable, ['mcp', 'get', 'lighttable-local'], 15_000);
      if (configured.code !== 0 || !configured.output.includes(endpoint)) {
        if (configured.code === 0) await run(executable, ['mcp', 'remove', 'lighttable-local'], 15_000);
        const added = await run(executable, ['mcp', 'add', 'lighttable-local', '--url', endpoint], 15_000);
        if (added.code !== 0) throw new Error(added.output.trim() || 'Codex MCP registration failed.');
      }
      const login = await run(executable, ['mcp', 'login', 'lighttable-local', '--scopes',
        'lighttable:read,lighttable:edit'], 120_000);
      if (login.code !== 0) throw new Error(login.output.trim() || 'Codex authorization failed.');
      return this.publish({ state: 'running', endpoint,
        message: 'Codex is authorized. Start or reload a Codex session to discover LightTable tools.',
        restartCodexRequired: true });
    } catch (reason) {
      return this.publish({ state: 'running', endpoint,
        error: reason instanceof Error ? reason.message : String(reason), restartCodexRequired: true });
    }
  }
  async stop(disconnect = true): Promise<LocalMcpTestStatus> {
    const http = this.http; const https = this.https; const service = this.service;
    this.http = null; this.https = null; this.service = null;
    if (disconnect) await this.disconnectDesktop().catch(() => undefined);
    await Promise.all([
      ...(http ? [closeServer(http)] : []), ...(https ? [closeServer(https)] : []),
      ...(service ? [service.close()] : [])
    ]).catch(() => undefined);
    return this.publish({ state: 'stopped', restartCodexRequired: false });
  }
}
