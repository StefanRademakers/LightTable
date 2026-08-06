import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { renameLayer, setLayerFillOpacity, setLayersVisibility } from '../../editor/document/documentCommands';
import { setLayerStyleEnabled, setLayerStyleStackEnabled } from '../../editor/styles/layerStyleCommands';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import type { TextToolSettings } from '../../editor/session/editorSession';
import { parseSemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand } from './semanticVectorCommandContract';
import { parseSemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import { executeSemanticTextCommand } from '../text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import { executeSemanticLayerStyleCommand } from '../styles/semanticLayerStyleCommandExecutor';
import type { AtomicCommandBatch, AtomicBatchOperation } from './atomicCommandBatchContract';

export interface AtomicCommandBatchDependencies {
  readonly fontRegistry: DocumentFontRegistry;
  getDocument(): ImageDocument | null;
  getTextSettings(): TextToolSettings;
  getForegroundColor(): string;
  publish(document: ImageDocument): void;
  record(before: ImageDocument, after: ImageDocument, label: string): void;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const semanticKind = (operation: AtomicBatchOperation) => operation.command.split('.').at(-1)!;
const resolveReferences = (value: unknown, results: ReadonlyMap<string, unknown>): unknown => {
  if (Array.isArray(value)) return value.map((entry) => resolveReferences(entry, results));
  if (!record(value)) return value;
  if (typeof value.resultOf === 'string' && typeof value.field === 'string'
    && Object.keys(value).length === 2) {
    const source = results.get(value.resultOf);
    if (!record(source) || !(value.field in source)) throw new Error(`Result reference ${value.resultOf}.${value.field} is unavailable.`);
    return source[value.field];
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveReferences(entry, results)]));
};

export const executeAtomicCommandBatch = async (
  batch: AtomicCommandBatch,
  dependencies: AtomicCommandBatchDependencies,
  signal: AbortSignal,
  report: (completed: number, operationId: string) => void
): Promise<{ readonly results: readonly { readonly operationId: string; readonly value: unknown }[] }> => {
  const before = dependencies.getDocument();
  if (!before) throw new Error('The batch document is unavailable.');
  let current = before;
  const results = new Map<string, unknown>();
  const local = { getDocument: () => current, applyDocument: (document: ImageDocument) => { current = document; },
    recordHistory: () => undefined };
  for (const [index, operation] of batch.operations.entries()) {
    if (signal.aborted) throw new DOMException('The batch was canceled.', 'AbortError');
    const parameters = resolveReferences(operation.parameters, results);
    let result: unknown = null;
    if (operation.command.startsWith('text.')) {
      const parsed = parseSemanticTextCommand(semanticKind(operation) as 'create' | 'replace' | 'format' | 'layout', parameters);
      if ('message' in parsed) throw new Error(`${operation.operationId}: ${parsed.message}`);
      result = await executeSemanticTextCommand(parsed, { ...local, fontRegistry: dependencies.fontRegistry,
        getTextSettings: dependencies.getTextSettings, getForegroundColor: dependencies.getForegroundColor });
    } else if (operation.command.startsWith('vector.')) {
      const parsed = parseSemanticVectorCommand(semanticKind(operation) as 'create' | 'update' | 'remove', parameters);
      if ('message' in parsed) throw new Error(`${operation.operationId}: ${parsed.message}`);
      result = executeSemanticVectorCommand(parsed, local);
    } else if (operation.command.startsWith('layer.effect.') && operation.command !== 'layer.effect.setEnabled') {
      const parsed = parseSemanticLayerStyleCommand(semanticKind(operation) as 'add' | 'update' | 'remove' | 'move', parameters);
      if ('message' in parsed) throw new Error(`${operation.operationId}: ${parsed.message}`);
      result = executeSemanticLayerStyleCommand(parsed, local);
    } else {
      if (!record(parameters)) throw new Error(`${operation.operationId}: parameters must be an object.`);
      const layerId = String(parameters.layerId ?? '') as LayerId;
      if (operation.command !== 'layer.setVisibility' && !findDocumentLayer(current, layerId)) {
        throw new Error(`${operation.operationId}: the target layer does not exist.`);
      }
      if (operation.command === 'layer.rename') {
        const name = typeof parameters.name === 'string' ? parameters.name.trim() : '';
        if (!name || name.length > 255) throw new Error(`${operation.operationId}: the layer name is invalid.`);
        current = renameLayer(current, layerId, name);
      } else if (operation.command === 'layer.setVisibility') {
        const ids = Array.isArray(parameters.layerIds) ? parameters.layerIds : [];
        if (!ids.length || ids.length > 256 || ids.some((id) => typeof id !== 'string'
          || !findDocumentLayer(current, id as LayerId))) throw new Error(`${operation.operationId}: layerIds are invalid.`);
        current = setLayersVisibility(current, ids as LayerId[], Boolean(parameters.visible));
      } else if (operation.command === 'layer.setFillOpacity') {
        const opacity = Number(parameters.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`${operation.operationId}: opacity is invalid.`);
        current = setLayerFillOpacity(current, layerId, opacity);
      } else if (operation.command === 'layer.style.setEnabled') {
        current = setLayerStyleStackEnabled(current, layerId, Boolean(parameters.enabled));
      } else {
        const effectId = String(parameters.effectId ?? '');
        if (!effectId) throw new Error(`${operation.operationId}: effectId is required.`);
        current = setLayerStyleEnabled(current, layerId, effectId as LayerStyleId, Boolean(parameters.enabled));
      }
      result = { layerId };
    }
    if (!result) throw new Error(`${operation.operationId}: the command did not change the document.`);
    results.set(operation.operationId, result);
    report(index + 1, operation.operationId);
  }
  if (signal.aborted) throw new DOMException('The batch was canceled.', 'AbortError');
  if (current === before) throw new Error('The batch did not change the document.');
  dependencies.publish(current);
  dependencies.record(before, current, batch.name);
  return { results: [...results].map(([operationId, value]) => ({ operationId, value })) };
};
