import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client';

export interface HiggsfieldCredentialRecord {
  readonly clients: Readonly<Record<string, StoredOAuthClientInformation>>;
  readonly tokens: Readonly<Record<string, StoredOAuthTokens>>;
  readonly latestIssuer?: string;
  readonly codeVerifier?: string;
  readonly discovery?: OAuthDiscoveryState;
}

export interface HiggsfieldCredentialStore {
  load(): Promise<HiggsfieldCredentialRecord | null>;
  save(record: HiggsfieldCredentialRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface HiggsfieldAuthorizationSession {
  readonly redirectUrl: string;
  readonly callback: Promise<URLSearchParams>;
  close(): Promise<void> | void;
}

export interface HiggsfieldConnectionHost {
  createAuthorizationSession(expectedState: string): Promise<HiggsfieldAuthorizationSession>;
  openExternal(url: string): Promise<void>;
}

type McpModule = typeof import('@modelcontextprotocol/client');
const issuerKey = (context?: OAuthClientInformationContext): string => context?.issuer ?? '';
const emptyRecord = (): HiggsfieldCredentialRecord => ({ clients: {}, tokens: {} });

class HiggsfieldOAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    readonly redirectUrl: string,
    private readonly expectedState: string,
    private readonly store: HiggsfieldCredentialStore,
    private readonly openExternal: (url: string) => Promise<void>
  ) {
    this.clientMetadata = {
      client_name: 'LightTable', redirect_uris: [redirectUrl],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none'
    };
  }

  state(): string { return this.expectedState; }
  async clientInformation(context?: OAuthClientInformationContext) {
    return (await this.store.load())?.clients[issuerKey(context)];
  }
  async saveClientInformation(client: StoredOAuthClientInformation, context?: OAuthClientInformationContext) {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({ ...record, clients: { ...record.clients, [issuerKey(context)]: client } });
  }
  async tokens(context?: OAuthClientInformationContext) {
    const record = await this.store.load();
    if (!record) return undefined;
    const key = context ? issuerKey(context) : record.latestIssuer;
    return key === undefined ? undefined : record.tokens[key];
  }
  async saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext) {
    const record = await this.store.load() ?? emptyRecord();
    const key = issuerKey(context);
    await this.store.save({ ...record, tokens: { ...record.tokens, [key]: tokens }, latestIssuer: key });
  }
  redirectToAuthorization(url: URL) { return this.openExternal(url.toString()); }
  async saveCodeVerifier(codeVerifier: string) {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({ ...record, codeVerifier });
  }
  async codeVerifier() {
    const verifier = (await this.store.load())?.codeVerifier;
    if (!verifier) throw new Error('The Higgsfield authorization session has no PKCE verifier.');
    return verifier;
  }
  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({ ...record, discovery });
  }
  async discoveryState() { return (await this.store.load())?.discovery; }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') return this.store.clear();
    const record = await this.store.load();
    if (!record) return;
    if (scope === 'client') await this.store.save({ ...record, clients: {} });
    if (scope === 'tokens') await this.store.save({ ...record, tokens: {}, latestIssuer: undefined });
    if (scope === 'verifier') await this.store.save({ ...record, codeVerifier: undefined });
    if (scope === 'discovery') await this.store.save({ ...record, discovery: undefined });
  }
}

export class HiggsfieldConnection {
  private client: InstanceType<McpModule['Client']> | null = null;
  private authorizationSession: HiggsfieldAuthorizationSession | null = null;

  constructor(private readonly options: {
    readonly endpoint: string;
    readonly appVersion: string;
    readonly store: HiggsfieldCredentialStore;
    readonly host: HiggsfieldConnectionHost;
    readonly createState: () => string;
  }) {}

  async restore(): Promise<'absent' | 'connected' | 'expired'> {
    const record = await this.options.store.load();
    if (!record || Object.keys(record.tokens).length === 0) return 'absent';
    const sdk = await import('@modelcontextprotocol/client');
    const provider = new HiggsfieldOAuthProvider(
      'http://127.0.0.1/oauth/higgsfield/callback', '', this.options.store,
      async () => { throw new Error('Interactive Higgsfield authorization is required.'); }
    );
    const restored = this.createClient(sdk, provider);
    try {
      await restored.client.connect(restored.transport);
      await restored.client.ping();
      this.client = restored.client;
      return 'connected';
    } catch {
      await restored.client.close().catch(() => undefined);
      return 'expired';
    }
  }

  async connect(): Promise<void> {
    const sdk = await import('@modelcontextprotocol/client');
    const state = this.options.createState();
    const session = await this.options.host.createAuthorizationSession(state);
    this.authorizationSession = session;
    const provider = new HiggsfieldOAuthProvider(session.redirectUrl, state, this.options.store,
      (url) => this.options.host.openExternal(url));
    try {
      const initial = this.createClient(sdk, provider);
      try {
        await initial.client.connect(initial.transport);
        this.client = initial.client;
      } catch (reason) {
        await initial.client.close().catch(() => undefined);
        if (!(reason instanceof sdk.UnauthorizedError)) throw reason;
        const callback = await session.callback;
        if (callback.get('state') !== state) throw new Error('Higgsfield rejected the authorization callback state.');
        await initial.transport.finishAuth(callback);
        const authenticated = this.createClient(sdk, provider);
        await authenticated.client.connect(authenticated.transport);
        this.client = authenticated.client;
      }
      await this.client?.ping();
    } catch (reason) {
      await this.closeConnection();
      throw reason;
    } finally {
      await session.close();
      if (this.authorizationSession === session) this.authorizationSession = null;
    }
  }

  async resetInteractiveConnection(): Promise<void> {
    const session = this.authorizationSession;
    this.authorizationSession = null;
    await session?.close();
    await this.disconnect(true);
  }
  async disconnect(clearCredentials = false): Promise<void> {
    await this.closeConnection();
    if (clearCredentials) await this.options.store.clear();
  }
  async callTool(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    if (!this.client) throw new Error('Connect Higgsfield before using its capabilities.');
    return this.client.callTool({ name, arguments: { ...args } });
  }
  async listTools(): Promise<unknown> {
    if (!this.client) throw new Error('Connect Higgsfield before loading its capabilities.');
    return this.client.listTools();
  }
  private createClient(sdk: McpModule, provider: OAuthClientProvider) {
    const client = new sdk.Client({ name: 'LightTable', version: this.options.appVersion });
    const transport = new sdk.StreamableHTTPClientTransport(new URL(this.options.endpoint), { authProvider: provider });
    return { client, transport };
  }
  private async closeConnection() {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => undefined);
  }
}
