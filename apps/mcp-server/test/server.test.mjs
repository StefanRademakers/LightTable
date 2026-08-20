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
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_layer_preview'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_layer'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_region_preview'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_document'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_build_social_design'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_edit_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_text'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_vector'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_grade'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_adjustment'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_create_shape'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_edit_vector'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_layer_style'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_batch'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_task_events'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_task'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_events'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_wait_for_events'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_cancel_task'));
  assert.ok(tools.tools.some(({ name }) => name === 'lighttable_commands'));
  const commandCatalog = await reader.callTool({ name: 'lighttable_commands', arguments: {
    command: 'layer.rename'
  } });
  assert.deepEqual(commandCatalog.structuredContent.commands[0].parameters, {
    layerId: 'string', name: 'string'
  });
  const workspace = await reader.callTool({ name: 'lighttable_workspace', arguments: {} });
  assert.equal(workspace.isError, undefined);
  assert.equal(workspace.structuredContent.activeDocumentId, 'document-demo');
  const layers = await reader.callTool({ name: 'lighttable_layers', arguments: {
    documentId: 'document-demo', expectedDocumentRevision: 1, limit: 1
  } });
  assert.equal(layers.structuredContent.canonicalRevision, 1);
  assert.ok(Array.isArray(layers.structuredContent.layers));
  const activeLayer = await reader.callTool({ name: 'lighttable_layer', arguments: {
    documentId: 'document-demo', expectedDocumentRevision: 1
  } });
  assert.equal(activeLayer.structuredContent.resolvedFrom, 'active-layer');
  assert.equal(activeLayer.structuredContent.content.kind, 'raster');
  const preview = await reader.callTool({ name: 'lighttable_preview', arguments: {
    documentId: 'document-demo', expectedDocumentRevision: 1, maxEdge: 512
  } });
  assert.equal(preview.isError, undefined);
  assert.ok(preview.content.some(({ type }) => type === 'image'));
  assert.match(preview.content.find(({ type }) => type === 'text').text,
    /"canonicalRevision":1/u);
  const layerPreview = await reader.callTool({ name: 'lighttable_layer_preview', arguments: {
    documentId: 'document-demo', layerId: 'layer-background', channel: 'pixels',
    expectedDocumentRevision: 1, maxEdge: 512
  } });
  assert.equal(layerPreview.isError, undefined);
  assert.ok(layerPreview.content.some(({ type }) => type === 'image'));
  const unchangedLayerPreview = await reader.callTool({ name: 'lighttable_layer_preview', arguments: {
    documentId: 'document-demo', layerId: 'layer-background', channel: 'pixels',
    expectedDocumentRevision: 1, maxEdge: 512, knownArtifactId: 'layer-preview-demo'
  } });
  assert.equal(unchangedLayerPreview.content.some(({ type }) => type === 'image'), false);
  assert.equal(unchangedLayerPreview.structuredContent.unchanged, true);
  const regionPreview = await reader.callTool({ name: 'lighttable_region_preview', arguments: {
    documentId: 'document-demo', region: { x: 100, y: 80, width: 320, height: 160 },
    expectedDocumentRevision: 1, maxEdge: 160, format: 'webp', quality: 0.7
  } });
  assert.equal(regionPreview.isError, undefined);
  assert.ok(regionPreview.content.some(({ type }) => type === 'image'));
  assert.deepEqual(regionPreview.structuredContent, undefined);
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
  const grade = await reader.callTool({ name: 'lighttable_grade', arguments: {
    documentId: 'document-demo', target: { kind: 'document' }
  } });
  assert.equal(grade.structuredContent.values.exposureEV, 0);
  const adjustment = await reader.callTool({ name: 'lighttable_adjustment', arguments: {
    documentId: 'document-demo', expectedDocumentRevision: 1,
    target: { kind: 'document', owner: 'grade' }
  } });
  assert.equal(adjustment.structuredContent.adjustmentKind, 'grade');
  assert.equal(adjustment.structuredContent.stack.truncated, false);
  const style = await editor.callTool({ name: 'lighttable_layer_style', arguments: {
    documentId: 'document-demo', layerId: 'layer-background', operation: 'add',
    effectKind: 'drop-shadow', settings: { distance: 20, size: 10 }
  } });
  assert.equal(style.isError, undefined);
  const social = await editor.callTool({ name: 'lighttable_build_social_design', arguments: {
    name: 'Deterministic social card', title: 'HELLO', body: 'Editable release candidate.'
  } });
  assert.equal(social.isError, undefined);
  assert.equal(social.structuredContent.documentId, 'document-demo');
  assert.deepEqual(social.structuredContent.layerKinds,
    ['asset', 'point-text', 'paragraph-text', 'gradient-vector', 'drop-shadow']);
  const batch = await editor.callTool({ name: 'lighttable_batch', arguments: {
    documentId: 'document-demo', name: 'MCP mini design', operations: [
      { operationId: 'rename', command: 'layer.rename', parameters: {
        layerId: 'layer-background', name: 'Batch background' } }
    ]
  } });
  assert.equal(batch.isError, undefined);
  const events = await reader.callTool({ name: 'lighttable_task_events', arguments: { afterCursor: 0 } });
  assert.deepEqual(events.structuredContent.events, []);
  const task = await reader.callTool({ name: 'lighttable_task', arguments: {
    documentId: 'document-demo', taskId: 'task-demo'
  } });
  assert.deepEqual(task.structuredContent, {
    id: 'task-demo', status: 'completed', progress: 1, error: null,
    artifact: { id: 'artifact-demo', kind: 'png-export', name: 'demo.png',
      mediaType: 'image/png', byteLength: 3, createdAt: 1 }
  });
  const publications = await reader.callTool({ name: 'lighttable_events', arguments: { afterCursor: 0 } });
  assert.deepEqual(publications.structuredContent, { cursor: 0, latestCursor: 0,
    oldestCursor: 1, gap: false, hasMore: false, events: [] });
  const waited = await reader.callTool({ name: 'lighttable_wait_for_events', arguments: {
    afterCursor: 0, timeoutMs: 0
  } });
  assert.deepEqual(waited.structuredContent, { cursor: 0, latestCursor: 0,
    oldestCursor: 1, gap: false, hasMore: false, events: [], timedOut: true });
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

test('OAuth authorization form requires a one-time same-site CSRF token', async (context) => {
  const service = await createLightTableMcpApp({ publicUrl: 'http://127.0.0.1:8787',
    pairingCode: 'integration-pairing', client: new MockLightTableClient(),
    allowInsecure: true, allowedHosts: ['127.0.0.1'] });
  const http = await listen(service.app);
  context.after(async () => { await service.close(); await new Promise((resolve) => http.close(resolve)); });
  const client = service.oauth.register({ redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = 'c'.repeat(64); const query = new URLSearchParams({ client_id: client.client_id,
    redirect_uri: client.redirect_uris[0], response_type: 'code', scope: 'lighttable:read', state: 'state-1',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const base = `http://127.0.0.1:${http.address().port}`;
  const form = await fetch(`${base}/oauth/authorize?${query}`); const html = await form.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/u)?.[1];
  const cookie = form.headers.get('set-cookie')?.split(';')[0];
  assert.ok(csrf); assert.ok(cookie);
  const missing = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: query });
  assert.equal(missing.status, 400);
  const body = new URLSearchParams(query); body.set('pairing_code', 'integration-pairing'); body.set('csrf', csrf);
  const accepted = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body });
  assert.equal(accepted.status, 303);
  const replay = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body });
  assert.equal(replay.status, 400);
});
