import type { LocalAiBinaryInput, LocalAiCapabilitiesV1, LocalAiHealthV1, LocalAiImageJobRequestV1, LocalAiJobResultV1, LocalAiJobStatusV1 } from './protocol';
import { parseLocalAiCapabilities, parseLocalAiHealth, parseLocalAiJobResult, parseLocalAiJobStatus } from './validation';

const MAXIMUM_RESULT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

const readResponseBytesBounded = async (
  response: Response,
  maximumBytes: number,
  label: string
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes) {
    throw new Error(`${label} exceeds its safety limit.`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its safety limit.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds its safety limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export interface LocalAiProviderClientOptions {
  readonly baseUrl: string;
  readonly apiToken?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class LocalAiProviderClient {
  readonly baseUrl: URL;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly apiToken?: string;
  private readonly timeoutMs: number;

  constructor(options: LocalAiProviderClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.baseUrl.hostname) && this.baseUrl.protocol !== 'https:') {
      throw new Error('Remote AI providers must use HTTPS.');
    }
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.apiToken = options.apiToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.requestFetch(new URL(path, this.baseUrl), {
        ...init,
        redirect: 'error',
        signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
        headers: {
          ...(this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {}),
          ...init?.headers
        }
      });
      if (!response.ok) throw new Error(`Local AI provider returned HTTP ${response.status}.`);
      const bytes = await readResponseBytesBounded(response, MAXIMUM_JSON_BYTES, 'Local AI response');
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally { clearTimeout(timeout); }
  }

  health(): Promise<LocalAiHealthV1> {
    return this.request('api/v1/health').then(parseLocalAiHealth);
  }
  capabilities(): Promise<LocalAiCapabilitiesV1> {
    return this.request('api/v1/capabilities').then(parseLocalAiCapabilities);
  }
  async submit(request: LocalAiImageJobRequestV1, inputs: readonly LocalAiBinaryInput[]): Promise<LocalAiJobStatusV1> {
    const body = new FormData();
    body.set('request', new Blob([JSON.stringify(request)], { type: 'application/json' }), 'request.json');
    for (const input of inputs) {
      const bytes = new Uint8Array(input.bytes.byteLength);
      bytes.set(input.bytes);
      body.set(input.field, new Blob([bytes.buffer], { type: input.mediaType }), input.name);
    }
    return parseLocalAiJobStatus(await this.request('api/v1/jobs', { method: 'POST', body }));
  }
  status(jobId: string, signal?: AbortSignal): Promise<LocalAiJobStatusV1> {
    return this.request(`api/v1/jobs/${encodeURIComponent(jobId)}`, { signal }).then(parseLocalAiJobStatus);
  }
  result(jobId: string, signal?: AbortSignal): Promise<LocalAiJobResultV1> {
    return this.request(`api/v1/jobs/${encodeURIComponent(jobId)}/result`, { signal }).then(parseLocalAiJobResult);
  }
  cancel(jobId: string): Promise<LocalAiJobStatusV1> {
    return this.request(`api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).then(parseLocalAiJobStatus);
  }
  async downloadResult(result: LocalAiJobResultV1, index = 0, signal?: AbortSignal): Promise<Uint8Array> {
    const image = result.images[index];
    if (!image) throw new Error('Local AI provider returned no image.');
    const url = new URL(image.url, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new Error('Local AI result URL escaped the provider origin.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.requestFetch(url, {
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        headers: this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : undefined
      });
      if (!response.ok) throw new Error(`Local AI output download failed (${response.status}).`);
      try {
        return await readResponseBytesBounded(response, MAXIMUM_RESULT_BYTES, 'Local AI output');
      } catch (reason) {
        if (reason instanceof Error && /safety limit/u.test(reason.message)) {
          throw new Error('Local AI output exceeds the 128 MiB safety limit.');
        }
        throw reason;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
