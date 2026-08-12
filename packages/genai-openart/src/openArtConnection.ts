import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client';

export interface OpenArtCredentialRecord {
  readonly clients: Readonly<Record<string, StoredOAuthClientInformation>>;
  readonly tokens: Readonly<Record<string, StoredOAuthTokens>>;
  readonly latestIssuer?: string;
  readonly codeVerifier?: string;
  readonly discovery?: OAuthDiscoveryState;
}

export interface OpenArtCredentialStore {
  load(): Promise<OpenArtCredentialRecord | null>;
  save(record: OpenArtCredentialRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface OpenArtAuthorizationSession {
  readonly redirectUrl: string;
  readonly callback: Promise<URLSearchParams>;
  close(): Promise<void> | void;
}

export interface OpenArtConnectionHost {
  createAuthorizationSession(expectedState: string): Promise<OpenArtAuthorizationSession>;
  openExternal(url: string): Promise<void>;
}

export interface OpenArtConnectionOptions {
  readonly endpoint: string;
  readonly appVersion: string;
  readonly store: OpenArtCredentialStore;
  readonly host: OpenArtConnectionHost;
  readonly createState: () => string;
}

type McpModule = typeof import('@modelcontextprotocol/client');

const issuerKey = (context?: OAuthClientInformationContext): string =>
  context?.issuer ?? '';

const emptyRecord = (): OpenArtCredentialRecord => ({ clients: {}, tokens: {} });

class OpenArtOAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    readonly redirectUrl: string,
    private readonly expectedState: string,
    private readonly store: OpenArtCredentialStore,
    private readonly openExternal: (url: string) => Promise<void>
  ) {
    this.clientMetadata = {
      client_name: 'LightTable',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }

  state(): string {
    return this.expectedState;
  }

  async clientInformation(
    context?: OAuthClientInformationContext
  ): Promise<StoredOAuthClientInformation | undefined> {
    const record = await this.store.load();
    return record?.clients[issuerKey(context)];
  }

  async saveClientInformation(
    client: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({
      ...record,
      clients: { ...record.clients, [issuerKey(context)]: client }
    });
  }

  async tokens(context?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const record = await this.store.load();
    if (!record) return undefined;
    const key = context ? issuerKey(context) : record.latestIssuer;
    return key === undefined ? undefined : record.tokens[key];
  }

  async saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext): Promise<void> {
    const record = await this.store.load() ?? emptyRecord();
    const key = issuerKey(context);
    await this.store.save({
      ...record,
      tokens: { ...record.tokens, [key]: tokens },
      latestIssuer: key
    });
  }

  redirectToAuthorization(url: URL): Promise<void> {
    return this.openExternal(url.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({ ...record, codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.load())?.codeVerifier;
    if (!verifier) throw new Error('The OpenArt authorization session has no PKCE verifier.');
    return verifier;
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    const record = await this.store.load() ?? emptyRecord();
    await this.store.save({ ...record, discovery });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.load())?.discovery;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') {
      await this.store.clear();
      return;
    }
    const record = await this.store.load();
    if (!record) return;
    if (scope === 'client') await this.store.save({ ...record, clients: {} });
    if (scope === 'tokens') await this.store.save({ ...record, tokens: {}, latestIssuer: undefined });
    if (scope === 'verifier') await this.store.save({ ...record, codeVerifier: undefined });
    if (scope === 'discovery') await this.store.save({ ...record, discovery: undefined });
  }
}

/**
 * Desktop-facing connection primitive. The heavy MCP SDK is imported only
 * when a connection is requested; importing this package has no startup cost.
 */
export class OpenArtConnection {
  private client: InstanceType<McpModule['Client']> | null = null;
  private transport: InstanceType<McpModule['StreamableHTTPClientTransport']> | null = null;
  private authorizationSession: OpenArtAuthorizationSession | null = null;

  constructor(private readonly options: OpenArtConnectionOptions) {}

  async restore(): Promise<'absent' | 'connected' | 'expired'> {
    const record = await this.options.store.load();
    if (!record || Object.keys(record.tokens).length === 0) return 'absent';
    const sdk = await import('@modelcontextprotocol/client');
    const provider = new OpenArtOAuthProvider(
      'http://127.0.0.1/oauth/openart/callback',
      '',
      this.options.store,
      async () => { throw new Error('Interactive OpenArt authorization is required.'); }
    );
    const restored = this.createClient(sdk, provider);
    try {
      await restored.client.connect(restored.transport);
      await restored.client.ping();
      this.client = restored.client;
      this.transport = restored.transport;
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
    const provider = new OpenArtOAuthProvider(
      session.redirectUrl,
      state,
      this.options.store,
      (url) => this.options.host.openExternal(url)
    );

    try {
      const initial = this.createClient(sdk, provider);
      try {
        await initial.client.connect(initial.transport);
      } catch (reason) {
        await initial.client.close().catch(() => undefined);
        if (!(reason instanceof sdk.UnauthorizedError)) throw reason;
        const callback = await session.callback;
        if (callback.get('state') !== state) {
          throw new Error('OpenArt rejected the authorization callback state.');
        }
        await initial.transport.finishAuth(callback);
        const authenticated = this.createClient(sdk, provider);
        await authenticated.client.connect(authenticated.transport);
        this.client = authenticated.client;
        this.transport = authenticated.transport;
      }
      if (!this.client) {
        this.client = initial.client;
        this.transport = initial.transport;
      }
      await this.client.ping();
    } catch (reason) {
      await this.closeConnection();
      throw reason;
    } finally {
      await session.close();
      if (this.authorizationSession === session) this.authorizationSession = null;
    }
  }

  /** Cancels a stalled browser flow and removes credentials before a clean retry. */
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
    if (!this.client) throw new Error('Connect OpenArt before loading its model catalog.');
    return this.client.callTool({ name, arguments: { ...args } });
  }

  private createClient(sdk: McpModule, provider: OAuthClientProvider) {
    const client = new sdk.Client({ name: 'LightTable', version: this.options.appVersion });
    const transport = new sdk.StreamableHTTPClientTransport(new URL(this.options.endpoint), {
      authProvider: provider
    });
    return { client, transport };
  }

  private async closeConnection(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    await client?.close().catch(() => undefined);
  }
}
