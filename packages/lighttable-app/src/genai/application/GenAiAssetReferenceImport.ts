import type { GenAiAssetId, GenAiAssetReference, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { assignWorkflowReferences, workflowReferences } from './genAiWorkflowReferences';

type Values = Readonly<Record<string, unknown>>;
export interface GenAiAssetReferenceImportPorts {
  updateAssets(change: (current: readonly GenAiAssetReference[]) => readonly GenAiAssetReference[]): void;
  updateValues(change: (current: Values) => Values): void;
  updatePreviews(change: (current: Readonly<Record<string, string>>) => Readonly<Record<string, string>>): void;
  updateError(change: (current: string | undefined) => string | undefined): void;
  readLocalPreview(file: File): Promise<string>;
}
export interface GenAiAssetReferenceImportLease {
  isCurrent(): boolean;
  importFile(file: File): Promise<GenAiAssetReference | undefined>;
  requestPreview(assetId: GenAiAssetId): Promise<void>;
  /** True means scheduled under this lease, not that a deferred UI updater has already applied. */
  addReference(asset: GenAiAssetReference): boolean;
  removeReference(assetId: GenAiAssetId): boolean;
}
interface Target {
  readonly service: Pick<LightTableGenAiService, 'importProjectAsset' | 'loadProjectAssetPreview'> | undefined;
  readonly projectId: string | undefined;
  readonly workflow: GenAiWorkflowDefinition | undefined;
  isCurrent(): boolean;
}

export const readLocalReferencePreview = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result)
    : reject(new Error('The local reference preview could not be decoded.'));
  reader.onerror = () => reject(reader.error ?? new Error('The local reference preview could not be read.'));
  reader.readAsDataURL(file);
});

/** Captures attachment authority only. The host keeps any imported durable asset after retirement. */
export const createGenAiAssetReferenceImport = (
  { service, projectId, workflow, isCurrent }: Target,
  ports: GenAiAssetReferenceImportPorts
): GenAiAssetReferenceImportLease => {
  const publishError = (message: string | undefined) => {
    if (isCurrent()) ports.updateError(current => isCurrent() ? message : current);
  };
  const acceptsReferences = () => isCurrent() && Boolean(workflow?.fields.some(({ kind }) => kind === 'asset'));
  const addReference = (asset: GenAiAssetReference): boolean => {
    if (!acceptsReferences() || asset.projectId !== (projectId ?? '')) return false;
    ports.updateValues(current => {
      if (!isCurrent()) return current;
      const references = workflowReferences(workflow, current);
      return references.some(({ id }) => id === asset.id) ? current
        : assignWorkflowReferences(workflow, current, [...references, asset]);
    });
    return isCurrent();
  };
  const removeReference = (assetId: GenAiAssetId): boolean => {
    if (!acceptsReferences()) return false;
    ports.updateValues(current => !isCurrent() ? current : assignWorkflowReferences(workflow, current,
      workflowReferences(workflow, current).filter(({ id }) => id !== assetId)));
    return isCurrent();
  };
  return {
    isCurrent, addReference, removeReference,
    importFile: async file => {
      if (!isCurrent()) return undefined;
      if (!service) { publishError('Local media references are unavailable in this host.'); return undefined; }
      try {
        publishError(undefined);
        if (file.size > 256 * 1024 * 1024) throw new Error(`${file.name} exceeds the 256 MiB project asset limit.`);
        let imported: GenAiAssetReference; let preview: string | undefined;
        if (projectId) {
          if (!isCurrent()) return undefined;
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!isCurrent()) return undefined;
          imported = await service.importProjectAsset(projectId, { name: file.name, mediaType: file.type, bytes });
          if (imported.projectId !== projectId) throw new Error('The imported reference does not belong to the captured project.');
        } else {
          if (!isCurrent()) return undefined;
          preview = await ports.readLocalPreview(file);
          imported = { id: `session-${crypto.randomUUID()}` as GenAiAssetId, projectId: '',
            label: file.name, mediaType: file.type, previewId: `session-${file.name}` };
        }
        if (!isCurrent()) return undefined;
        ports.updateAssets(current => !isCurrent() || current.some(({ id }) => id === imported.id)
          ? current : [...current, imported]);
        if (preview !== undefined) ports.updatePreviews(current => isCurrent()
          ? { ...current, [imported.id]: preview! } : current);
        addReference(imported);
        return isCurrent() ? imported : undefined;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        publishError(message.includes("No handler registered for 'lighttable:genai-project-asset-import'")
          ? 'Restart the LightTable desktop process once to enable local reference imports.' : message);
        return undefined;
      }
    },
    requestPreview: async assetId => {
      if (!isCurrent() || !service || !projectId) return;
      try {
        const preview = await service.loadProjectAssetPreview(projectId, assetId);
        if (isCurrent() && preview) ports.updatePreviews(current => isCurrent() ? { ...current, [assetId]: preview } : current);
      } catch {
        // Thumbnail availability is optional; this must not reject or undo an imported attachment.
        // No shared preview-request bookkeeping is changed by a scoped late completion.
      }
    }
  };
};
