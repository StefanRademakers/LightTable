import type { DocumentSession } from '../documents/documentSession';

export interface WorkspaceDocumentIntentPorts {
  isMounted(): boolean;
  getActiveDocumentId(): string;
  getSession(): DocumentSession | null | undefined;
  captureScope(): { isCurrent(): boolean };
  readonly text: { finishBeforeTransition(transition: () => void): boolean };
  readonly activateDocument?: (documentId: string) => void;
  readonly closeDocument?: (documentId: string) => void;
  closeEditor(): void;
  reportFailure(message: string): void;
}

/** Text terminal admission only. The host owns recovery barriers, latest activation and close confirmation. */
export class WorkspaceDocumentIntents {
  constructor(private readonly resolve: () => WorkspaceDocumentIntentPorts) {}
  activate = (documentId: string): void => {
    const ports = this.resolve();
    if (!ports.isMounted() || !ports.activateDocument || documentId === ports.getActiveDocumentId()) return;
    this.finishText(ports, () => ports.activateDocument!(documentId), 'Document switch');
  };
  close = (documentId: string): void => {
    const ports = this.resolve();
    if (!ports.isMounted()) return;
    if (documentId !== ports.getActiveDocumentId()) {
      ports.closeDocument?.(documentId);
      return;
    }
    this.finishText(ports, () => ports.closeDocument ? ports.closeDocument(documentId) : ports.closeEditor(), 'Document close');
  };
  private finishText(ports: WorkspaceDocumentIntentPorts, transition: () => void, label: string) {
    const session = ports.getSession(), documentId = ports.getActiveDocumentId(), scope = ports.captureScope();
    // Failed/opening documents can be closed. Readiness is not transition authority.
    const isCurrent = () => ports.isMounted() && ports.getSession() === session
      && ports.getActiveDocumentId() === documentId && session?.getSnapshot().lifecycle !== 'disposed'
      && scope.isCurrent();
    if (!isCurrent()) return;
    try {
      const admitted = ports.text.finishBeforeTransition(() => { if (isCurrent()) transition(); });
      if (!admitted && isCurrent()) ports.reportFailure(`${label} was stopped because the text edit could not be committed.`);
    } catch (reason) {
      if (isCurrent()) ports.reportFailure(reason instanceof Error ? reason.message : String(reason));
    }
  }
}
