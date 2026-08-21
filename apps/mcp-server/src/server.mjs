import { randomUUID } from 'node:crypto';
import express from 'express';
import { createMcpExpressApp, mcpAuthMetadataRouter } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createLightTableMcpServer } from './mcp.mjs';
import { installOAuthRoutes, LightTableOAuthStore } from './oauth.mjs';
import { DeviceTunnelBroker } from './deviceTunnel.mjs';
import { createRequestGuard } from './operations.mjs';

export const createLightTableMcpApp = async ({ publicUrl, devicePublicUrl, pairingCode, client,
  allowInsecure = false, allowedHosts, devicePairingCode = pairingCode, serverId,
  oauthStateStore = null, tenantId = 'default', userId = 'owner', audit = null,
  requestGuard = createRequestGuard(), fetchImpl = fetch, trustedLocalAuthorization = false } = {}) => {
  const resource = new URL('/mcp', publicUrl);
  const issuer = new URL('/', publicUrl);
  const deviceIssuer = new URL('/', devicePublicUrl ?? publicUrl);
  if (!allowInsecure && (resource.protocol !== 'https:' || issuer.protocol !== 'https:')) {
    throw new Error('Public MCP and OAuth URLs must use HTTPS. Set allowInsecure only for localhost tests.');
  }
  if (devicePublicUrl && deviceIssuer.protocol !== 'https:') {
    throw new Error('A separate desktop device origin must use HTTPS.');
  }
  const loopbackIssuer = ['127.0.0.1', 'localhost', '[::1]'].includes(issuer.hostname);
  if (trustedLocalAuthorization && (!allowInsecure || !loopbackIssuer)) {
    throw new Error('Trusted local authorization requires an explicitly insecure loopback test server.');
  }
  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts,
    jsonLimit: '20mb' });
  app.use(requestGuard);
  const oauth = new LightTableOAuthStore({ issuer, resource, pairingCode, stateStore: oauthStateStore,
    tenantId, userId });
  const oauthMetadata = {
    issuer: issuer.href.replace(/\/$/u, ''),
    authorization_endpoint: new URL('/oauth/authorize', issuer).href,
    token_endpoint: new URL('/oauth/token', issuer).href,
    registration_endpoint: new URL('/oauth/register', issuer).href,
    scopes_supported: ['lighttable:read', 'lighttable:edit', 'offline_access'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256']
  };
  app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: resource,
    scopesSupported: oauthMetadata.scopes_supported, resourceName: 'LightTable',
    dangerouslyAllowInsecureIssuerUrl: allowInsecure }));
  installOAuthRoutes(app, oauth, { trustedLocalAuthorization });
  const deviceTunnel = new DeviceTunnelBroker({ publicUrl: deviceIssuer, pairingCode: devicePairingCode, serverId });
  app.use('/agent/pair', express.json({ limit: '16kb' }));
  deviceTunnel.installRoutes(app);
  let ready = true;
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'lighttable-mcp', version: '0.1.0' }));
  app.get('/ready', (_req, res) => res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'stopping' }));
  const authenticate = async (req, res, next) => {
    const match = req.get('authorization')?.match(/^Bearer\s+(.+)$/iu);
    try {
      if (!match) throw new Error('Missing bearer token.');
      const auth = await oauth.verifyAccessToken(match[1]);
      if (!auth.scopes.includes('lighttable:read')) throw new Error('The lighttable:read scope is required.');
      req.auth = auth; audit?.append?.({ tenantId: auth.tenantId, userId: auth.userId,
        clientId: auth.clientId, action: 'mcp.authenticate' }); next();
    } catch {
      const metadata = new URL('/.well-known/oauth-protected-resource/mcp', issuer).href;
      res.set('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="lighttable:read"`)
        .status(401).json({ error: 'invalid_token' });
    }
  };
  const mcp = createLightTableMcpServer(
    typeof client === 'function' ? client(deviceTunnel) : client,
    { fetchImpl }
  );
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
    enableJsonResponse: true });
  await mcp.connect(transport);
  app.all('/mcp', authenticate, (req, res) => void transport.handleRequest(req, res, req.body));
  return { app, oauth, deviceTunnel,
    close: async () => { ready = false; deviceTunnel.close(); return transport.close(); },
    requestId: randomUUID() };
};
