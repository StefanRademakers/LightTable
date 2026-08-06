import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MockLightTableClient } from '../src/lighttableClient.mjs';
import { createLightTableMcpApp } from '../src/server.mjs';

const accessToken = (oauth, scopes) => {
  const client = oauth.register({ redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = 'v'.repeat(64);
  const code = oauth.authorize({ clientId: client.client_id, redirectUri: client.redirect_uris[0],
    responseType: 'code', scope: scopes.join(' '),
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', pairingCode: 'integration-pairing' });
  return oauth.exchangeCode({ code, clientId: client.client_id,
    redirectUri: client.redirect_uris[0], codeVerifier: verifier }).access_token;
};

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

test('Streamable HTTP exposes typed tools and enforces edit scope', async (context) => {
  const service = await createLightTableMcpApp({ publicUrl: 'http://127.0.0.1:8787',
    pairingCode: 'integration-pairing', client: new MockLightTableClient(),
    allowInsecure: true, allowedHosts: ['127.0.0.1'] });
  const http = await listen(service.app);
  context.after(async () => { await service.close(); await new Promise((resolve) => http.close(resolve)); });
  const url = new URL(`http://127.0.0.1:${http.address().port}/mcp`);

  const readToken = accessToken(service.oauth, ['lighttable:read']);
  const readTransport = new StreamableHTTPClientTransport(url, { authProvider: { token: async () => readToken } });
  const reader = new Client({ name: 'LightTable test reader', version: '1.0.0' });
  await reader.connect(readTransport);
  context.after(() => reader.close());
  const tools = await reader.listTools();
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_workspace'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_preview'));
  const workspace = await reader.callTool({ name: 'lighttable_workspace', arguments: {} });
  assert.equal(workspace.isError, undefined);
  assert.equal(workspace.structuredContent.activeDocumentId, 'document-demo');
  const denied = await reader.callTool({ name: 'lighttable_execute', arguments: {
    documentId: 'document-demo', command: 'layer.createRaster', parameters: {} } });
  assert.equal(denied.isError, true);

  const editToken = accessToken(service.oauth, ['lighttable:read', 'lighttable:edit']);
  const editTransport = new StreamableHTTPClientTransport(url, { authProvider: { token: async () => editToken } });
  const editor = new Client({ name: 'LightTable test editor', version: '1.0.0' });
  await editor.connect(editTransport);
  context.after(() => editor.close());
  const result = await editor.callTool({ name: 'lighttable_execute', arguments: {
    documentId: 'document-demo', command: 'layer.rename', parameters: {
      layerId: 'layer-background', name: 'Renamed by MCP' } } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, 'completed');
});

test('MCP endpoint advertises protected-resource metadata when unauthenticated', async (context) => {
  const service = await createLightTableMcpApp({ publicUrl: 'http://127.0.0.1:8787',
    pairingCode: 'integration-pairing', client: new MockLightTableClient(),
    allowInsecure: true, allowedHosts: ['127.0.0.1'] });
  const http = await listen(service.app);
  context.after(async () => { await service.close(); await new Promise((resolve) => http.close(resolve)); });
  const response = await fetch(`http://127.0.0.1:${http.address().port}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata=/u);
});
