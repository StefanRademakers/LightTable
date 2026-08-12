import { randomBytes } from 'node:crypto';

export type AgentTunnelState = 'offline' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'revoked';
export type AgentClientScope = 'read' | 'edit';

export interface AgentTunnelClient {
  readonly id: string;
  readonly name: string;
  readonly requestedScopes: readonly AgentClientScope[];
  readonly scopes: readonly AgentClientScope[];
  readonly approved: boolean;
  readonly lastActivity?: number;
}

export interface AgentTunnelEvent {
  readonly id: number;
  readonly at: number;
  readonly kind: string;
  readonly detail: string;
}
export interface AgentDesignActivity {
  readonly name: string; readonly status: 'running' | 'completed' | 'failed' | 'canceled';
  readonly progress: number; readonly documentId?: string; readonly taskId?: string;
  readonly results?: readonly { readonly id: string; readonly name: string; readonly mediaType: string }[];
}

export interface AgentTunnelSession {
  readonly serverUrl: string;
  readonly socketUrl: string;
  readonly serverId: string;
  readonly certificateSha256: string;
  readonly deviceId: string;
  readonly sessionToken: string;
  readonly expiresAt: number;
}

export interface AgentTunnelStatus {
  readonly state: AgentTunnelState;
  readonly serverUrl?: string;
  readonly serverId?: string;
  readonly deviceId: string;
  readonly clients: readonly AgentTunnelClient[];
  readonly events: readonly AgentTunnelEvent[];
  readonly activity?: AgentDesignActivity;
  readonly lastActivity?: number;
  readonly error?: string;
}

export interface AgentTunnelSessionStore {
  load(): Promise<AgentTunnelSession | null>;
  save(session: AgentTunnelSession): Promise<void>;
  clear(): Promise<void>;
}

export interface AgentPairingClient {
  pair(input: {
    readonly serverUrl: string; readonly code: string; readonly deviceId: string;
    readonly expectedCertificateSha256?: string;
  }): Promise<AgentTunnelSession>;
}

export interface AgentTunnelConnection {
  send(message: unknown): void;
  close(): Promise<void>;
}

export interface AgentTunnelTransport {
  connect(session: AgentTunnelSession, handlers: {
    readonly onOpen: () => void;
    readonly onMessage: (message: unknown) => void;
    readonly onClose: (reason: string) => void;
  }): Promise<AgentTunnelConnection>;
}

type Timer = ReturnType<typeof setTimeout>;
const MAX_EVENTS = 100;
const MAX_REPLAY_NONCES = 256;
const REPLAY_WINDOW_MS = 60_000;

const scopes = (value: unknown): AgentClientScope[] => Array.isArray(value)
  ? [...new Set(value.filter((scope): scope is AgentClientScope => scope === 'read' || scope === 'edit'))]
  : [];

export class AgentTunnelController {
  private session: AgentTunnelSession | null = null;
  private connection: AgentTunnelConnection | null = null;
  private current: AgentTunnelStatus;
  private clients = new Map<string, AgentTunnelClient>();
  private events: AgentTunnelEvent[] = [];
  private eventId = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: Timer | null = null;
  private replay = new Set<string>();
  private activity: AgentDesignActivity | undefined;
  private readonly listeners = new Set<(status: AgentTunnelStatus) => void>();

  constructor(
    private readonly deviceId: string,
    private readonly pairing: AgentPairingClient,
    private readonly transport: AgentTunnelTransport,
    private readonly store: AgentTunnelSessionStore,
    private readonly invoke: (method: string, parameters: unknown) => Promise<unknown>,
    private readonly now = () => Date.now(),
    private readonly schedule = (callback: () => void, delay: number): Timer => setTimeout(callback, delay)
  ) {
    this.current = { state: 'offline', deviceId, clients: [], events: [] };
  }

  status(): AgentTunnelStatus { return this.current; }
  subscribe(listener: (status: AgentTunnelStatus) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  async restore(): Promise<AgentTunnelStatus> {
    const session = await this.store.load();
    try {
      if (session) this.validateSession(session, new URL(session.serverUrl).origin);
    } catch {
      await this.store.clear(); return this.publish('offline', { error: 'Stored Agent session was invalid and has been cleared.' });
    }
    if (!session || session.deviceId !== this.deviceId || session.expiresAt <= this.now()) {
      if (session) await this.store.clear();
      return this.publish('offline');
    }
    this.session = session;
    return this.connect();
  }

  async pair(serverUrl: string, code: string): Promise<AgentTunnelStatus> {
    const url = new URL(serverUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      return this.fail('Production pairing requires a clean HTTPS server URL.');
    }
    if (!/^[A-Za-z\d-]{6,64}$/u.test(code)) return this.fail('The one-time pairing code is invalid.');
    const expectedCertificateSha256 = this.session?.serverUrl === url.origin
      ? this.session.certificateSha256 : undefined;
    await this.disconnect(true);
    this.publish('pairing', { serverUrl: url.origin });
    try {
      const session = await this.pairing.pair({
        serverUrl: url.origin, code, deviceId: this.deviceId, expectedCertificateSha256
      });
      this.validateSession(session, url.origin);
      this.session = session;
      await this.store.save(session);
      this.record('paired', `Paired with ${session.serverId}.`);
      return this.connect();
    } catch (reason) {
      return this.fail(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async connect(): Promise<AgentTunnelStatus> {
    const session = this.session;
    if (!session) return this.publish('offline');
    if (session.expiresAt <= this.now()) {
      await this.revoke('Session expired. Pair this device again.');
      return this.current;
    }
    if (this.connection) return this.current;
    this.publish('connecting');
    try {
      this.connection = await this.transport.connect(session, {
        onOpen: () => {
          this.reconnectAttempt = 0;
          this.record('connected', `Connected to ${session.serverId}.`);
          this.publish('connected');
        },
        onMessage: (message) => void this.receive(message),
        onClose: (reason) => {
          this.connection = null;
          if (this.current.state === 'offline' || this.current.state === 'revoked') return;
          this.record('disconnected', reason || 'Connection closed.');
          this.publish('degraded', { error: 'Connection lost. Reconnecting locally; documents are unchanged.' });
          this.queueReconnect();
        }
      });
      return this.current;
    } catch (reason) {
      this.publish('degraded', { error: reason instanceof Error ? reason.message : String(reason) });
      this.queueReconnect();
      return this.current;
    }
  }

  async disconnect(clearSession = false): Promise<AgentTunnelStatus> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const connection = this.connection; this.connection = null;
    this.publish('offline');
    await connection?.close();
    if (clearSession) { this.session = null; await this.store.clear(); }
    this.record('offline', 'Outbound connection stopped; open documents were not changed.');
    return this.publish('offline');
  }

  async approveClient(clientId: string, approvedScopes: readonly AgentClientScope[]): Promise<AgentTunnelStatus> {
    const client = this.clients.get(clientId);
    if (!client || !this.connection) return this.current;
    const allowed = scopes(approvedScopes).filter((scope) => client.requestedScopes.includes(scope));
    if (!allowed.length) return this.current;
    const next = { ...client, approved: true, scopes: allowed, lastActivity: this.now() };
    this.clients.set(clientId, next);
    this.connection.send({ type: 'client.approval', deviceId: this.deviceId, clientId, scopes: allowed });
    this.record('client-approved', `${client.name} approved for ${allowed.join(' + ')}.`);
    return this.publish(this.current.state);
  }

  async revokeClient(clientId: string): Promise<AgentTunnelStatus> {
    const client = this.clients.get(clientId);
    if (!client) return this.current;
    this.clients.delete(clientId);
    this.connection?.send({ type: 'client.revoke', deviceId: this.deviceId, clientId });
    this.record('client-revoked', `${client.name} was revoked.`);
    return this.publish(this.current.state);
  }

  async revoke(reason = 'This device was revoked.'): Promise<AgentTunnelStatus> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const connection = this.connection; this.connection = null;
    this.publish('revoked', { error: reason });
    await connection?.close();
    this.session = null; this.clients.clear(); this.replay.clear();
    await this.store.clear();
    this.record('revoked', reason);
    return this.publish('revoked', { error: reason });
  }

  async cancelActivity(): Promise<AgentTunnelStatus> {
    if (!this.activity?.taskId || !this.activity.documentId || this.activity.status !== 'running') return this.current;
    await this.invoke('command.execute', { documentId: this.activity.documentId, command: 'task.cancel',
      commandRequestId: `agent-cancel-${this.now()}`, commandParameters: { taskId: this.activity.taskId } });
    this.activity = { ...this.activity, status: 'canceled' }; this.record('agent-canceled', `${this.activity.name} was canceled.`);
    return this.publish(this.current.state);
  }

  async undoActivity(): Promise<AgentTunnelStatus> {
    if (!this.activity?.documentId || this.activity.status !== 'completed') return this.current;
    await this.invoke('command.execute', { documentId: this.activity.documentId, command: 'history.undo',
      commandRequestId: `agent-undo-${this.now()}`, commandParameters: {} });
    this.record('agent-undo', `Undid ${this.activity.name}.`); this.activity = undefined;
    return this.publish(this.current.state);
  }

  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as Record<string, unknown>;
    if (message.deviceId !== this.deviceId) return this.record('rejected', 'Rejected cross-device tunnel message.');
    if (message.type === 'session.revoked') return void this.revoke('The server revoked this device.');
    if (message.type === 'session.rotated' && this.session
      && typeof message.sessionToken === 'string' && message.sessionToken.length >= 32
      && typeof message.expiresAt === 'number' && message.expiresAt > this.now()
      && message.expiresAt <= this.now() + 24 * 60 * 60_000) {
      this.session = { ...this.session, sessionToken: message.sessionToken, expiresAt: message.expiresAt };
      await this.store.save(this.session);
      this.record('session-rotated', 'Secure server session credentials were rotated.');
      this.publish(this.current.state); return;
    }
    if (message.type === 'client.request') {
      if (typeof message.clientId !== 'string' || typeof message.name !== 'string') return;
      this.clients.set(message.clientId, {
        id: message.clientId, name: message.name.slice(0, 128), requestedScopes: scopes(message.scopes),
        scopes: [], approved: false, lastActivity: this.now()
      });
      this.record('client-request', `${String(message.name).slice(0, 128)} requests access.`);
      this.publish(this.current.state); return;
    }
    if (message.type !== 'invoke' || typeof message.clientId !== 'string'
      || typeof message.requestId !== 'string' || typeof message.nonce !== 'string'
      || typeof message.timestamp !== 'number' || typeof message.method !== 'string') return;
    const client = this.clients.get(message.clientId);
    const edit = message.method === 'command.execute' || message.method.startsWith('gesture.')
      || message.method === 'artifact.register' || message.method === 'artifact.release';
    if (!client?.approved || !client.scopes.includes(edit ? 'edit' : 'read')) {
      return this.connection?.send({ type: 'result', requestId: message.requestId, error: 'client-not-approved' });
    }
    if (Math.abs(this.now() - message.timestamp) > REPLAY_WINDOW_MS || this.replay.has(message.nonce)) {
      return this.connection?.send({ type: 'result', requestId: message.requestId, error: 'replay-rejected' });
    }
    this.replay.add(message.nonce);
    while (this.replay.size > MAX_REPLAY_NONCES) this.replay.delete(this.replay.values().next().value!);
    try {
      const commandParameters = (message.parameters as { commandParameters?: Record<string, unknown> } | undefined)?.commandParameters;
      const isNamedBatch = message.method === 'command.execute'
        && (message.parameters as { command?: unknown } | undefined)?.command === 'command.batch'
        && typeof commandParameters?.name === 'string';
      if (isNamedBatch) {
        this.activity = { name: String(commandParameters?.name).slice(0, 128), status: 'running', progress: 0,
          documentId: String((message.parameters as { documentId?: unknown }).documentId ?? '') };
        this.record('agent-started', `${this.activity.name} started.`); this.publish(this.current.state);
      }
      const parameters = message.method === 'artifact.register'
        && typeof (message.parameters as { bytesBase64?: unknown } | undefined)?.bytesBase64 === 'string'
        ? { ...(message.parameters as Record<string, unknown>),
          bytes: Uint8Array.from(Buffer.from((message.parameters as { bytesBase64: string }).bytesBase64, 'base64')) }
        : message.parameters ?? {};
      const value = await this.invoke(message.method, parameters);
      if (isNamedBatch && this.activity) {
        const taskId = value && typeof value === 'object' && typeof (value as { taskId?: unknown }).taskId === 'string'
          ? (value as { taskId: string }).taskId : undefined;
        this.activity = { ...this.activity, status: taskId ? 'running' : 'completed', progress: taskId ? 0.1 : 1,
          ...(taskId ? { taskId } : {}) };
        this.record(taskId ? 'agent-progress' : 'agent-completed', taskId
          ? `${this.activity.name} is processing.` : `${this.activity.name} completed.`);
      }
      if (message.method === 'task.query' && this.activity?.taskId
        && (message.parameters as { taskId?: unknown } | undefined)?.taskId === this.activity.taskId
        && value && typeof value === 'object' && typeof (value as { status?: unknown }).status === 'string'
        && (value as { status: string }).status !== 'running') {
        const taskStatus = (value as { status: string }).status;
        const status = taskStatus === 'completed' ? 'completed' : taskStatus === 'canceled' ? 'canceled' : 'failed';
        this.activity = { ...this.activity, status, progress: status === 'completed' ? 1 : this.activity.progress };
        this.record(`agent-${status}`, `${this.activity.name} ${status}.`);
      }
      if (message.method === 'task.query' && this.activity && value && typeof value === 'object') {
        const artifact = (value as { artifact?: unknown }).artifact;
        const documentId = (message.parameters as { documentId?: unknown } | undefined)?.documentId;
        if (artifact && typeof artifact === 'object' && documentId === this.activity.documentId) {
          const candidate = artifact as { id?: unknown; name?: unknown; mediaType?: unknown };
          if (typeof candidate.id === 'string' && typeof candidate.name === 'string'
            && typeof candidate.mediaType === 'string') {
            const results = [...(this.activity.results ?? []).filter((entry) => entry.id !== candidate.id),
              { id: candidate.id, name: candidate.name.slice(0, 255), mediaType: candidate.mediaType.slice(0, 128) }];
            this.activity = { ...this.activity, results: results.slice(-6) };
          }
        }
      }
      const result = message.method === 'artifact.resolve' && value && typeof value === 'object'
        && (value as { bytes?: unknown }).bytes instanceof Uint8Array
        ? { ...(value as Record<string, unknown>),
          bytesBase64: Buffer.from((value as { bytes: Uint8Array }).bytes).toString('base64'), bytes: undefined }
        : value;
      if (result && typeof result === 'object' && typeof (result as { bytesBase64?: unknown }).bytesBase64 === 'string'
        && (result as { bytesBase64: string }).bytesBase64.length > 512 * 1024) {
        const { bytesBase64, ...metadata } = result as Record<string, unknown> & { bytesBase64: string };
        const chunks = bytesBase64.match(/.{1,524288}/gu) ?? [];
        chunks.forEach((data, index) => this.connection?.send({ type: 'result.chunk', requestId: message.requestId,
          index, total: chunks.length, data }));
        this.connection?.send({ type: 'result', requestId: message.requestId,
          value: { ...metadata, bytesChunked: true } });
      } else this.connection?.send({ type: 'result', requestId: message.requestId, value: result });
      this.clients.set(client.id, { ...client, lastActivity: this.now() });
      this.record('activity', `${client.name} used ${edit ? 'edit' : 'read'} access.`);
      this.publish(this.current.state);
    } catch (reason) {
      if (this.activity?.status === 'running') {
        this.activity = { ...this.activity, status: 'failed' };
        this.record('agent-failed', `${this.activity.name} failed.`); this.publish(this.current.state);
      }
      this.connection?.send({ type: 'result', requestId: message.requestId,
        error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  private validateSession(session: AgentTunnelSession, expectedOrigin: string): void {
    if (session.serverUrl !== expectedOrigin || new URL(session.socketUrl).protocol !== 'wss:'
      || !/^[a-f\d]{64}$/iu.test(session.certificateSha256)
      || session.deviceId !== this.deviceId || session.sessionToken.length < 32
      || session.expiresAt <= this.now() || session.expiresAt > this.now() + 24 * 60 * 60_000) {
      throw new Error('The pairing server returned an invalid or cross-device session.');
    }
  }

  private queueReconnect(): void {
    if (this.reconnectTimer || !this.session) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null; void this.connect();
    }, delay);
  }

  private record(kind: string, detail: string): void {
    this.events.push({ id: ++this.eventId, at: this.now(), kind, detail });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private fail(error: string): AgentTunnelStatus {
    this.record('error', error); return this.publish('offline', { error });
  }

  private publish(state: AgentTunnelState, extra: { serverUrl?: string; error?: string } = {}): AgentTunnelStatus {
    this.current = {
      state, deviceId: this.deviceId,
      ...(this.session ? { serverUrl: this.session.serverUrl, serverId: this.session.serverId } : {}),
      ...extra, clients: [...this.clients.values()], events: [...this.events],
      ...(this.activity ? { activity: this.activity } : {}), lastActivity: this.events.at(-1)?.at
    };
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }
}

export const createAgentDeviceId = (): string => randomBytes(12).toString('hex');
