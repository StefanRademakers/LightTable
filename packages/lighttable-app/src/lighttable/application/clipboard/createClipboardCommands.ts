import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import type { Rect } from '../../editor/document/documentTypes';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import type { DocumentSession } from '../documents/documentSession';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandService } from '../commands/lightTableCommandService';
import { commandDocumentTarget } from '../commands/commandRequestScope';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import { ClipboardHostIntents, type ClipboardHostDependencies } from './ClipboardHostIntents';
import { CutPixelsCommand, type CutPixelsDependencies } from './CutPixelsCommand';
import { prepareBrowserClipboardImage } from './browserClipboardImageCodec';

export interface ClipboardCommandPorts {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): object | null;
  captureScope(): { isCurrent(): boolean };
  getPlacementView(): { viewportSize: { width: number; height: number }; imageRect: Rect };
  settleInteraction(): Promise<void>;
  readonly clipboard: LightTableImageClipboard;
  readonly commands: Pick<LightTableCommandService, 'execute' | 'matchingPixelClipboardCopyArtifact'
    | 'registerPixelClipboardArtifact' | 'releaseArtifact'>;
  nextRequestId(documentId: string): string;
  copySelected(selection: readonly SelectionOperation[]): ReturnType<CutPixelsDependencies['copySelected']>;
  readonly fill: CutPixelsDependencies['fill'];
  reportError(message: string): void;
  reportStatus(message: string): void;
}

/** Resolves live composition ports once per request; no render-time session/renderer capture. */
export const createClipboardCommands = (resolve: () => ClipboardCommandPorts) => {
  const captureRequest = () => {
    const ports = resolve();
    const session = ports.getSession();
    const renderer = ports.getRenderer();
    const presentation = ports.captureScope();
    // Lifetime, not admission: the semantic gateway must still be allowed to
    // settle a live gesture whose history reservation temporarily blocks writes.
    const scope = { isCurrent: () => Boolean(session && renderer
      && ports.getSession() === session && ports.getRenderer() === renderer
      && session.getSnapshot().lifecycle === 'ready' && presentation.isCurrent()) };
    const selection = () => {
      if (!session) throw new Error('The clipboard document is unavailable.');
      return new DocumentSelectionStateStore(session).acquire(session.getSnapshot().documentRevision).selection;
    };
    return { ports, session, scope, selection };
  };
  const host = new ClipboardHostIntents((): ClipboardHostDependencies => {
    const { ports, session, scope, selection } = captureRequest();
    return {
      captureScope: () => scope,
      getContext: () => {
        const snapshot = session?.getSnapshot();
        return snapshot?.document ? { document: snapshot.document, selection: selection(),
          channel: snapshot.editor.activeChannel, ...ports.getPlacementView() } : null;
      },
      settleInteraction: ports.settleInteraction,
      clipboard: ports.clipboard,
      prepareImage: prepareBrowserClipboardImage,
      execute: (command, parameters) => {
        if (!session || !scope.isCurrent()) return Promise.resolve({ status: 'rejected',
          message: 'The clipboard target document renderer was retired.' });
        return ports.commands.execute({ protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
          requestId: ports.nextRequestId(session.id), command,
          ...commandDocumentTarget(command, session.id), parameters });
      },
      artifacts: {
        matchingCopy: placement => ports.commands.matchingPixelClipboardCopyArtifact(placement.sourceDocumentId, placement),
        register: file => ports.commands.registerPixelClipboardArtifact(file),
        release: id => ports.commands.releaseArtifact(id)
      },
      reportError: ports.reportError
    };
  });
  const cut = new CutPixelsCommand(() => {
    const { ports, session, scope, selection } = captureRequest();
    return { captureScope: () => scope, settleInteraction: ports.settleInteraction,
      getDocument: () => session?.getSnapshot().document ?? null,
      getSelection: selection,
      copySelected: () => ports.copySelected(selection().provenance),
      fill: ports.fill, reportStatus: ports.reportStatus };
  });
  return { host, cut };
};
