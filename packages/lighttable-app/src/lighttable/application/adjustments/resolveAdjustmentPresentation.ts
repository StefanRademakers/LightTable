import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  materializeBasicAdjustments,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import {
  reconcilePropertiesTarget,
  type PropertiesInspectorTarget
} from '../properties/propertiesInspectorTarget';

export interface AdjustmentPresentationProjection {
  readonly adjustments: BasicAdjustments;
  readonly domain: AdjustmentPresentationDomain;
}

export interface AdjustmentPresentationSource {
  readonly key: string;
  readonly source: BasicAdjustments | AdjustmentStack | null;
  readonly domain: AdjustmentPresentationDomain;
  readonly kind: 'document' | 'stack' | 'empty';
}

/** Lightweight owner resolution used on unrelated document mutations. */
export const resolveAdjustmentPresentationSource = (
  document: ImageDocument,
  documentAdjustments: BasicAdjustments,
  requestedTarget: PropertiesInspectorTarget
): AdjustmentPresentationSource | null => {
  const target = reconcilePropertiesTarget(document, requestedTarget);
  if (target.kind === 'document-processing') return {
    key: `document:${target.owner}`,
    source: documentAdjustments,
    domain: target.owner === 'grade' ? 'grade' : 'lens-fx',
    kind: 'document'
  };
  if (target.kind === 'none' || target.kind === 'mask'
    || target.kind === 'style' || target.kind === 'style-stack') return null;
  const layer = findDocumentLayer(document, target.layerId);
  if (!layer) return null;
  if (target.kind === 'attached-processing') {
    if (layer.type !== 'raster') return null;
    const adjustment = (layer.attachedAdjustments ?? [])
      .find(({ id }) => id === target.adjustmentId);
    return adjustment ? {
      key: `attached:${layer.id}:${adjustment.id}`,
      source: adjustment.adjustmentStack,
      domain: 'all',
      kind: 'stack'
    } : null;
  }
  if (layer.type !== 'adjustment' && layer.type !== 'raster') return null;
  return {
    key: `layer:${layer.id}:${target.kind === 'processing' ? target.owner : 'all'}`,
    source: layer.adjustmentStack,
    domain: target.kind === 'processing' && target.owner === 'lens-fx'
      ? 'lens-fx' : target.kind === 'processing' && target.owner === 'curves'
        ? 'grade' : 'all',
    kind: layer.adjustmentStack ? 'stack' : 'empty'
  };
};

export const materializeAdjustmentPresentationSource = (
  resolved: AdjustmentPresentationSource
): AdjustmentPresentationProjection => ({
  adjustments: resolved.kind === 'document'
    ? cloneAdjustments(resolved.source as BasicAdjustments)
    : resolved.kind === 'stack'
      ? materializeBasicAdjustments(
          resolved.source as AdjustmentStack, undefined, undefined, true
        )
      : createDefaultAdjustments(),
  domain: resolved.domain
});

/**
 * Derives the contextual controls from canonical document owners.
 *
 * Panel state is a presentation cache only: it is never captured by history.
 * Replaying a document snapshot therefore resolves the active inspector owner
 * again instead of restoring whatever values happened to be visible before.
 */
export const resolveAdjustmentPresentation = (
  document: ImageDocument,
  documentAdjustments: BasicAdjustments,
  requestedTarget: PropertiesInspectorTarget
): AdjustmentPresentationProjection | null => {
  const source = resolveAdjustmentPresentationSource(
    document, documentAdjustments, requestedTarget
  );
  return source ? materializeAdjustmentPresentationSource(source) : null;
};
