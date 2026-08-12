import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GenAiModelId, GenAiModelSummary, GenAiProviderId, GenAiWorkflowDefinition, GenAiWorkflowId } from '@lighttable/genai-core';
import { OpenArtCatalogStore } from './openArtCatalogStore';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('OpenArtCatalogStore', () => {
  it('atomically retains models and source schemas for offline fallback', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lighttable-openart-catalog-'));
    roots.push(root);
    const filePath = path.join(root, 'nested', 'catalog.json');
    const store = new OpenArtCatalogStore(filePath);
    const model = { id: 'gpt-image-2' as GenAiModelId, providerId: 'openart' as GenAiProviderId,
      label: 'GPT Image 2', capabilities: ['text2image'] } satisfies GenAiModelSummary;
    const workflow = { id: 'openart:gpt-image-2:text2image' as GenAiWorkflowId,
      providerId: 'openart' as GenAiProviderId, modelId: model.id, label: 'Text to image', mode: 'text2image',
      fields: [{ key: 'futureField', label: 'Future field', kind: 'unknown', required: false,
        advanced: true, sourceSchema: { type: ['string', 'null'], providerExtension: true } }] } satisfies GenAiWorkflowDefinition;
    await store.saveModels([model]);
    await store.saveWorkflow(workflow);
    expect((await store.load()).models).toEqual([model]);
    expect(await store.workflow(workflow.id)).toEqual(workflow);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      format: 'lighttable-genai-catalog', source: 'openart-mcp'
    });
  });

  it('does not retain an empty workflow that would hide every model control', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lighttable-openart-catalog-'));
    roots.push(root);
    const store = new OpenArtCatalogStore(path.join(root, 'catalog.json'));
    const empty = {
      id: 'openart:nano-banana-pro:text2image' as GenAiWorkflowId,
      providerId: 'openart' as GenAiProviderId,
      modelId: 'nano-banana-pro' as GenAiModelId,
      label: 'Text to image', mode: 'text2image', fields: []
    } satisfies GenAiWorkflowDefinition;
    await expect(store.saveWorkflow(empty)).rejects.toThrow('without fields');
  });
});
