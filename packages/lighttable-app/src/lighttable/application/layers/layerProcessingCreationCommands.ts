import type { BasicAdjustments } from '../../types';
import { createDefaultAdjustments } from '../../types';
import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import {
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer
} from '../../editor/document/documentCommands';
import { findRasterLayer } from '../../editor/document/layerTree';
import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  adjustmentLayerDefinition,
  selectAdjustmentLayerModules,
  type AdjustmentInitialSettings,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import { createFilterStack, isFilterKind } from '../../processing/filter';
import { assertFilterStackDocumentReferences } from '../filters/filterDocumentReferences';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';
import type { PaintChannel } from '../../editor/session/editorSession';

interface ProcessingCreationDependencies {
  readonly beginTransaction: (
    id: string,
    description: { readonly label: string; readonly type: string }
  ) => DocumentMutationTransaction | null;
  readonly commitTransaction: (
    transaction: DocumentMutationTransaction,
    next: ImageDocument,
    description: { readonly label: string; readonly type: string }
  ) => boolean;
  captureFeedback(): ProcessingCreationFeedback;
}

export interface ProcessingCreationFeedback {
  isCurrent(): boolean;
  setActiveChannel(channel: PaintChannel): void;
  setError(message: string | null): void;
  setStatus(message: string | null): void;
}

export interface LayerProcessingCreationCommands {
  create(kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings): LayerId | null;
  attach(layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings): string | null;
}

const applyInitialSettings = (
  source: BasicAdjustments,
  settings?: AdjustmentInitialSettings
) => {
  if (!settings || 'radius' in settings) return;
  if ('posterizeLevels' in settings) {
    source.photoshopAdjustment.posterizeLevels = settings.posterizeLevels;
  } else if ('thresholdLevel' in settings) {
    source.photoshopAdjustment.thresholdLevel = settings.thresholdLevel;
  } else if ('colorStops' in settings && source.gradientMap) {
    source.gradientMap = {
      ...source.gradientMap,
      enabled: true,
      colorStops: settings.colorStops.map((stop) => ({ ...stop, color: { ...stop.color } })),
      opacityStops: settings.opacityStops.map((stop) => ({ ...stop })),
      ...(settings.reverse === undefined ? {} : { reverse: settings.reverse }),
      ...(settings.dither === undefined ? {} : { dither: settings.dither }),
      ...(settings.interpolation === undefined ? {} : { interpolation: settings.interpolation })
    };
  }
};

const createStack = (
  kind: AdjustmentLayerKind,
  scope: 'adjustment-layer' | 'layer',
  settings?: AdjustmentInitialSettings
) => {
  const definition = adjustmentLayerDefinition(kind);
  const source = createDefaultAdjustments();
  if (definition.photoshopKind) source.photoshopAdjustment.kind = definition.photoshopKind;
  if (kind === 'curves') source.curves.interpolation = 'photoshop-natural';
  if (kind === 'gradient-map' && source.gradientMap) {
    source.gradientMap.enabled = true;
    source.gradientMap.interpolation = 'classic';
    source.gradientMap.photoshopCompatible = true;
  }
  if (kind === 'grain') source.effects.grain.enabled = true;
  applyInitialSettings(source, settings);
  return isFilterKind(kind)
    ? createFilterStack(kind, settings ?? {})
    : selectAdjustmentLayerModules(adjustmentStackForScope(
        createAdjustmentStackFromBasicAdjustments(source),
        scope
      ), kind);
};

/** Owns creation of canonical adjustment layers and attached processing nodes. */
export const createLayerProcessingCreationCommands = (
  dependencies: ProcessingCreationDependencies
): LayerProcessingCreationCommands => ({
  create: (kind, aboveLayerId, settings) => {
    const feedback = dependencies.captureFeedback();
    const definition = adjustmentLayerDefinition(kind);
    const description = { label: `New ${definition.name} Layer`, type: 'layer.adjustment.create' };
    const transaction = dependencies.beginTransaction(`layer.adjustment.create:${kind}`, description);
    if (!transaction) return null;
    const stack = createStack(kind, 'adjustment-layer', settings);
    const next = createAdjustmentLayer(
      transaction.before,
      stack,
      definition.name,
      aboveLayerId ?? transaction.before.activeLayerId ?? undefined,
      kind
    );
    try {
      assertFilterStackDocumentReferences(transaction.before, kind, stack);
      if (!dependencies.commitTransaction(transaction, next, description)) return null;
    } catch (reason) {
      transaction.cancel();
      if (feedback.isCurrent()) feedback.setError(
        reason instanceof Error ? reason.message : `The ${definition.name} layer could not be created.`
      );
      return null;
    }
    if (feedback.isCurrent()) feedback.setActiveChannel('pixels');
    if (feedback.isCurrent()) feedback.setError(null);
    return next.activeLayerId;
  },
  attach: (layerId, kind, settings) => {
    const feedback = dependencies.captureFeedback();
    const definition = adjustmentLayerDefinition(kind);
    const description = { label: `Add ${definition.name}`, type: 'layer.adjustment.attach' };
    const transaction = dependencies.beginTransaction(
      `layer.adjustment.attach:${layerId}:${kind}`,
      description
    );
    if (!transaction) return null;
    const layer = findRasterLayer(transaction.before, layerId);
    if (!layer || layerIsLocked(layer, 'pixels')) {
      transaction.cancel();
      return null;
    }
    const adjustmentStack = createStack(kind, 'layer', settings);
    const adjustmentId = `attached-${crypto.randomUUID()}`;
    const next = addRasterLayerAttachedAdjustment(transaction.before, layerId, {
      id: adjustmentId,
      adjustmentKind: kind,
      name: definition.name,
      enabled: true,
      revision: 0,
      adjustmentStack
    });
    if (next === transaction.before) {
      transaction.cancel();
      return null;
    }
    try {
      assertFilterStackDocumentReferences(transaction.before, kind, adjustmentStack);
      if (!dependencies.commitTransaction(transaction, next, description)) return null;
    } catch (reason) {
      transaction.cancel();
      if (feedback.isCurrent()) feedback.setError(
        reason instanceof Error
          ? reason.message
          : `The ${definition.name} adjustment could not be attached.`
      );
      return null;
    }
    if (feedback.isCurrent()) feedback.setActiveChannel('pixels');
    if (feedback.isCurrent()) feedback.setStatus(`Attached ${definition.name} to ${layer.name}`);
    if (feedback.isCurrent()) feedback.setError(null);
    return adjustmentId;
  }
});
