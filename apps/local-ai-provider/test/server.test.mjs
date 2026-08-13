import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeInferenceBackend } from '../src/fakeBackend.mjs';
import { LocalAiProviderServer } from '../src/server.mjs';

const servers = [];
afterEach(async () => { while (servers.length) await servers.pop().close(); });
const start = async (backend = new FakeInferenceBackend()) => {
  const server = await new LocalAiProviderServer({ backend, port: 0, token: 'test-token' }).listen();
  servers.push(server);
  return { server, base: `http://127.0.0.1:${server.port}`, headers: { Authorization: 'Bearer test-token' } };
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
    const runtime = await start();
    const job = await (await submit(runtime, request)).json();
    await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}/cancel`, { method: 'POST', headers: runtime.headers });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await fetch(`${runtime.base}/api/v1/jobs/${job.jobId}`, { headers: runtime.headers }).then((response) => response.json());
    assert.equal(status.status, 'cancelled');
  });
});
