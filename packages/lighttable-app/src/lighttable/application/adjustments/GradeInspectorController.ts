import { adjustmentStackGradeGroupIsEnabled, adjustmentStackHasLocalProcessing,
  adjustmentStackLocalProcessingIsEnabled, type GradeModuleGroup } from '../../processing/adjustmentStack';
import type { LayerPanelController } from '../layers/useLayerPanelController';
import type { GroupVisibility } from './groupVisibility';
import type { AdjustmentContext } from './resolveAdjustmentContext';

export const projectGradeInspector = (context: AdjustmentContext | null, visibility: GroupVisibility) => {
  const usesDocumentVisibility = context?.target.kind === 'document-processing' && context.target.owner === 'grade';
  const stack = context?.stack;
  const layer = context?.layer;
  const masterEnabled = usesDocumentVisibility ? visibility.globalGrade
    : context?.attachment ? context.attachment.enabled
      : layer?.type === 'adjustment' ? layer.visible
        : layer?.type === 'raster' && stack && adjustmentStackHasLocalProcessing(stack, 'grade')
          ? adjustmentStackLocalProcessingIsEnabled(stack, 'grade') : true;
  const sectionVisibility = usesDocumentVisibility ? visibility : { ...visibility };
  if (!usesDocumentVisibility) {
    for (const group of ['light', 'color', 'colorMixer', 'colorGrading', 'blackWhiteMix',
      'look', 'curves', 'effects', 'detail'] as const) {
      Object.assign(sectionVisibility, { [group]: adjustmentStackGradeGroupIsEnabled(stack, group) });
    }
  }
  return { ownerId: context?.ownerId ?? null, usesDocumentVisibility, masterEnabled, sectionVisibility };
};

interface GradeInspectorPorts {
  getContext(): AdjustmentContext | null;
  getVisibility(): GroupVisibility;
  publishVisibility(visibility: GroupVisibility): void;
  layers: Pick<LayerPanelController, 'setVisibility' | 'setLocalGradeEnabled' | 'setAttachedAdjustmentEnabled' | 'setGradeGroupEnabled'>;
}

/** Inspector intent routing only; canonical edits remain semantic layer commands. */
export class GradeInspectorController {
  constructor(private readonly ports: GradeInspectorPorts) {}
  toggleMaster = (): void => {
    const p = this.ports; const context = p.getContext();
    if (!context) return;
    const visibility = p.getVisibility(); const model = projectGradeInspector(context, visibility);
    const enabled = !model.masterEnabled;
    if (model.usesDocumentVisibility) p.publishVisibility({ ...visibility, globalGrade: enabled });
    else if (context.target.kind === 'attached-processing') {
      p.layers.setAttachedAdjustmentEnabled(context.target.layerId, context.target.adjustmentId, enabled);
    } else if (context.layer?.type === 'adjustment') p.layers.setVisibility([context.layer.id], enabled);
    else if (context.layer?.type === 'raster') p.layers.setLocalGradeEnabled(context.layer.id, enabled);
  };
  toggleSection = (group: keyof GroupVisibility): void => {
    const p = this.ports; const context = p.getContext(); const visibility = p.getVisibility();
    if (group === 'globalGrade' || group === 'globalLensFx'
      || (context?.target.kind === 'document-processing' && context.target.owner === 'grade')) {
      p.publishVisibility({ ...visibility, [group]: !visibility[group] });
    } else if (context?.ownerId) {
      const gradeGroup = group as GradeModuleGroup;
      p.layers.setGradeGroupEnabled(context.ownerId, gradeGroup, !adjustmentStackGradeGroupIsEnabled(context.stack, gradeGroup));
    }
  };
}
