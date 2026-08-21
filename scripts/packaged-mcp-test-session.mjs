import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createPortProbe } from 'node:net';
import selfsigned from 'selfsigned';
import { createLightTableMcpApp } from '../apps/mcp-server/src/server.mjs';
import { DeviceTunnelLightTableClient } from '../apps/mcp-server/src/deviceTunnelClient.mjs';

export class DynamicDeviceClient {
  constructor(broker, clientId) {
    this.broker = broker;
    this.clientId = clientId;
    this.client = null;
  }

  inner() {
    const deviceId = [...this.broker.connections.keys()][0];
    if (!deviceId) throw new Error('device-offline');
    if (!this.client || this.client.deviceId !== deviceId) {
      this.client = new DeviceTunnelLightTableClient({
        broker: this.broker,
        deviceId,
        clientId: this.clientId,
        clientName: 'LightTable MCP server'
      });
    }
    return this.client;
  }

  ready() {
    try {
      this.inner().ensureClient();
      return true;
    } catch {
      return false;
    }
  }

  invoke(method, parameters) { return this.inner().invoke(method, parameters); }
  uploadArtifact(input) { return this.inner().uploadArtifact(input); }
  readArtifact(id) { return this.inner().readArtifact(id); }
}

const reservePort = async () => {
  const server = createPortProbe();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};

const waitFor = async (predicate, label, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

export const startPackagedMcpTestSession = async ({
  label = 'Packaged MCP test',
  scopes = 'lighttable:read lighttable:edit'
} = {}) => {
  const nonce = randomUUID().slice(0, 8).toUpperCase();
  const pairingCode = `OAUTH-${nonce}`;
  const devicePairingCode = `DEVICE-${nonce}`;
  const port = await reservePort();
  const publicUrl = `https://localhost:${port}`;
  const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 1,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' }
    ] }]
  });
  let dynamicClient;
  const service = await createLightTableMcpApp({
    publicUrl,
    pairingCode,
    devicePairingCode,
    serverId: `test-${nonce.toLowerCase()}`,
    allowInsecure: false,
    allowedHosts: ['localhost'],
    client: (broker) => (dynamicClient = new DynamicDeviceClient(broker, `test-client-${nonce}`))
  });
  const tlsServer = createHttpsServer({ key: certificate.private, cert: certificate.cert }, service.app);
  tlsServer.on('upgrade', (request, socket, head) => {
    if (!service.deviceTunnel.handleUpgrade(request, socket, head)) socket.destroy();
  });
  await new Promise((resolve) => tlsServer.listen(port, '127.0.0.1', resolve));
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let mcp;

  return {
    publicUrl,
    desktopEnvironment: { LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS: 'true' },
    async pairAndAuthorize(window) {
      await window.getByRole('menuitem', { name: 'Edit' }).click();
      await window.getByRole('menuitem', { name: 'Preferences...' }).click();
      const settings = window.getByRole('dialog', { name: 'Preferences' });
      await settings.getByRole('button', { name: 'Agent Access' }).click();
      await settings.getByLabel('Online MCP server').click();
      await settings.getByLabel('Server URL').fill(publicUrl);
      await settings.getByLabel('One-time pairing code').fill(devicePairingCode);
      await settings.getByRole('button', { name: 'Pair server', exact: true }).click();
      await settings.locator('.lighttable-agent-settings__status').filter({ hasText: /connected/i })
        .waitFor({ timeout: 15_000 });

      const oauthClient = service.oauth.register({
        client_name: label,
        redirect_uris: ['http://127.0.0.1/callback']
      });
      const verifier = 'v'.repeat(64);
      const code = service.oauth.authorize({
        clientId: oauthClient.client_id,
        redirectUri: oauthClient.redirect_uris[0],
        responseType: 'code',
        scope: scopes,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        pairingCode
      });
      const access = service.oauth.exchangeCode({
        code,
        clientId: oauthClient.client_id,
        redirectUri: oauthClient.redirect_uris[0],
        codeVerifier: verifier
      }).access_token;
      mcp = new Client({ name: label, version: '1.0.0' });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), {
        authProvider: { token: async () => access }
      }));
      const rejected = await mcp.callTool({ name: 'lighttable_workspace', arguments: {} });
      if (!rejected.isError) throw new Error('MCP request bypassed explicit desktop approval.');
      const accessRequest = window.getByRole('dialog', { name: 'LightTable MCP server requests LightTable access' });
      await accessRequest.getByRole('button', { name: 'Allow once' }).click();
      await waitFor(() => dynamicClient?.ready(), 'MCP desktop approval');
      const close = settings.getByRole('button', { name: 'Close' });
      if (await close.count() && await close.isVisible()) await close.click();
      else await window.keyboard.press('Escape');
      return mcp;
    },
    readArtifact: (id) => dynamicClient.readArtifact(id),
    async close() {
      if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
      await mcp?.close().catch(() => undefined);
      await service.close().catch(() => undefined);
      await new Promise((resolve) => tlsServer.close(resolve));
    }
  };
};
