import { useLayoutEffect, useMemo, useRef } from 'react';
import type { VectorPath } from '@lighttable/vector-core';
import type { DocumentSession, DocumentSessionId } from '../../application/documents/documentSession';
import type { DocumentMutationController } from '../../application/documents/useDocumentMutationController';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { TextToShapeCommandController } from '../../application/text/TextToShapeCommandController';
import { TextToShapeIntent, type TextToShapeIntentContext, type TextToShapeIntentPorts } from '../../application/text/TextToShapeIntent';

interface Binding {
  readonly lifecycle: object;
  readonly generation: number;
  getSession(): DocumentSession | undefined;
  getRenderer(): { vectorPathsForTextLayer(layerId: LayerId, signal: AbortSignal): Promise<readonly VectorPath[] | null> } | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
  readonly text: TextToShapeIntentContext['text'];
  readonly creation: TextToShapeIntentContext['creation'];
  readonly dialogs: TextToShapeIntentPorts['dialogs'];
  execute(documentId: DocumentSessionId, layerId: LayerId, expectedRevision: number): ReturnType<TextToShapeIntentContext['execute']>;
  status: TextToShapeIntentPorts['status'];
  error: TextToShapeIntentPorts['error'];
}

/** Concrete mounted source lifetime shared by UI confirmation and semantic conversion. */
export const useTextToShape = (binding: Binding) => {
  const latest = useRef(binding); latest.current = binding;
  const mounted = useRef(false), epoch = useRef(0);
  const owners = useMemo(() => {
    const capture = () => {
      const opening = latest.current, session = opening.getSession(), renderer = opening.getRenderer();
      const scope = opening.captureScope(), openingEpoch = epoch.current;
      const isCurrent = () => mounted.current && epoch.current === openingEpoch && session && renderer
        && latest.current.getSession() === session && latest.current.getRenderer() === renderer
        && session.getSnapshot().lifecycle === 'ready' && scope.isCurrent()
        && Boolean(session.getSnapshot().document)
        && latest.current.getProjectedDocument()?.id === session.getSnapshot().document?.id;
      if (!isCurrent()) throw new Error('The document renderer is unavailable for text conversion.');
      return { opening, session: session!, renderer: renderer!, isCurrent: () => Boolean(isCurrent()) };
    };
    const command = new TextToShapeCommandController(() => ({
      getDocument: () => latest.current.getSession()?.getSnapshot().document ?? null,
      documentMutations: latest.current.documentMutations,
      captureSource: () => {
        const source = capture();
        return { isCurrent: source.isCurrent,
          resolveVectorPaths: (layerId, signal) => source.renderer.vectorPathsForTextLayer(layerId, signal) };
      }
    }));
    const intent = new TextToShapeIntent(() => ({
      isMounted: () => mounted.current,
      dialogs: latest.current.dialogs, status: latest.current.status, error: latest.current.error,
      capture: () => {
        const source = capture();
        return { isCurrent: source.isCurrent, getDocument: () => source.session.getSnapshot().document,
          getRevision: () => source.session.getSnapshot().documentRevision,
          text: source.opening.text, creation: source.opening.creation,
          execute: (layerId, revision) => source.opening.execute(source.session.id, layerId, revision) };
      }
    }));
    return { command, intent };
  }, []);
  const session = binding.getSession(), renderer = binding.getRenderer();
  useLayoutEffect(() => {
    mounted.current = true; const openingEpoch = ++epoch.current;
    return () => {
      if (epoch.current !== openingEpoch) return;
      mounted.current = false; epoch.current++; owners.intent.cancel(); owners.command.cancel();
    };
  }, [owners, session, renderer, binding.lifecycle, binding.generation]);
  return owners;
};
