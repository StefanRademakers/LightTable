import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { GenAiModelSummary, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import { atomicWriteFile } from '../atomicFileWriter';
import { readBoundedJsonFile } from '../boundedJsonFile';

const FORMAT = 'lighttable-genai-catalog';
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

interface StoredCatalog {
  readonly format: typeof FORMAT;
  readonly source: 'openart-mcp';
  readonly updatedAt: string;
  readonly models: readonly GenAiModelSummary[];
  readonly workflows: Readonly<Record<string, GenAiWorkflowDefinition>>;
}

const emptyCatalog = (): StoredCatalog => ({
  format: FORMAT, source: 'openart-mcp', updatedAt: new Date(0).toISOString(),
  models: [], workflows: {}
});

const usableWorkflow = (workflow: GenAiWorkflowDefinition | undefined): workflow is GenAiWorkflowDefinition =>
  Boolean(workflow?.fields.length);

export class OpenArtCatalogStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<StoredCatalog> {
    try {
      const value = await readBoundedJsonFile(
        this.filePath, MAX_CATALOG_BYTES, 'OpenArt catalog cache'
      ) as Partial<StoredCatalog>;
      if (value.format !== FORMAT || value.source !== 'openart-mcp'
        || !Array.isArray(value.models) || !value.workflows || typeof value.workflows !== 'object') {
        return emptyCatalog();
      }
      const catalog = value as StoredCatalog;
      return {
        ...catalog,
        models: catalog.models.slice(0, 1_000),
        workflows: Object.fromEntries(Object.entries(catalog.workflows)
          .filter(([, workflow]) => usableWorkflow(workflow)).slice(0, 2_000))
      };
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') return emptyCatalog();
      throw reason;
    }
  }

  async saveModels(models: readonly GenAiModelSummary[]): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, models: models.slice(0, 1_000) });
  }

  async saveWorkflow(workflow: GenAiWorkflowDefinition): Promise<void> {
    if (!usableWorkflow(workflow)) throw new Error('Cannot cache a GenAI workflow without fields.');
    const current = await this.load();
    await this.save({ ...current, workflows: { ...current.workflows, [workflow.id]: workflow } });
  }

  async workflow(id: string): Promise<GenAiWorkflowDefinition | undefined> {
    return (await this.load()).workflows[id];
  }

  private async save(value: StoredCatalog): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error('OpenArt catalog cache exceeds the 16 MiB safety limit.');
    await atomicWriteFile({
      targetPath: this.filePath,
      bytes
    });
  }
}
