import { describe, expect, it } from 'vitest';
import { LocalAiProviderClient } from './client';
import { LIGHTTABLE_AI_PROTOCOL_NAME, LIGHTTABLE_AI_PROTOCOL_VERSION } from './protocol';

describe('LocalAiProviderClient', () => {
  it('validates capability discovery', async () => {
    const client = new LocalAiProviderClient({ baseUrl: 'http://127.0.0.1:7862', fetch: async () => new Response(JSON.stringify({
      protocol: { name: LIGHTTABLE_AI_PROTOCOL_NAME, version: LIGHTTABLE_AI_PROTOCOL_VERSION },
      provider: { id: 'local', name: 'Local', version: '0.1.0' }, operations: ['image.create'],
      input: {}, output: {}, limits: {}, models: [{ id: 'flux', name: 'FLUX', operations: ['image.create'] }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }) });
    await expect(client.capabilities()).resolves.toMatchObject({ provider: { id: 'local' } });
  });

  it('rejects non-HTTPS remote providers', () => {
    expect(() => new LocalAiProviderClient({ baseUrl: 'http://example.com:7862' })).toThrow(/HTTPS/);
  });

  it('authenticates protected result downloads', async () => {
    const requests: Request[] = [];
    const client = new LocalAiProviderClient({
      baseUrl: 'http://127.0.0.1:7862',
      apiToken: 'private-session-token',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
    });
    await expect(client.downloadResult({
      jobId: 'job-1',
      images: [{ id: 'image-1', url: '/api/v1/files/job-1/0', mimeType: 'image/png', width: 16, height: 16, hasAlpha: false }],
      generation: { providerId: 'local', providerVersion: '0.1.0', modelId: 'flux' }
    })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer private-session-token');
  });
});
