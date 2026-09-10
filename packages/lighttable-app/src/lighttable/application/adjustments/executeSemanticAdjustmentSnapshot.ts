import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  adjustmentModuleBelongsToOwner,
  materializeBasicAdjustments
} from '../../processing/adjustmentStack';
import { currentProcessingModuleRegistry } from '../../processing/processingModuleRegistry';
import { attachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../../types';
import { isPhotoshopAdjustmentKind } from '../../photoshopAdjustments';
import {
  adjustmentLayerDefinition,
  isAdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import type { CurrentAdjustmentSettingsPath } from '../../processing/moduleDefinitions';
import type { AdjustmentQueryTarget } from './adjustmentQuery';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import { projectAdjustmentSnapshot } from './projectAdjustmentSnapshot';

export interface AdjustmentSnapshotHistoryEntry {
  readonly type: string;
  readonly label: string;
  readonly documentMutation: true;
  undo(): void;
  redo(): void;
}

interface ResolvedOwner {
  readonly targetLayerId: LayerId | null;
  readonly domain: AdjustmentPresentationDomain;
  readonly before: BasicAdjustments;
}

const readSetting = (settings: BasicAdjustments, path: CurrentAdjustmentSettingsPath) => (
  path.startsWith('effects.')
    ? settings.effects[path.slice('effects.'.length) as keyof BasicAdjustments['effects']]
    : settings[path as Exclude<CurrentAdjustmentSettingsPath, `effects.${string}`>]
);

const writeSetting = (settings: BasicAdjustments, path: CurrentAdjustmentSettingsPath,
  value: unknown) => {
  if (path.startsWith('effects.')) {
    const key = path.slice('effects.'.length) as keyof BasicAdjustments['effects'];
    (settings.effects as unknown as Record<string, unknown>)[key] = structuredClone(value);
  } else {
    (settings as unknown as Record<string, unknown>)[path] = structuredClone(value);
  }
};

const mergeDocumentOwner = (
  current: BasicAdjustments,
  incoming: BasicAdjustments,
  owner: 'grade' | 'lens-fx'
) => {
  const merged = cloneAdjustments(current);
  for (const definition of currentProcessingModuleRegistry.definitions()) {
    if (!adjustmentModuleBelongsToOwner(definition.type, owner)) continue;
    for (const path of definition.settingsPaths) {
      writeSetting(merged, path, readSetting(incoming, path));
    }
  }
  return merged;
};

const specializedKindMatches = (
  kind: string | null | undefined,
  snapshot: BasicAdjustments
) => !isPhotoshopAdjustmentKind(kind)
  || snapshot.photoshopAdjustment.kind === kind;

const isFilterOnlyOwner = (
  kind: string | null | undefined,
  stack: { readonly modules: readonly { readonly type: string }[] }
) => (isAdjustmentLayerKind(kind) && adjustmentLayerDefinition(kind).owner === 'filter')
  || (stack.modules.length > 0 && !stack.modules.some((module) => (
    (currentProcessingModuleRegistry.definition(module.type)?.settingsPaths.length ?? 0) > 0
  )));

const resolveOwner = (
  document: ImageDocument,
  documentAdjustments: BasicAdjustments,
  target: AdjustmentQueryTarget
): ResolvedOwner | { readonly message: string } => {
  if (target.kind === 'document') return {
    targetLayerId: null,
    domain: target.owner === 'grade' ? 'grade' : 'lens-fx',
    before: cloneAdjustments(documentAdjustments)
  };
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer || (layer.type !== 'raster' && layer.type !== 'adjustment')) {
    return { message: 'The adjustment owner layer does not exist.' };
  }
  if (layerIsLocked(layer, 'pixels')) {
    return { message: 'The adjustment owner is locked against processing edits.' };
  }
  if (target.kind === 'attached') {
    if (layer.type !== 'raster') {
      return { message: 'Only raster layers can own attached adjustments.' };
    }
    const adjustment = (layer.attachedAdjustments ?? [])
      .find(({ id }) => id === target.adjustmentId);
    if (!adjustment) return { message: 'The attached adjustment does not exist.' };
    if (isFilterOnlyOwner(adjustment.adjustmentKind, adjustment.adjustmentStack)) {
      return { message: 'Filter owners require their typed filter command.' };
    }
    return {
      targetLayerId: attachedAdjustmentOwnerId(layer.id, adjustment.id),
      domain: 'all',
      before: materializeBasicAdjustments(
        adjustment.adjustmentStack, undefined, undefined, true
      )
    };
  }
  if (isFilterOnlyOwner(
    layer.type === 'adjustment' ? layer.adjustmentKind : null,
    layer.adjustmentStack ?? { modules: [] }
  )) return { message: 'Filter owners require their typed filter command.' };
  return {
    targetLayerId: layer.id,
    domain: 'all',
    before: layer.adjustmentStack
      ? materializeBasicAdjustments(layer.adjustmentStack, undefined, undefined, true)
      : createDefaultAdjustments()
  };
};

export const executeSemanticAdjustmentSnapshot = (options: {
  readonly document: ImageDocument;
  readonly documentAdjustments: BasicAdjustments;
  readonly target: AdjustmentQueryTarget;
  readonly snapshot: BasicAdjustments;
  readonly changeDocument: DocumentMutationController['change'];
  readonly publishDocumentProcessing: (
    snapshot: BasicAdjustments,
    domain: AdjustmentPresentationDomain
  ) => void;
  readonly pushProcessingHistoryEntry: (entry: AdjustmentSnapshotHistoryEntry) => void;
}): { readonly target: AdjustmentQueryTarget; readonly changed: boolean } => {
  const resolved = resolveOwner(
    options.document, options.documentAdjustments, options.target
  );
  if ('message' in resolved) throw new Error(resolved.message);
  if (options.target.kind !== 'document') {
    const target = options.target;
    const layer = findDocumentLayer(options.document, target.layerId);
    const kind = target.kind === 'attached' && layer?.type === 'raster'
      ? (layer.attachedAdjustments ?? [])
          .find(({ id }) => id === target.adjustmentId)?.adjustmentKind
      : layer?.type === 'adjustment' ? layer.adjustmentKind : null;
    if (!specializedKindMatches(kind, options.snapshot)) {
      throw new Error(`The snapshot kind does not match the ${kind} adjustment owner.`);
    }
  }
  const before = cloneAdjustments(resolved.before);
  const after = options.target.kind === 'document'
    ? mergeDocumentOwner(before, options.snapshot, options.target.owner)
    : cloneAdjustments(options.snapshot);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { target: options.target, changed: false };
  }
  if (options.target.kind !== 'document') {
    const changed = options.changeDocument((currentDocument) => {
      const current = resolveOwner(
        currentDocument,
        options.documentAdjustments,
        options.target
      );
      if ('message' in current) throw new Error(current.message);
      const currentBefore = cloneAdjustments(current.before);
      const currentAfter = cloneAdjustments(options.snapshot);
      if (JSON.stringify(currentBefore) === JSON.stringify(currentAfter)) return currentDocument;
      return projectAdjustmentSnapshot({
        snapshot: currentAfter,
        targetLayerId: current.targetLayerId,
        document: currentDocument,
        documentAdjustments: options.documentAdjustments
      }).document ?? currentDocument;
    }, true, {
      label: 'Set Adjustment',
      type: 'adjustment.snapshot',
      layerIds: [options.target.layerId]
    });
    return { target: options.target, changed };
  }
  const apply = (snapshot: BasicAdjustments) => options.publishDocumentProcessing(
    cloneAdjustments(snapshot), resolved.domain
  );
  runEditorOperationTransaction({ operation: 'Set Adjustment' }, (transaction) => {
    transaction.step('publish adjustment snapshot', () => apply(after), () => apply(before));
    options.pushProcessingHistoryEntry({
      type: 'adjustment.snapshot',
      label: 'Set Adjustment',
      documentMutation: true,
      undo: () => apply(before),
      redo: () => apply(after)
    });
  });
  return { target: options.target, changed: true };
};
