import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { attachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import type { BasicAdjustments } from '../../types';
import { reconcilePropertiesTarget, type PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import { materializeAdjustmentPresentationSource, resolveAdjustmentPresentationSource } from './resolveAdjustmentPresentation';

/** Resolve once: destination, identity and settings must describe the same owner. */
export const resolveAdjustmentContext = (document: ImageDocument | null, documentAdjustments: BasicAdjustments,
  requestedTarget: PropertiesInspectorTarget) => {
  if (!document) return null;
  const target = reconcilePropertiesTarget(document, requestedTarget);
  const source = resolveAdjustmentPresentationSource(document, documentAdjustments, target);
  if (!source) return null;
  const layer = 'layerId' in target ? findDocumentLayer(document, target.layerId) : null;
  const attachment = target.kind === 'attached-processing' && layer?.type === 'raster'
    ? layer.attachedAdjustments?.find(item => item.id === target.adjustmentId) ?? null : null;
  const ownerId = target.kind === 'document-processing' ? null
    : target.kind === 'attached-processing' ? attachedAdjustmentOwnerId(target.layerId, target.adjustmentId)
      : layer?.id ?? null;
  return {
    target, identity: JSON.stringify(target), ownerId, layer, attachment, source,
    stack: source.kind === 'stack' ? source.source as AdjustmentStack : null,
    // Materialization is deliberately lazy; identity reads do not clone settings.
    readAdjustments: () => materializeAdjustmentPresentationSource(source).adjustments
  };
};

export type AdjustmentContext = NonNullable<ReturnType<typeof resolveAdjustmentContext>>;
