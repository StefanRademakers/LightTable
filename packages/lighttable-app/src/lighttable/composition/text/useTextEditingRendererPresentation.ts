import { useEffect } from 'react';
import type { TextEditingOverlay } from '@lighttable/text-rendering';
import type { LayerId } from '../../editor/document/documentTypes';

export interface TextEditingPresentationRenderer {
  setTextLayerInteraction(layerId: LayerId, active: boolean): void;
  setTextEditingOverlay(overlay: TextEditingOverlay | null, draft?: boolean): void;
}

/** Projects text interaction-only state to the retained renderer. */
export const useTextEditingRendererPresentation = ({
  renderer,
  active,
  editingLayerId,
  editingStatus,
  paragraphDraft
}: {
  readonly renderer: TextEditingPresentationRenderer | null;
  readonly active: boolean;
  readonly editingLayerId: LayerId | null;
  readonly editingStatus: string;
  readonly paragraphDraft: TextEditingOverlay | null;
}): void => {
  useEffect(() => {
    const layerId = editingStatus === 'editing' ? editingLayerId : null;
    if (!layerId) return undefined;
    renderer?.setTextLayerInteraction(layerId, true);
    return () => { renderer?.setTextLayerInteraction(layerId, false); };
  }, [editingLayerId, editingStatus, renderer]);

  useEffect(() => {
    if (editingStatus === 'editing') return undefined;
    if (!renderer || !active || !paragraphDraft) {
      renderer?.setTextEditingOverlay(null);
      return undefined;
    }
    renderer.setTextEditingOverlay(paragraphDraft, true);
    return () => renderer.setTextEditingOverlay(null);
  }, [active, editingStatus, paragraphDraft, renderer]);
};
