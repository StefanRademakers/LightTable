import type { DocumentSession } from '../documents/documentSession';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { InteractionTransitionCoordinator } from './InteractionTransitionCoordinator';

export interface MountedDocumentAdmissionPorts {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): object | null;
  getImageDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  readonly transitions: Pick<InteractionTransitionCoordinator, 'request'>;
  reportFailure(message: string): void;
}

/** Exact mounted-source admission; the transition coordinator remains the only settlement queue. */
export class MountedDocumentAdmission {
  constructor(private readonly ports: MountedDocumentAdmissionPorts) {}
  private capture() {
    const session = this.ports.getSession(), renderer = this.ports.getRenderer();
    const scope = this.ports.captureScope();
    const ownsContext = () => this.ports.getSession() === session && this.ports.getRenderer() === renderer
      && session?.getSnapshot().lifecycle !== 'disposed' && scope.isCurrent();
    const isCurrent = () => {
      const state = session?.getSnapshot();
      return Boolean(session && renderer && state?.document && ownsContext() && state.lifecycle === 'ready'
        && this.ports.getImageDocument()?.id === state.document.id);
    };
    return { isCurrent, ownsContext };
  }
  private async admit(scope: { isCurrent(): boolean }) {
    if (!scope.isCurrent()) return { status: 'rejected' as const, reason: 'The mounted document renderer is unavailable.' };
    const result = await this.ports.transitions.request('commit-before-mutation', scope);
    if (!scope.isCurrent()) return { status: 'rejected' as const, reason: 'The mounted document renderer was retired during admission.' };
    return result;
  }
  /** Result-based boundary for gesture owners; capture occurs synchronously when they request admission. */
  request = () => {
    const scope = this.capture();
    if (!scope.isCurrent() && scope.ownsContext()) this.ports.reportFailure('The mounted document renderer is unavailable.');
    return this.admit(scope);
  };
  /** Strict prerequisite: callers must not perform successor work after a rejected terminal. */
  settle = async (): Promise<void> => {
    const result = await this.admit(this.capture());
    if (result.status === 'rejected') throw new Error(result.reason);
  };
  /** A retained registered command callback may never adopt the later mounted owner. */
  bindOwner = (session: DocumentSession | null | undefined, renderer: object | null,
    registration: { isCurrent(): boolean }) => async (): Promise<void> => {
    const request = this.capture();
    const result = await this.admit({ isCurrent: () => request.isCurrent() && registration.isCurrent()
      && this.ports.getSession() === session && this.ports.getRenderer() === renderer });
    if (result.status === 'rejected') throw new Error(result.reason);
  };
  /** UI fire-and-forget boundary; coordinator-reported rejection never becomes successor permission. */
  runAfter = (action: () => void | Promise<unknown>): void => {
    const scope = this.capture();
    if (!scope.isCurrent()) {
      if (scope.ownsContext()) this.ports.reportFailure('The mounted document renderer is unavailable.');
      return;
    }
    void this.admit(scope).then(async result => {
      if (result.status === 'admitted' && scope.isCurrent()) await action();
    }).catch(reason => {
      if (scope.isCurrent()) this.ports.reportFailure(reason instanceof Error ? reason.message : String(reason));
    });
  };
}
