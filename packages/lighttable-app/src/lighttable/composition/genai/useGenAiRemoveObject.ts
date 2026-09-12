import { useLayoutEffect, useMemo, useRef } from 'react';
import type { GenAiProviderId } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../../platform/LightTableHost';
import type { DocumentSession } from '../../application/documents/documentSession';
import type { DocumentFileIntents } from '../../application/documents/DocumentFileIntents';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { encodeRgba8Png, halfFloatSelectionMaskToRgba8 } from '../../gpu/gpuReadback';
import { GenAiRemoveObjectIntent } from '../../application/genai/GenAiRemoveObjectIntent';
import { captureRemoveObjectSource } from '../../application/genai/RemoveObjectSourceCapture';

interface RemoveObjectBinding {
  service: LightTableGenAiService | undefined;
  projectId: string | undefined;
  preferredProviderIds: readonly GenAiProviderId[];
  documentName: string;
  fileIntents: Pick<DocumentFileIntents, 'prepareForUi'>;
  getSession(): DocumentSession | undefined;
  getRenderer(): DocumentRendererPort | null;
  getDocument(): ImageDocument | null;
  captureScope(): { isCurrent(): boolean };
  hasActiveMutation(): boolean;
  projectProcessing(renderer: DocumentRendererPort): void;
  status(message: string | null): void;
  error(message: string | null): void;
}

export const useGenAiRemoveObject = (binding: RemoveObjectBinding) => {
  const latest = useRef(binding); latest.current = binding;
  const owner = useMemo(() => new GenAiRemoveObjectIntent({
    status: message => latest.current.status(message), error: message => latest.current.error(message),
    capture: () => {
      const opening = latest.current, { service, projectId } = opening;
      const session = opening.getSession(), renderer = opening.getRenderer();
      const state = session?.getSnapshot();
      if (!service || !projectId || !session || !renderer || state?.lifecycle !== 'ready'
        || !state.document || opening.getDocument()?.id !== state.document.id) {
        throw new Error('Open a project and a ready document before using Remove Object.');
      }
      if (!state.editor.selectionMaskSnapshot?.active || !state.editor.selectionSupportBounds) {
        throw new Error('Select a non-empty area before using Remove Object.');
      }
      const scope = opening.captureScope();
      const isCurrent = () => latest.current.service === service && latest.current.projectId === projectId
        && latest.current.getSession() === session && latest.current.getRenderer() === renderer
        && session.getSnapshot().lifecycle === 'ready' && scope.isCurrent();
      return { service, projectId, preferredProviderIds: [...opening.preferredProviderIds], isCurrent,
        prepareSource: assertCurrent => {
          assertCurrent();
          const current = session.getSnapshot();
          if (current.documentRevision !== state.documentRevision
            || current.editor.selectionRevision !== state.editor.selectionRevision) {
            throw new Error('The Remove Object selection changed during provider discovery.');
          }
          return captureRemoveObjectSource({ session, renderer, projectId, assertCurrent,
            documentName: opening.documentName, fileIntents: opening.fileIntents,
            hasActiveMutation: opening.hasActiveMutation,
            projectProcessing: () => opening.projectProcessing(renderer),
            maskToRgba8: halfFloatSelectionMaskToRgba8, encodePng: encodeRgba8Png });
        } };
    }
  }), []);
  useLayoutEffect(owner.connect, [owner, binding.service, binding.projectId]);
  return owner.run;
};
