import type { ImageDocument } from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import { applyGroupVisibility } from '../adjustments/groupVisibility';
import type { AdjustmentPresentationDomain } from '../adjustments/adjustmentPresentationStore';
import type { AdjustmentPresentationSynchronizer } from '../adjustments/AdjustmentPresentationSynchronizer';
import type { ColorLookupCanonicalProjection } from '../adjustments/commitColorLookupAssetTransaction';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import { createDocumentProjectionController, type DocumentProjectionPort } from './documentProjectionController';

export interface DocumentProjectionBindingPort extends DocumentProjectionPort {
  getPropertiesTarget(): PropertiesInspectorTarget;
  resetActiveAdjustmentPreview(): void;
  readonly presentation: AdjustmentPresentationSynchronizer;
}

/**
 * Mounted projection policy over the existing renderer/document projector.
 * A canonical edit retires only an already-active adjustment preview; a
 * successor slider still waiting for transform admission must survive.
 */
export const createDocumentProjectionBinding = (port: DocumentProjectionBindingPort) => {
  const projection = createDocumentProjectionController(port);
  return {
    ...projection,
    /** History already published the captured session; project only its current mounted view. */
    presentDocumentProcessing: (document: ImageDocument, adjustments: BasicAdjustments): void => {
      port.publishRendererAdjustments(applyGroupVisibility(adjustments, port.getGroupVisibility()));
      port.presentation.synchronize(document, adjustments, port.getPropertiesTarget());
    },
    applyDocumentSnapshot: (document: ImageDocument): void => {
      port.resetActiveAdjustmentPreview();
      projection.applyDocumentSnapshot(document);
      port.presentation.synchronize(document, port.getDocumentAdjustments(), port.getPropertiesTarget());
    },
    applyCanonicalAdjustmentProjection: (canonical: ColorLookupCanonicalProjection,
      domain: AdjustmentPresentationDomain): void => {
      projection.applyProjectedAdjustmentSnapshot({
        ...canonical, editorAdjustments: canonical.documentAdjustments
      }, domain, false);
      if (canonical.document) port.presentation.synchronize(canonical.document,
        canonical.documentAdjustments, port.getPropertiesTarget(), true);
    }
  };
};
