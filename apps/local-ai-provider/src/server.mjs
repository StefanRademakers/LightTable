import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { capabilities, PROTOCOL_VERSION, PROVIDER_VERSION, validateRequest } from './contract.mjs';

const MAX_BODY_BYTES = 128 * 1024 * 1024;
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const jobView = (job) => ({
  jobId: job.id,
  status: job.status,
  progress: job.progress,
  phase: job.phase,
  ...(job.error ? { error: job.error } : {})
});
const safeError = (error) => ({
  code: typeof error?.code === 'string' ? error.code : 'INFERENCE_FAILED',
  message: error instanceof Error ? error.message : 'Local inference failed.',
  retryable: ['OUT_OF_MEMORY', 'MODEL_LOAD_FAILED', 'INFERENCE_FAILED'].includes(error?.code)
});
const collect = async (request) => {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error('Request exceeds the 128 MiB limit.'), { code: 'INPUT_TOO_LARGE' });
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw Object.assign(new Error('Request exceeds the 128 MiB limit.'), { code: 'INPUT_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export class LocalAiProviderServer {
  constructor({ backend, host = '127.0.0.1', port = 7862, token, workDirectory } = {}) {
    if (!backend) throw new Error('Local AI provider requires an inference backend.');
    this.backend = backend;
    this.host = host;
    this.port = port;
    this.token = token;
    this.workDirectory = path.resolve(workDirectory ?? path.join(tmpdir(), 'lighttable-local-ai'));
    this.jobs = new Map();
    this.queue = [];
    this.running = false;
    this.server = createServer((request, response) => void this.#route(request, response));
  }

  async listen() {
    await mkdir(this.workDirectory, { recursive: true });
    this.modelReady = await this.backend.ready?.() ?? true;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    const address = this.server.address();
    if (typeof address === 'object' && address) this.port = address.port;
    return this;
  }

  async close() {
    for (const job of this.jobs.values()) job.controller?.abort();
    await new Promise((resolve) => this.server.close(resolve));
  }

  #authorized(request) {
    return !this.token || request.headers.authorization === `Bearer ${this.token}`;
  }

  async #route(request, response) {
    try {
      const url = new URL(request.url ?? '/', `http://${this.host}:${this.port}`);
      if (!this.#authorized(request)) return json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Invalid provider token.' } });
      if (request.method === 'GET' && url.pathname === '/api/v1/health') {
        return json(response, 200, {
          status: this.running ? 'busy' : 'ready',
          protocolVersion: PROTOCOL_VERSION,
          providerVersion: PROVIDER_VERSION,
          modelLoaded: this.modelReady,
          message: this.running ? 'Inference job running.' : 'Provider ready.'
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') return json(response, 200, capabilities);
      if (request.method === 'GET' && url.pathname === '/api/help') return json(response, 200, {
        protocol: `${capabilities.protocol.name}/${PROTOCOL_VERSION}`,
        endpoints: ['GET /api/v1/health', 'GET /api/v1/capabilities', 'POST /api/v1/jobs',
          'GET /api/v1/jobs/:id', 'GET /api/v1/jobs/:id/result', 'POST /api/v1/jobs/:id/cancel']
      });
      if (request.method === 'POST' && url.pathname === '/api/v1/jobs') return await this.#submit(request, response);

      const match = /^\/api\/v1\/jobs\/([^/]+)(?:\/(result|cancel|files\/([^/]+)))?$/u.exec(url.pathname);
      if (!match) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
      const job = this.jobs.get(decodeURIComponent(match[1]));
      if (!job) return json(response, 404, { error: { code: 'JOB_NOT_FOUND', message: 'Job not found.' } });
      if (!match[2] && request.method === 'GET') return json(response, 200, jobView(job));
      if (match[2] === 'cancel' && request.method === 'POST') {
        if (job.status === 'queued') {
          job.status = 'cancelled';
          job.phase = 'cancelled';
          this.queue = this.queue.filter((candidate) => candidate !== job);
        } else if (job.status === 'running' || job.status === 'loading-model') job.controller.abort();
        return json(response, 200, jobView(job));
      }
      if (match[2] === 'result' && request.method === 'GET') {
        if (job.status !== 'completed') return json(response, 409, { error: { code: 'RESULT_NOT_READY', message: 'Result is not ready.' } });
        return json(response, 200, job.result);
      }
      if (match[2]?.startsWith('files/') && request.method === 'GET') {
        const image = job.outputs.find((candidate) => candidate.id === decodeURIComponent(match[3]));
        if (!image) return json(response, 404, { error: { code: 'RESULT_NOT_FOUND', message: 'Result image not found.' } });
        const bytes = await readFile(image.path);
        response.writeHead(200, { 'content-type': image.mimeType, 'content-length': String(bytes.length), 'cache-control': 'no-store' });
        return response.end(bytes);
      }
      return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    } catch (error) {
      const failure = safeError(error);
      return json(response, failure.code === 'INPUT_TOO_LARGE' ? 413 : 400, { error: failure });
    }
  }

  async #submit(nodeRequest, response) {
    const bytes = await collect(nodeRequest);
    const webRequest = new Request(`http://${this.host}:${this.port}/api/v1/jobs`, {
      method: 'POST', headers: nodeRequest.headers, body: bytes
    });
    const form = await webRequest.formData();
    const requestPart = form.get('request');
    if (!(requestPart instanceof Blob)) throw Object.assign(new Error('Missing request JSON part.'), { code: 'INVALID_REQUEST' });
    const request = validateRequest(JSON.parse(await requestPart.text()));
    const id = randomUUID();
    const jobDirectory = path.join(this.workDirectory, id);
    await mkdir(jobDirectory, { recursive: true });
    const files = new Map();
    for (const [field, value] of form.entries()) {
      if (field === 'request' || !(value instanceof Blob)) continue;
      if (!capabilities.input.supportedMimeTypes.includes(value.type)) {
        await rm(jobDirectory, { recursive: true, force: true });
        throw Object.assign(new Error(`Unsupported input type ${value.type}.`), { code: 'INVALID_REQUEST' });
      }
      const filePath = path.join(jobDirectory, `${files.size}-${field.replace(/[^A-Za-z0-9_-]/gu, '_')}`);
      await writeFile(filePath, Buffer.from(await value.arrayBuffer()));
      files.set(field, { path: filePath, mimeType: value.type });
    }
    const job = {
      id, request, files, jobDirectory, status: 'queued', progress: 0, phase: 'queued',
      controller: new AbortController(), outputs: [], result: undefined, error: undefined
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    void this.#drain();
    return json(response, 202, jobView(job));
  }

  async #drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (!job || job.status === 'cancelled') continue;
        const startedAt = Date.now();
        job.status = 'loading-model';
        job.phase = 'loading-model';
        try {
          const generated = await this.backend.run({
            jobId: job.id, request: job.request, files: job.files, signal: job.controller.signal,
            onProgress: (progress, phase) => {
              job.progress = progress;
              job.phase = phase;
              job.status = phase === 'loading-model' ? 'loading-model' : 'running';
            }
          });
          for (let index = 0; index < generated.length; index += 1) {
            const output = generated[index];
            const id = `image-${index + 1}`;
            const filePath = path.join(job.jobDirectory, `${id}.png`);
            await writeFile(filePath, output.bytes);
            job.outputs.push({ id, path: filePath, mimeType: output.mimeType, width: output.width, height: output.height });
          }
          job.result = {
            jobId: job.id,
            images: job.outputs.map((image) => ({
              id: image.id,
              url: `/api/v1/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(image.id)}`,
              mimeType: image.mimeType, width: image.width, height: image.height, hasAlpha: false
            })),
            generation: {
              providerId: capabilities.provider.id, providerVersion: PROVIDER_VERSION,
              modelId: job.request.modelId, seed: job.request.seed, durationMs: Date.now() - startedAt
            }
          };
          job.status = 'completed';
          job.phase = 'completed';
          job.progress = 1;
        } catch (error) {
          const failure = safeError(error);
          job.status = failure.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed';
          job.phase = job.status;
          job.error = failure;
        }
      }
    } finally { this.running = false; }
  }
}
