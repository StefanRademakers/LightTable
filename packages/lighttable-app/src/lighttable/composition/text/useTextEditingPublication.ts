import { useLayoutEffect, useMemo, useRef } from 'react';
import type { LightTableCommandService } from '../../application/commands/lightTableCommandService';
import type { DocumentMutationController } from '../../application/documents/useDocumentMutationController';
import type { DocumentSession } from '../../application/documents/documentSession';
import { FlowTextEditingSessionController } from '../../application/text/flowTextEditingSession';

interface TextEditingPublicationPorts {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): object | null;
  getProjectedDocumentId(): string | null;
  captureScope(): { isCurrent(): boolean };
  readonly commandService: Pick<LightTableCommandService, 'recordObservedCommand'>;
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
  reportError(message: string): void;
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

/** Captures each admitted edit's command address; presentation retirement never relabels its commit. */
export const useTextEditingPublication = (ports: TextEditingPublicationPorts) => {
  const latest = useRef(ports), mounted = useRef(false), epoch = useRef(0);
  latest.current = ports;
  const controller = useMemo(() => new FlowTextEditingSessionController(() => {
    const opening = latest.current, session = opening.getSession(), renderer = opening.getRenderer();
    const scope = opening.captureScope(), openingEpoch = epoch.current;
    const isCurrent = () => Boolean(renderer) && mounted.current && epoch.current === openingEpoch
      && latest.current.commandService === opening.commandService && latest.current.getSession() === session
      && latest.current.getRenderer() === renderer && session?.getSnapshot().lifecycle === 'ready' && scope.isCurrent();
    return {
      getDocument: () => {
        const snapshot = session?.getSnapshot();
        return isCurrent() && snapshot?.document?.id === opening.getProjectedDocumentId()
          ? snapshot.document : null;
      },
      documentMutations: opening.documentMutations,
      onCommitted: entry => {
        if (session && entry.semanticReplacement) opening.commandService.recordObservedCommand(
          'text.replaceRange', session.id, entry.semanticReplacement, { layerId: entry.layerId });
      },
      reportError: message => {
        if (isCurrent()) opening.reportError(message);
      },
      requestPreviewFrame: opening.requestFrame, cancelPreviewFrame: opening.cancelFrame
    };
  }), []);
  useLayoutEffect(() => {
    mounted.current = true; epoch.current++;
    return () => { mounted.current = false; epoch.current++; };
  }, []);
  return controller;
};
