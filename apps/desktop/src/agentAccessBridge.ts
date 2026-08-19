import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export interface AgentAccessCredentials {
  readonly deviceId: string;
  readonly token: string;
}

export interface AgentAccessCredentialStore {
  loadOrCreate(): Promise<AgentAccessCredentials>;
  rotate(): Promise<AgentAccessCredentials>;
}

export interface AgentAccessStatus {
  readonly supported: true;
  readonly enabled: boolean;
  readonly state: 'stopped' | 'starting' | 'running' | 'error';
  readonly address?: string;
  readonly port?: number;
  readonly deviceId?: string;
  readonly token?: string;
  readonly error?: string;
}

export type AgentAccessRendererInvoker = (method: string, parameters: unknown) => Promise<unknown>;

const INVOKE_BODY_LIMIT = 1024 * 1024;
const ARTIFACT_BODY_LIMIT = 32 * 1024 * 1024;
const AUTOMATIC_PORT_ATTEMPTS = 8;
// Fetch Standard bad-port list, mirrored by Chromium and Node/Undici. Agent
// Access clients use Fetch, so publishing one of these listening ports creates
// a bridge that is healthy at the TCP layer but unreachable by its clients.
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080
]);
const INVOKE_METHODS = new Set([
  'workspace.query', 'document.query', 'layer.list', 'layer.effects', 'text.query',
  'vector.query', 'command.capabilities', 'task.query', 'task.events',
  'artifact.list', 'artifact.query', 'artifact.release', 'gesture.begin',
  'gesture.update', 'gesture.finish', 'command.execute'
]);

export const isFetchForbiddenPort = (port: number): boolean => FETCH_FORBIDDEN_PORTS.has(port);

export interface AgentAccessBridgeOptions {
  /** Test seam for deterministic automatic-port lifecycle coverage. */
  readonly automaticPortCandidates?: readonly number[];
}

const json = (response: ServerResponse, status: number, value: unknown): void => {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(bytes);
};

const readBody = async (request: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > limit) throw new RangeError('request-body-too-large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

const authorized = (header: string | undefined, token: string): boolean => {
  const supplied = Buffer.from((header ?? '').replace(/^Bearer\s+/iu, ''));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const validOrigin = (origin: string | undefined, port: number): boolean => {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
};

export class AgentAccessBridge {
  private server: Server | null = null;
  private credentials: AgentAccessCredentials | null = null;
  private readonly sockets = new Set<Socket>();
  private current: AgentAccessStatus = { supported: true, enabled: false, state: 'stopped' };
  private readonly listeners = new Set<(status: AgentAccessStatus) => void>();

  constructor(
    private readonly credentialStore: AgentAccessCredentialStore,
    private readonly invokeRenderer: AgentAccessRendererInvoker,
    private readonly version: string,
    private readonly capabilities: readonly string[],
    private readonly options: AgentAccessBridgeOptions = {}
  ) {}

  status(): AgentAccessStatus {
    return this.current;
  }

  subscribe(listener: (status: AgentAccessStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(status: AgentAccessStatus): AgentAccessStatus {
    this.current = status;
    for (const listener of this.listeners) listener(status);
    return status;
  }

  async enable(port = 0): Promise<AgentAccessStatus> {
    if (this.server) return this.current;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535 || (port > 0 && port < 1024)) {
      return this.publish({ supported: true, enabled: false, state: 'error', error: 'Invalid local port.' });
    }
    this.publish({ supported: true, enabled: false, state: 'starting' });
    this.credentials = await this.credentialStore.loadOrCreate();
    const automatic = port === 0;
    const candidates = this.options.automaticPortCandidates ?? [];
    for (let attempt = 0; attempt < (automatic ? AUTOMATIC_PORT_ATTEMPTS : 1); attempt += 1) {
      const server = createServer((request, response) => void this.handle(request, response));
      server.on('connection', (socket) => {
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
      });
      try {
        const candidate = automatic ? (candidates[attempt] ?? 0) : port;
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(candidate, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Local bridge address is unavailable.');
        if (automatic && isFetchForbiddenPort(address.port)) {
          await this.closeServer(server);
          continue;
        }
        this.server = server;
        return this.publish({
          supported: true, enabled: true, state: 'running',
          address: `http://127.0.0.1:${address.port}`, port: address.port,
          deviceId: this.credentials.deviceId, token: this.credentials.token
        });
      } catch (reason) {
        server.closeAllConnections();
        server.close();
        return this.publish({
          supported: true, enabled: false, state: 'error',
          deviceId: this.credentials.deviceId,
          error: reason instanceof Error ? reason.message : String(reason)
        });
      }
    }
    return this.publish({
      supported: true, enabled: false, state: 'error',
      deviceId: this.credentials.deviceId,
      error: 'Unable to select a Fetch-compatible local port.'
    });
  }

  async disable(): Promise<AgentAccessStatus> {
    const server = this.server;
    this.server = null;
    if (server) await this.closeServer(server);
    return this.publish({
      supported: true, enabled: false, state: 'stopped',
      ...(this.credentials ? { deviceId: this.credentials.deviceId } : {})
    });
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const socket of this.sockets) socket.destroy();
    });
  }

  async rotateCredentials(): Promise<AgentAccessStatus> {
    this.credentials = await this.credentialStore.rotate();
    const next = {
      ...this.current,
      deviceId: this.credentials.deviceId,
      ...(this.current.enabled ? { token: this.credentials.token } : {})
    };
    return this.publish(next);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const port = this.current.port ?? 0;
      if (!validOrigin(request.headers.origin, port)) return json(response, 403, { error: 'origin-rejected' });
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { status: 'ok', version: this.version });
      }
      if (request.method === 'GET' && url.pathname === '/version') {
        return json(response, 200, { version: this.version, capabilities: this.capabilities });
      }
      if (request.method === 'GET' && url.pathname === '/status') {
        return json(response, 200, { enabled: true, state: 'running' });
      }
      if (!this.credentials || !authorized(request.headers.authorization, this.credentials.token)) {
        return json(response, 401, { error: 'unauthorized' });
      }
      if (request.method === 'POST' && url.pathname === '/invoke') {
        const payload = JSON.parse((await readBody(request, INVOKE_BODY_LIMIT)).toString('utf8')) as {
          readonly requestId?: unknown; readonly method?: unknown; readonly parameters?: unknown;
        };
        if (typeof payload.requestId !== 'string' || payload.requestId.length > 128
          || typeof payload.method !== 'string' || !INVOKE_METHODS.has(payload.method)) {
          return json(response, 400, { error: 'invalid-invoke-request' });
        }
        const value = await this.invokeRenderer(payload.method, payload.parameters ?? {});
        return json(response, 200, { requestId: payload.requestId, status: 'completed', value });
      }
      if (request.method === 'POST' && url.pathname === '/artifacts') {
        const bytes = await readBody(request, ARTIFACT_BODY_LIMIT);
        const name = decodeURIComponent(String(request.headers['x-lighttable-filename'] ?? 'agent-artifact')).slice(0, 255);
        const mediaType = String(request.headers['content-type'] ?? 'application/octet-stream').slice(0, 128);
        const value = await this.invokeRenderer('artifact.register', {
          bytes: new Uint8Array(bytes), name, mediaType
        });
        return json(response, 201, value);
      }
      const match = request.method === 'GET' && url.pathname.match(/^\/artifacts\/([^/]+)$/u);
      if (match) {
        const artifactId = decodeURIComponent(match[1]);
        if (artifactId.length > 256) return json(response, 400, { error: 'invalid-artifact-id' });
        const value = await this.invokeRenderer('artifact.resolve', { artifactId }) as {
          readonly bytes: Uint8Array; readonly name: string; readonly mediaType: string;
        } | null;
        if (!value) return json(response, 404, { error: 'artifact-not-found' });
        response.writeHead(200, {
          'content-type': value.mediaType || 'application/octet-stream',
          'content-length': value.bytes.byteLength,
          'x-lighttable-filename': encodeURIComponent(value.name),
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
        });
        response.end(Buffer.from(value.bytes));
        return;
      }
      json(response, 404, { error: 'not-found' });
    } catch (reason) {
      if (reason instanceof RangeError) return json(response, 413, { error: reason.message });
      json(response, 500, { error: reason instanceof Error ? reason.message : String(reason) });
    }
  }
}
