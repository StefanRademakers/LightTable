import {
  adjustmentStackForScope,
  changedAdjustmentSettingsPaths,
  createAdjustmentStackFromBasicAdjustments,
  patchAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type {
  ImageDocument,
  LayerId,
  LayerNode
} from '../../editor/document/documentTypes';
import { findDocumentLayer, updateLayerNode } from '../../editor/document/layerTree';
import { parseAttachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import type { CurrentAdjustmentSettingsPath } from '../../processing/moduleDefinitions';

const adjustmentModulesEqual = (
  left: AdjustmentStack['modules'],
  right: AdjustmentStack['modules']
): boolean => left.length === right.length
  && left.every((module, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && module.id === candidate.id
      && module.type === candidate.type
      && module.enabled === candidate.enabled
      && module.revision === candidate.revision;
  });

/** Publishes an already-owned immutable stack without cloning unrelated modules. */
const publishProjectedStack = (
  document: ImageDocument,
  layerId: LayerId,
  stack: AdjustmentStack,
  attachedAdjustmentId?: string
): ImageDocument => {
  const layers = updateLayerNode(document.layers, layerId, (layer): LayerNode => {
    if (attachedAdjustmentId !== undefined) {
      if (layer.type !== 'raster') return layer;
      let changed = false;
      const attachedAdjustments = (layer.attachedAdjustments ?? []).map((adjustment) => {
        if (adjustment.id !== attachedAdjustmentId) return adjustment;
        changed = true;
        return {
          ...adjustment,
          adjustmentStack: stack,
          revision: adjustment.revision + 1
        };
      });
      return changed ? {
        ...layer,
        attachedAdjustments,
        revision: layer.revision + 1,
        modifiedAt: Date.now()
      } : layer;
    }
    if (layer.type !== 'adjustment' && layer.type !== 'raster') return layer;
    return {
      ...layer,
      adjustmentStack: stack,
      revision: layer.revision + 1,
      modifiedAt: Date.now()
    };
  });
  if (layers.every((layer, index) => layer === document.layers[index])) return document;
  return {
    ...document,
    layers,
    revision: document.revision + 1,
    modifiedAt: Date.now()
  };
};

export interface AdjustmentProjectionInput {
  readonly snapshot: BasicAdjustments;
  readonly targetLayerId: LayerId | null;
  readonly document: ImageDocument | null;
  readonly documentAdjustments: BasicAdjustments;
}

export interface AdjustmentDeltaProjectionInput extends AdjustmentProjectionInput {
  readonly previousSnapshot: BasicAdjustments;
}

export interface AdjustmentProjection {
  readonly editorAdjustments: BasicAdjustments;
  readonly documentAdjustments: BasicAdjustments;
  readonly document: ImageDocument | null;
  readonly scope: 'document' | 'layer' | 'adjustment-layer';
}

/**
 * Projects Grade and Lens Fx onto their explicit layer owner.
 *
 * Processing modules share the typed stack and layer ordering, but presence
 * and bypass remain independent. Only an existing or actually authored module
 * is projected, so focused nodes such as local Curves never manufacture the
 * rest of Grade. Scope-valid geometry nodes survive color projection.
 */
const projectAdjustmentSnapshotInternal = ({
  snapshot,
  targetLayerId,
  document,
  documentAdjustments,
  changedPaths
}: AdjustmentProjectionInput & {
  readonly changedPaths?: ReadonlySet<CurrentAdjustmentSettingsPath>;
}): AdjustmentProjection => {
  const editorAdjustments = changedPaths ? snapshot : structuredClone(snapshot);
  if (!targetLayerId) {
    return {
      editorAdjustments,
      documentAdjustments: editorAdjustments,
      document,
      scope: 'document'
    };
  }
  if (!document) {
    throw new Error('An Adjustment Layer grade requires an active document.');
  }
  const attachedTarget = parseAttachedAdjustmentOwnerId(targetLayerId);
  if (attachedTarget) {
    const layer = findDocumentLayer(document, attachedTarget.layerId);
    const adjustment = layer?.type === 'raster'
      ? (layer.attachedAdjustments ?? []).find(({ id }) => id === attachedTarget.adjustmentId)
      : null;
    if (!adjustment || layer?.type !== 'raster') {
      throw new Error('The attached adjustment no longer exists.');
    }
    const generatedStack = changedPaths
      ? patchAdjustmentStackFromBasicAdjustments(
          editorAdjustments,
          adjustment.adjustmentStack,
          changedPaths,
          'layer',
          false
        )
      : adjustmentStackForScope(
          createAdjustmentStackFromBasicAdjustments(editorAdjustments, adjustment.adjustmentStack),
          'layer'
        );
    const generatedByType = new Map(
      generatedStack.modules.map((module) => [module.type, module])
    );
    const modules = adjustment.adjustmentStack.modules.map((module) =>
      generatedByType.get(module.type) ?? structuredClone(module)
    );
    const changed = !adjustmentModulesEqual(
      adjustment.adjustmentStack.modules,
      modules
    );
    return {
      editorAdjustments,
      documentAdjustments,
      document: changed
        ? publishProjectedStack(
            document,
            layer.id,
            {
              id: adjustment.adjustmentStack.id,
              revision: adjustment.adjustmentStack.revision + 1,
              modules
            },
            adjustment.id
          )
        : document,
      scope: 'layer'
    };
  }
  const target = findDocumentLayer(document, targetLayerId);
  if (target?.type !== 'adjustment' && target?.type !== 'raster') {
    throw new Error('The selected layer cannot own a grade.');
  }
  const scope = target.type === 'adjustment' ? 'adjustment-layer' : 'layer';
  const generatedStack = changedPaths
    ? patchAdjustmentStackFromBasicAdjustments(
        editorAdjustments,
        target.adjustmentStack,
        changedPaths,
        scope,
        target.type === 'raster'
      )
    : adjustmentStackForScope(
        createAdjustmentStackFromBasicAdjustments(
          editorAdjustments,
          target.adjustmentStack ?? undefined
        ),
        scope
      );
  if (target.type === 'adjustment') {
    const generatedByType = new Map(
      generatedStack.modules.map((module) => [module.type, module])
    );
    const modules = target.adjustmentStack.modules.map((module) =>
      generatedByType.get(module.type) ?? structuredClone(module)
    );
    const changed = !adjustmentModulesEqual(target.adjustmentStack.modules, modules);
    return {
      editorAdjustments,
      documentAdjustments,
      document: changed
        ? publishProjectedStack(document, targetLayerId, {
            id: target.adjustmentStack.id,
            revision: target.adjustmentStack.revision + 1,
            modules
          })
        : document,
      scope
    };
  }
  if (changedPaths) {
    const previousStack = target.adjustmentStack;
    if (generatedStack === previousStack
      || (!previousStack && generatedStack.modules.length === 0)) {
      return { editorAdjustments, documentAdjustments, document, scope };
    }
    return {
      editorAdjustments,
      documentAdjustments,
      document: publishProjectedStack(document, targetLayerId, generatedStack),
      scope
    };
  }
  const existingModules = target.adjustmentStack
    ? adjustmentStackForScope(target.adjustmentStack, scope).modules
    : [];
  const existingTypes = new Set(existingModules.map((module) => module.type));
  const generatedByType = new Map(generatedStack.modules.map((module) => [module.type, module]));
  const neutralByType = new Map(adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
    scope
  ).modules.map((module) => [module.type, module]));
  const authoredTypes = new Set(generatedStack.modules
    .filter((module) => JSON.stringify(module.settings)
      !== JSON.stringify(neutralByType.get(module.type)?.settings))
    .map((module) => module.type));
  const updatedExisting = existingModules.map((module) =>
    generatedByType.get(module.type) ?? module
  );
  const nextStack = {
    ...generatedStack,
    modules: [
      ...updatedExisting,
      ...generatedStack.modules.filter((module) =>
        authoredTypes.has(module.type) && !existingTypes.has(module.type)
      )
    ]
  };
  if (adjustmentModulesEqual(existingModules, nextStack.modules)) {
    return {
      editorAdjustments,
      documentAdjustments,
      document,
      scope
    };
  }
  return {
    editorAdjustments,
    documentAdjustments,
    document: publishProjectedStack(document, targetLayerId, nextStack),
    scope
  };
};

/** Full snapshot projection for discrete commands, loading and replay. */
export const projectAdjustmentSnapshot = (
  input: AdjustmentProjectionInput
): AdjustmentProjection => projectAdjustmentSnapshotInternal(input);

/**
 * Pointer-rate projection. Only modules whose immutable settings path changed
 * are visited; unrelated settings never enter clone/serialization work.
 */
export const projectAdjustmentDelta = ({
  previousSnapshot,
  ...input
}: AdjustmentDeltaProjectionInput): AdjustmentProjection =>
  projectAdjustmentSnapshotInternal({
    ...input,
    changedPaths: changedAdjustmentSettingsPaths(previousSnapshot, input.snapshot)
  });
