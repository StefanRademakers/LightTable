import type { AdjustmentQueryTarget } from './adjustmentQuery';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';

/** Exact owner identity for deciding whether a canonical commit may refresh the open panel cache. */
export const adjustmentTargetIsPresented = (
  target: AdjustmentQueryTarget,
  presented: PropertiesInspectorTarget
): boolean => {
  if (target.kind === 'document') {
    return presented.kind === 'document-processing' && presented.owner === target.owner;
  }
  if (target.kind === 'attached') {
    return presented.kind === 'attached-processing'
      && presented.layerId === target.layerId
      && presented.adjustmentId === target.adjustmentId;
  }
  return (presented.kind === 'layer' || presented.kind === 'processing')
    && presented.layerId === target.layerId;
};
