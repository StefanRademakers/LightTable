import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setAdjustmentLayerStack } from '../../editor/document/documentCommands';
import { setRasterLayerAdjustmentStack } from '../../editor/document/documentCommands';
import { setRasterLayerAttachedAdjustmentStack } from '../../editor/document/documentCommands';
import { parseAttachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';

export interface AdjustmentProjectionInput {
  readonly snapshot: BasicAdjustments;
  readonly targetLayerId: LayerId | null;
  readonly document: ImageDocument | null;
  readonly documentAdjustments: BasicAdjustments;
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
export const projectAdjustmentSnapshot = ({
  snapshot,
  targetLayerId,
  document,
  documentAdjustments
}: AdjustmentProjectionInput): AdjustmentProjection => {
  const editorAdjustments = structuredClone(snapshot);
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
    const generatedStack = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(editorAdjustments, adjustment.adjustmentStack),
      'layer'
    );
    const generatedByType = new Map(
      generatedStack.modules.map((module) => [module.type, module])
    );
    const modules = adjustment.adjustmentStack.modules.map((module) =>
      generatedByType.get(module.type) ?? structuredClone(module)
    );
    const changed = modules.some((module, index) => {
      const previous = adjustment.adjustmentStack.modules[index];
      return !previous || module.revision !== previous.revision;
    });
    return {
      editorAdjustments,
      documentAdjustments: createDefaultAdjustments(),
      document: setRasterLayerAttachedAdjustmentStack(
        document,
        layer.id,
        adjustment.id,
        {
          id: adjustment.adjustmentStack.id,
          revision: changed
            ? adjustment.adjustmentStack.revision + 1
            : adjustment.adjustmentStack.revision,
          modules
        }
      ),
      scope: 'layer'
    };
  }
  const target = findDocumentLayer(document, targetLayerId);
  if (target?.type !== 'adjustment' && target?.type !== 'raster') {
    throw new Error('The selected layer cannot own a grade.');
  }
  const generatedStack = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(
      editorAdjustments,
      target.adjustmentStack ?? undefined
    ),
    target.type === 'adjustment' ? 'adjustment-layer' : 'layer'
  );
  const scope = target.type === 'adjustment' ? 'adjustment-layer' : 'layer';
  if (target.type === 'adjustment') {
    const generatedByType = new Map(
      generatedStack.modules.map((module) => [module.type, module])
    );
    const modules = target.adjustmentStack.modules.map((module) =>
      generatedByType.get(module.type) ?? structuredClone(module)
    );
    const changed = modules.some((module, index) => {
      const previous = target.adjustmentStack.modules[index];
      return !previous
        || module.revision !== previous.revision;
    });
    return {
      editorAdjustments,
      documentAdjustments: createDefaultAdjustments(),
      document: setAdjustmentLayerStack(document, targetLayerId, {
        id: target.adjustmentStack.id,
        revision: changed
          ? target.adjustmentStack.revision + 1
          : target.adjustmentStack.revision,
        modules
      }),
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
  const nextDocumentAdjustments = createDefaultAdjustments();
  return {
    editorAdjustments,
    documentAdjustments: nextDocumentAdjustments,
    document: setRasterLayerAdjustmentStack(document, targetLayerId, nextStack),
    scope
  };
};
