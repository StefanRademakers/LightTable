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
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_document'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_edit_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_vector'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_shape'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_edit_vector'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_layer_style'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_batch'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_task_events'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_cancel_task'));
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
  const created = await editor.callTool({ name: 'lighttable_create_document', arguments: {
    name: 'MCP canvas', width: 400, height: 300, resolutionPpi: 144,
    bitDepth: '16', profile: 'adobe-rgb-1998', backgroundColor: '#112233'
  } });
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.status, 'completed');
  const textCreated = await editor.callTool({ name: 'lighttable_create_text', arguments: {
    documentId: 'document-demo', mode: 'paragraph', text: 'مرحبا 👋', x: 20, y: 30,
    width: 280, height: 160, family: 'Inter', fontSize: 64, fill: '#ff0088', writingMode: 'horizontal-tb'
  } });
  assert.equal(textCreated.isError, undefined);
  const textEdited = await editor.callTool({ name: 'lighttable_edit_text', arguments: {
    documentId: 'document-demo', layerId: 'layer-text', operation: 'replace', start: 0, end: 1, text: 'A'
  } });
  assert.equal(textEdited.isError, undefined);
  const textQuery = await reader.callTool({ name: 'lighttable_text', arguments: {
    documentId: 'document-demo', layerId: 'layer-text'
  } });
  assert.equal(textQuery.structuredContent.content.text, 'Text');
  const shape = await editor.callTool({ name: 'lighttable_create_shape', arguments: {
    documentId: 'document-demo', shape: 'rectangle', x: 20, y: 30, width: 200, height: 120,
    fillEnabled: false, strokeEnabled: true, stroke: '#ff0000', strokeWidth: 12
  } });
  assert.equal(shape.isError, undefined);
  const vector = await reader.callTool({ name: 'lighttable_vector', arguments: {
    documentId: 'document-demo', layerId: 'layer-vector'
  } });
  assert.equal(vector.structuredContent.totalElements, 0);
  const style = await editor.callTool({ name: 'lighttable_layer_style', arguments: {
    documentId: 'document-demo', layerId: 'layer-background', operation: 'add',
    effectKind: 'drop-shadow', settings: { distance: 20, size: 10 }
  } });
  assert.equal(style.isError, undefined);
  const batch = await editor.callTool({ name: 'lighttable_batch', arguments: {
    documentId: 'document-demo', name: 'MCP mini design', operations: [
      { operationId: 'rename', command: 'layer.rename', parameters: {
        layerId: 'layer-background', name: 'Batch background' } }
    ]
  } });
  assert.equal(batch.isError, undefined);
  const events = await reader.callTool({ name: 'lighttable_task_events', arguments: { afterCursor: 0 } });
  assert.deepEqual(events.structuredContent.events, []);
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
