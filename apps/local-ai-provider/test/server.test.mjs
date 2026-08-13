import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeInferenceBackend } from '../src/fakeBackend.mjs';
import { LocalAiProviderServer } from '../src/server.mjs';

const servers = [];
afterEach(async () => { while (servers.length) await servers.pop().close(); });
const start = async (backend = new FakeInferenceBackend(), options = {}) => {
  const workDirectory = options.workDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'lighttable-local-ai-test-'));
  const server = await new LocalAiProviderServer({ backend, port: 0, token: 'test-token', workDirectory, ...options }).listen();
  servers.push(server);
  return { server, workDirectory, base: `http://127.0.0.1:${server.port}`, headers: { Authorization: 'Bearer test-token' } };
};
const submit = async ({ base, headers }, request) => {
  const body = new FormData();
  body.set('request', new Blob([JSON.stringify(request)], { type: 'application/json' }), 'request.json');
  return fetch(`${base}/api/v1/jobs`, { method: 'POST', headers, body });
};
const request = {
  operation: 'image.create', intent: 'general-create', modelId: 'flux-2-klein-4b', prompt: 'test',
  output: { width: 512, height: 512, count: 1, mimeType: 'image/png', includeAlpha: false }
};

describe('LightTable local AI provider', () => {
  it('discovers capabilities and completes a queued job', async () => {
    const runtime = await start();
    const capabilities = await fetch(`${runtime.base}/api/v1/capabilities`, { headers: runtime.headers }).then((response) => response.json());
    assert.equal(capabilities.protocol.version, '1.0');
    assert.equal(capabilities.provider.id, 'lighttable-local');
    const accepted = await submit(runtime, request);
    assert.equal(accepted.status, 202);
    const job = await accepted.json();
    let status;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      status = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}`, { headers: runtime.headers }).then((response) => response.json());
      if (status.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(status.status, 'completed');
    const result = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}/result`, { headers: runtime.headers }).then((response) => response.json());
    const image = await fetch(new URL(result.images[0].url, runtime.base), { headers: runtime.headers });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await image.arrayBuffer()).byteLength > 32);
  });

  it('rejects unauthenticated requests', async () => {
    const runtime = await start();
    assert.equal((await fetch(`${runtime.base}/api/v1/health`)).status, 401);
  });

  it('cancels the active job without accepting a successful result', async () => {
    let release;
    const backend = {
      async ready() { return true; },
      async run() {
        await new Promise((resolve) => { release = resolve; });
        return [{ bytes: Buffer.from('late result'), mimeType: 'image/png', width: 1, height: 1 }];
      }
    };
    const runtime = await start(backend);
    const job = await (await submit(runtime, request)).json();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    const cancelled = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}/cancel`, { method: 'POST', headers: runtime.headers }).then((response) => response.json());
    assert.equal(cancelled.status, 'cancelled');
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}`, { headers: runtime.headers }).then((response) => response.json());
    assert.equal(status.status, 'cancelled');
    assert.equal((await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}/result`, { headers: runtime.headers })).status, 409);
    assert.deepEqual(await readdir(runtime.workDirectory), []);
  });

  it('bounds retained terminal jobs and their output directories', async () => {
    const runtime = await start(new FakeInferenceBackend(), { maxRetainedJobs: 3 });
    for (let index = 0; index < 8; index += 1) {
      const job = await (await submit(runtime, { ...request, prompt: `memory-${index}` })).json();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}`, { headers: runtime.headers }).then((response) => response.json());
        if (status.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    assert.equal(runtime.server.jobs.size, 3);
    assert.equal((await readdir(runtime.workDirectory)).length, 3);
  });
});
