import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';

/** Owns the recovery barrier for transitions away from the active renderer. */
export class DocumentRecoveryTransitionGate {
  private activeDocumentId: DocumentSessionId | null = null;
  private readonly flushers = new Map<DocumentSessionId, () => Promise<void>>();
  private readonly barriers = new Map<symbol, string>();
  private activationRequest = 0;
  private inFlight = 0;
  private revision = 0;
  private transitionTail: Promise<void> = Promise.resolve();
  private readonly idleWaiters = new Set<() => void>();

  setActiveDocument(documentId: DocumentSessionId | null): void {
    this.activeDocumentId = documentId;
  }

  register(documentId: DocumentSessionId, flush: () => Promise<void>): () => void {
    this.flushers.set(documentId, flush);
    return () => {
      if (this.flushers.get(documentId) === flush) this.flushers.delete(documentId);
    };
  }

  async acquireBarrier(reason: string): Promise<() => void> {
    const token = Symbol('recovery-transition-barrier');
    this.barriers.set(token, reason);
    if (this.inFlight > 0) {
      await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
    }
    return () => { this.barriers.delete(token); };
  }

  getRevision(): number {
    return this.revision;
  }

  noteCommittedTransition(): void {
    this.revision += 1;
  }

  async runTransition<Result>(operation: () => Promise<Result> | Result): Promise<Result> {
    return this.enqueueTransition(true, operation);
  }

  /**
   * Serializes terminal cleanup for a document that never became ready.
   * Its journal is deliberately not flushed: recovery export may depend on
   * the failed renderer that this transition exists to retire.
   */
  async runFailedOpenDiscard<Result>(operation: () => Promise<Result> | Result): Promise<Result> {
    return this.enqueueTransition(false, operation);
  }

  private async enqueueTransition<Result>(
    flushActive: boolean,
    operation: () => Promise<Result> | Result
  ): Promise<Result> {
    const blockedReason = this.barriers.values().next().value;
    if (blockedReason) throw new Error(blockedReason);
    const previous = this.transitionTail;
    let releaseTurn!: () => void;
    this.transitionTail = new Promise<void>((resolve) => { releaseTurn = resolve; });
    this.inFlight += 1;
    await previous;
    try {
      if (flushActive) await this.flushActiveJournal();
      return await operation();
    } finally {
      releaseTurn();
      this.inFlight -= 1;
      if (this.inFlight === 0) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }
  }

  async flushActive(): Promise<void> {
    const blockedReason = this.barriers.values().next().value;
    if (blockedReason) throw new Error(blockedReason);
    await this.flushActiveJournal();
  }

  private async flushActiveJournal(): Promise<void> {
    if (!this.activeDocumentId) return;
    await this.flushers.get(this.activeDocumentId)?.();
  }

  async activateLatest(
    documentId: DocumentSessionId,
    activate: (documentId: DocumentSessionId) => void
  ): Promise<boolean> {
    if (documentId === this.activeDocumentId) return true;
    const request = ++this.activationRequest;
    return this.runTransition(() => {
      if (request !== this.activationRequest) return false;
      activate(documentId);
      this.activeDocumentId = documentId;
      this.noteCommittedTransition();
      return true;
    });
  }
}
