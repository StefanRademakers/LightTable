import type { ImageDocument } from '../../../editor/document/documentTypes';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import { resolveFaceWarpEligibility } from '../../effects/faceWarp/faceWarpEligibility';
import { applySemanticFaceWarpCommandToDocument } from '../../effects/faceWarp/semanticFaceWarpCommandExecutor';
import { createDefaultFaceWarpParameters, setFaceWarpNodeSettings,
  type FaceWarpParameters, type FaceWarpProtectedFeature } from '../../../effects/faceWarp/faceWarpTypes';
import type { FaceWarpSemanticTarget } from '../../../effects/faceWarp/faceWarpOperations';
import type { FaceWarpInteractionSessionController, FaceWarpPropertyEdit } from './FaceWarpInteractionSessionController';

export interface FaceWarpPropertyInputs {
  readonly document: ImageDocument | null;
  readonly selectedFaceId: string | null;
  readonly target: FaceWarpSemanticTarget;
}

/** Control intent only; the existing interaction controller owns preview and history. */
export class FaceWarpPropertyIntents {
  private edit: { lease: FaceWarpPropertyEdit; target: FaceWarpSemanticTarget } | null = null;
  private gesturePending = false;
  constructor(private readonly controller: Pick<FaceWarpInteractionSessionController, 'beginEdit' | 'changeDocument'>,
    private readonly read: () => FaceWarpPropertyInputs,
    private readonly isCurrent: () => boolean, private readonly setError: (message: string) => void) {}

  begin = () => {
    if (this.edit?.lease.active) return false;
    this.edit = null;
    this.gesturePending = true;
    if (!this.isCurrent()) return false;
    const target = this.resolveTarget();
    if (!target) return false;
    const lease = this.controller.beginEdit({ documentId: target.document.id,
      layerId: target.layerId, faceId: target.faceId });
    if (!lease) return false;
    this.edit = { lease, target: target.target };
    return true;
  };
  commit = () => this.close(true);
  cancel = () => this.close(false);

  parameters = (change: Partial<FaceWarpParameters>) => this.change((document, layerId, faceId, target) =>
    applySemanticFaceWarpCommandToDocument(document, {
      layerId, operation: { kind: 'set-semantic', faceId, target, change }
    }));
  protection = (feature: FaceWarpProtectedFeature, locked: boolean) =>
    this.change((document, layerId, faceId) => applySemanticFaceWarpCommandToDocument(document, {
      layerId, operation: { kind: 'set-protection', faceId, feature, locked }
    }), true);
  reset = () => this.change((document, layerId, faceId) => {
    const eligibility = resolveFaceWarpEligibility(document, layerId);
    if (!eligibility.ok || !eligibility.layer.adjustmentStack) return document;
    const { layer, settings } = eligibility;
    const faces = settings.faces.map(face => face.id === faceId ? {
      ...face, parameters: createDefaultFaceWarpParameters(), featureOverrides: undefined, displacements: []
    } : face);
    return setRasterLayerAdjustmentStack(document, layerId,
      setFaceWarpNodeSettings(layer.adjustmentStack!, { ...settings, faces }));
  }, true);

  private change(mutate: (document: ImageDocument, layerId: NonNullable<ImageDocument['activeLayerId']>,
    faceId: string, target: FaceWarpSemanticTarget) => ImageDocument, discrete = false) {
    if (!this.isCurrent()) return false;
    const edit = this.edit;
    if (edit?.lease.active) return edit.lease.change(document => mutate(document,
      edit.lease.target.layerId, edit.lease.target.faceId, edit.target));
    if (this.gesturePending && !discrete) return false;
    const opening = this.resolveTarget();
    if (!opening) return false;
    const { document, layerId, faceId, target } = opening;
    return this.controller.changeDocument(current => this.isCurrent()
      && current.id === document.id && current.activeLayerId === layerId
      ? mutate(current, layerId, faceId, target) : current);
  }
  private resolveTarget() {
    const { document, selectedFaceId, target } = this.read();
    if (!document?.activeLayerId) return null;
    const eligibility = resolveFaceWarpEligibility(document, document.activeLayerId);
    if (!eligibility.ok) { this.setError(eligibility.reason); return null; }
    const faceId = eligibility.settings.faces.some(face => face.id === selectedFaceId)
      ? selectedFaceId : eligibility.settings.faces[0]?.id;
    if (!faceId) return null;
    const layerId = eligibility.layer.id;
    return { document, layerId, faceId, target };
  }
  private close(commit: boolean) {
    const edit = this.edit;
    this.edit = null;
    this.gesturePending = false;
    if (!edit || !this.isCurrent()) return false;
    return commit ? edit.lease.commit() : edit.lease.cancel();
  }
}
