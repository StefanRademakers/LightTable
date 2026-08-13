import { describe, expect, it } from 'vitest';
import { LocalAiConnectionController } from './localAiConnectionController';
import type { GenAiModelId } from '@lighttable/genai-core';

const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' }
});
const capabilities = {
  protocol: { name: 'lighttable-ai-provider', version: '1.0' },
  provider: { id: 'runtime-id', name: 'Local runtime', version: '0.1.0' },
  operations: ['image.create', 'image.edit'],
  input: { supportsBaseImage: true, supportsReferences: true, maxReferences: 10,
    supportsSelectionMask: false, selectionMaskFormats: [], supportedMimeTypes: ['image/png'] },
  output: { supportedMimeTypes: ['image/png'], supportsAlpha: false, maxImagesPerJob: 1 },
  limits: { minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048 },
  models: [{ id: 'flux', name: 'FLUX', operations: ['image.create', 'image.edit'],
    settings: { outputSizes: ['1K', '2K'] } }]
};

describe('LocalAiConnectionController', () => {
  it('maps protocol discovery to the shared provider and workflow contracts', async () => {
    const controller = new LocalAiConnectionController({ baseUrl: 'http://127.0.0.1:7862' }, async (input) => {
      const pathname = new URL(String(input)).pathname;
      return json(pathname.endsWith('/health')
        ? { status: 'ready', protocolVersion: '1.0', providerVersion: '0.1.0', modelLoaded: true }
        : capabilities);
    });
    expect((await controller.connect()).status).toBe('connected');
    expect((await controller.listModels())[0]).toMatchObject({ providerId: 'lighttable-local', label: 'FLUX' });
    expect(await controller.loadWorkflow('flux' as GenAiModelId, 'text2image')).toMatchObject({
      providerId: 'lighttable-local', mode: 'text2image'
    });
  });

  it('starts and stops a managed service session lazily', async () => {
    let starts = 0;
    let stops = 0;
    const controller = new LocalAiConnectionController({
      async start() { starts += 1; return { baseUrl: 'http://127.0.0.1:7862' }; },
      async stop() { stops += 1; }
    }, async (input) => {
      const pathname = new URL(String(input)).pathname;
      return json(pathname.endsWith('/health')
        ? { status: 'ready', protocolVersion: '1.0', providerVersion: '0.1.0', modelLoaded: true }
        : capabilities);
    });
    expect(starts).toBe(0);
    await controller.connect();
    expect(starts).toBe(1);
    await controller.disconnect();
    expect(stops).toBe(1);
    expect(() => controller.clientInstance()).toThrow('not connected');
  });
});
