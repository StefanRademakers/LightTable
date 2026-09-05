import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import {
  LIGHTTABLE_COMMAND_SCHEMAS,
  formatSchemaValidationIssues,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import { findDocumentLayer, siblingLayers } from '../../editor/document/layerTree';
import { moveLayer, renameLayer, setLayerBlendMode, setLayerClipping, setLayerFillOpacity,
  setLayersLock, setLayersVisibility } from '../../editor/document/documentCommands';
import { setLayerStyleEnabled, setLayerStyleStackEnabled } from '../../editor/styles/layerStyleCommands';
import type { LayerStyleId } from '../../editor/styles/layerStyleTypes';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import type { TextToolSettings } from '../../editor/session/editorSession';
import { parseSemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand } from './semanticVectorCommandContract';
import { parseSemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import { parseSemanticLayerCommand } from './semanticLayerCommandContract';
import { executeSemanticTextCommand } from '../text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import { executeSemanticLayerStyleCommand } from '../styles/semanticLayerStyleCommandExecutor';
import type { AtomicCommandBatch, AtomicBatchOperation } from './atomicCommandBatchContract';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';

export interface AtomicCommandBatchDependencies {
  readonly fontRegistry: DocumentFontRegistry;
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
  getTextSettings(): TextToolSettings;
  getForegroundColor(): string;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const semanticTextKind = (command: AtomicBatchOperation['command']) => {
  const kinds = {
    'text.create': 'create',
    'text.replaceRange': 'replace',
    'text.format': 'format',
    'text.setLayout': 'layout'
  } as const;
  return kinds[command as keyof typeof kinds];
};
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
  const transaction = dependencies.documentMutations.begin(
    'automation.batch', { label: batch.name, type: 'automation.batch' }, undefined, 'cancel'
  );
  if (!transaction) throw new Error('The batch document is unavailable or busy.');
  const before = transaction.before;
  let current = before;
  const results = new Map<string, unknown>();
  const local = { getDocument: () => current, applyDocument: (document: ImageDocument) => { current = document; },
    recordHistory: () => undefined };
  try { for (const [index, operation] of batch.operations.entries()) {
    if (signal.aborted) throw new DOMException('The batch was canceled.', 'AbortError');
    const parameters = resolveReferences(operation.parameters, results);
    const sharedSchema = LIGHTTABLE_COMMAND_SCHEMAS[operation.command]?.input;
    if (sharedSchema) {
      const validation = validateJsonSchemaValue(sharedSchema, parameters);
      if (!validation.valid) throw new Error(
        `${operation.operationId}: parameters do not match the command schema: ${formatSchemaValidationIssues(validation.issues)}.`
      );
    }
    let result: unknown = null;
    if (operation.command.startsWith('text.')) {
      const kind = semanticTextKind(operation.command);
      if (!kind) throw new Error(`${operation.operationId}: the text command is not atomic-batch compatible.`);
      const parsed = parseSemanticTextCommand(kind, parameters);
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
      result = executeSemanticLayerStyleCommand(parsed, {
        changeDocument: (change) => {
          const next = change(current);
          if (next === current) return false;
          current = next;
          return true;
        }
      });
    } else if (operation.command === 'layer.move' || operation.command === 'layer.setBlendMode'
      || operation.command === 'layer.setClipping' || operation.command === 'layer.setLock') {
      const kinds = {
        'layer.move': 'move',
        'layer.setBlendMode': 'set-blend-mode',
        'layer.setClipping': 'set-clipping',
        'layer.setLock': 'set-lock'
      } as const;
      const parsed = parseSemanticLayerCommand(kinds[operation.command], parameters);
      if ('message' in parsed) throw new Error(`${operation.operationId}: ${parsed.message}`);
      if (parsed.kind === 'duplicate' || parsed.kind === 'delete') {
        throw new Error(`${operation.operationId}: the layer command is not atomic-batch compatible.`);
      }
      const targetIds = 'layerIds' in parsed ? parsed.layerIds : [parsed.layerId];
      if (targetIds.some((id) => !findDocumentLayer(current, id))) {
        throw new Error(`${operation.operationId}: the target layer does not exist.`);
      }
      if (parsed.kind === 'move') {
        const siblings = siblingLayers(current, parsed.layerId);
        const index = siblings.findIndex(({ id }) => id === parsed.layerId);
        const targetIndex = index + (parsed.direction === 'up' ? 1 : -1);
        if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
          throw new Error(`${operation.operationId}: the layer cannot move ${parsed.direction}.`);
        }
        current = moveLayer(current, parsed.layerId, targetIndex);
        result = { layerId: parsed.layerId, direction: parsed.direction };
      } else if (parsed.kind === 'set-blend-mode') {
        current = setLayerBlendMode(current, parsed.layerId, parsed.blendMode);
        result = { layerId: parsed.layerId, blendMode: parsed.blendMode };
      } else if (parsed.kind === 'set-clipping') {
        const siblings = siblingLayers(current, parsed.layerId);
        if (parsed.clipping && siblings.findIndex(({ id }) => id === parsed.layerId) <= 0) {
          throw new Error(`${operation.operationId}: clipping requires a lower sibling layer.`);
        }
        current = setLayerClipping(current, parsed.layerId, parsed.clipping);
        result = { layerId: parsed.layerId, clipping: parsed.clipping };
      } else if (parsed.kind === 'set-lock') {
        current = setLayersLock(current, [...parsed.layerIds], parsed.lock, parsed.locked);
        result = { layerIds: parsed.layerIds, lock: parsed.lock, locked: parsed.locked };
      }
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
        result = { layerId, name };
      } else if (operation.command === 'layer.setVisibility') {
        const ids = Array.isArray(parameters.layerIds) ? parameters.layerIds : [];
        if (!ids.length || ids.length > 256 || ids.some((id) => typeof id !== 'string'
          || !findDocumentLayer(current, id as LayerId))) throw new Error(`${operation.operationId}: layerIds are invalid.`);
        const layerIds = [...new Set(ids)] as LayerId[];
        current = setLayersVisibility(current, layerIds, parameters.visible as boolean);
        result = { layerIds, visible: parameters.visible };
      } else if (operation.command === 'layer.setFillOpacity') {
        const opacity = Number(parameters.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`${operation.operationId}: opacity is invalid.`);
        current = setLayerFillOpacity(current, layerId, opacity);
        result = { layerId, opacity };
      } else if (operation.command === 'layer.style.setEnabled') {
        current = setLayerStyleStackEnabled(current, layerId, Boolean(parameters.enabled));
        result = { layerId, enabled: Boolean(parameters.enabled) };
      } else {
        const effectId = String(parameters.effectId ?? '');
        if (!effectId) throw new Error(`${operation.operationId}: effectId is required.`);
        current = setLayerStyleEnabled(current, layerId, effectId as LayerStyleId, Boolean(parameters.enabled));
        result = { layerId, effectId, enabled: Boolean(parameters.enabled) };
      }
    }
    if (!result) throw new Error(`${operation.operationId}: the command did not change the document.`);
    results.set(operation.operationId, result);
    report(index + 1, operation.operationId);
    }
    if (signal.aborted) throw new DOMException('The batch was canceled.', 'AbortError');
    if (current === before) throw new Error('The batch did not change the document.');
    transaction.stage(() => current);
    if (!transaction.commit()) throw new Error('The batch document changed before it could be committed.');
    return { results: [...results].map(([operationId, value]) => ({ operationId, value })) };
  } catch (error) {
    transaction.cancel();
    throw error;
  }
};
