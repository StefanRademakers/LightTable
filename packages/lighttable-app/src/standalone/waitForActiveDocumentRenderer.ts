import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { DocumentRendererLifecycle } from '../lighttable/application/rendering/documentRendererLifecycle';

export interface ActiveDocumentRendererWait {
  readonly lifecycle: DocumentRendererLifecycle;
  readonly activeDocumentId: () => DocumentSessionId | null;
  readonly subscribeActiveDocument: (listener: () => void) => () => void;
  readonly documentId: DocumentSessionId;
  readonly afterGeneration: number;
  readonly timeoutMs?: number;
}

export type ActiveDocumentRendererWaitFailure =
  | 'ownership-lost'
  | 'renderer-failed'
  | 'renderer-disposed'
  | 'timeout';

export class ActiveDocumentRendererWaitError extends Error {
  constructor(
    readonly failure: ActiveDocumentRendererWaitFailure,
    message: string
  ) {
    super(message);
    this.name = 'ActiveDocumentRendererWaitError';
  }
}

/** Resolves only when a newly activated document owns a ready renderer generation. */
export const waitForActiveDocumentRenderer = ({
  lifecycle,
  activeDocumentId,
  subscribeActiveDocument,
  documentId,
  afterGeneration,
  timeoutMs = 60_000
}: ActiveDocumentRendererWait): Promise<void> => new Promise((resolve, reject) => {
  let settled = false;
  let unsubscribeLifecycle: () => void = () => undefined;
  let unsubscribeActiveDocument: () => void = () => undefined;
  const timeout = setTimeout(() => finish(new ActiveDocumentRendererWaitError(
    'timeout',
    'The document renderer did not become ready.'
  )), timeoutMs);
  const finish = (reason?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    unsubscribeLifecycle();
    unsubscribeActiveDocument();
    if (reason) reject(reason);
    else resolve();
  };
  const inspect = () => {
    if (activeDocumentId() !== documentId) {
      finish(new ActiveDocumentRendererWaitError(
        'ownership-lost',
        'The document lost active renderer ownership before becoming ready.'
      ));
      return;
    }
    const state = lifecycle.getSnapshot();
    if (state.status === 'disposed') {
      finish(new ActiveDocumentRendererWaitError(
        'renderer-disposed',
        'The document renderer was disposed before becoming ready.'
      ));
      return;
    }
    if (state.generation <= afterGeneration) return;
    if (state.status === 'ready' && state.active) finish();
    else if (state.status === 'failed') {
      finish(new ActiveDocumentRendererWaitError(
        'renderer-failed',
        state.error ?? 'The document renderer could not become ready.'
      ));
    }
  };
  unsubscribeLifecycle = lifecycle.subscribe(inspect);
  unsubscribeActiveDocument = subscribeActiveDocument(inspect);
  inspect();
});
