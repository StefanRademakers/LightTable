import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { ReferenceAssetRelay } from '../src/referenceAssetRelay.mjs';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

test('reference relay publishes bounded bytes through an expiring unguessable URL', async (context) => {
  let now = 1_000;
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'lighttable-reference-relay-'));
  const app = express();
  const relay = new ReferenceAssetRelay({ rootPath, publicUrl: 'https://relay.example', now: () => now, ttlMs: 5_000 });
  await relay.initialize();
  relay.installRoutes(app, (request) => request.get('authorization') === 'Bearer paired-session'
    ? { deviceId: 'device-a', expiresAt: 20_000 } : null);
  const server = await listen(app);
  context.after(async () => { await relay.close(); await new Promise((resolve) => server.close(resolve)); await rm(rootPath, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const denied = await fetch(`${base}/genai/references`, { method: 'PUT', body: bytes,
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
  assert.equal(denied.status, 401);
  const uploaded = await fetch(`${base}/genai/references`, { method: 'PUT', body: bytes, headers: {
    authorization: 'Bearer paired-session', 'content-type': 'image/png',
    'content-length': String(bytes.length), 'x-lighttable-file-name': '../portrait.png'
  } });
  assert.equal(uploaded.status, 201);
  const publication = await uploaded.json();
  assert.match(publication.url, /^https:\/\/relay\.example\/genai\/references\//u);
  const fetchUrl = new URL(publication.url); fetchUrl.host = new URL(base).host; fetchUrl.protocol = 'http:';
  const result = await fetch(fetchUrl);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  now = 7_000;
  assert.equal((await fetch(fetchUrl)).status, 404);
});
