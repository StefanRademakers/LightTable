import {
  SelectionMutationCoordinator,
  type DocumentAddress,
  type DocumentRevision,
  type DocumentSessionId as KernelDocumentSessionId,
  type PreparedSelectionProjection,
  type SelectionHistoryChange,
  type SelectionProjectionPort,
  type TransactionId,
} from '@lighttable/editor-kernel';
import type { DocumentSession } from '../../documents/documentSession';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { SelectionShapeProjectionIntent } from '../../../editor/rendering/SelectionShapeProjectionService';
import {
  DocumentSelectionStateStore,
  type LightTableCommittedSelection,
} from './DocumentSelectionStateStore';

export interface SelectionProjectionCommandPort {
  setCommittedSelectionProjection(operations: readonly SelectionOperation[]): void;
  prepareSelectionShapeProjection(
    document: DocumentAddress,
    baseline: LightTableCommittedSelection,
    intent: SelectionShapeProjectionIntent,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>>;
  prepareSelectionSnapshotProjection(
    document: DocumentAddress,
    baseline: LightTableCommittedSelection,
    target: LightTableCommittedSelection,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>>;
}

const transactionId = (): TransactionId => (
  `selection-${crypto.randomUUID()}` as TransactionId
);

/** Application adapter for the kernel-owned selection shape transaction. */
export class SelectionShapeCommandService {
  private readonly state: DocumentSelectionStateStore;

  constructor(
    private readonly session: DocumentSession,
    private readonly resolveRenderer: () => SelectionProjectionCommandPort | null,
    private readonly isCurrentPresentation: () => boolean = () => true,
  ) {
    this.state = new DocumentSelectionStateStore(session);
  }

  async execute(
    intent: SelectionShapeProjectionIntent,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<boolean> {
    const address = this.address();
    const renderer = this.resolveRenderer();
    if (!address || !renderer) return false;
    const projection: SelectionProjectionPort<
      SelectionShapeProjectionIntent,
      SelectionMaskSnapshot,
      SelectionOperation
    > = {
      prepare: async (document, baseline, nextIntent, id, nextSignal) => {
        const next = await renderer.prepareSelectionShapeProjection(
          document, baseline, nextIntent, id, nextSignal,
        );
        if (!this.matchesAddress(document)) {
          next.dispose();
          throw new Error('The selection presentation changed while preparing the commit.');
        }
        return this.withOverlayProjection(next, renderer, baseline.provenance);
      },
      presentPreview: () => undefined,
      clearPreview: () => undefined,
    };
    const coordinator = new SelectionMutationCoordinator({
      state: this.state,
      projection,
      history: { reserve: (change) => this.reserveHistory(change) },
      publication: { run: (operation) => this.session.runPublication(operation) },
    });
    const result = await coordinator.execute({
      target: address,
      intent,
      transactionId: transactionId(),
      signal,
    });
    if (!result.ok && this.matchesAddress(address)) {
      await this.restoreCommittedProjection(address, renderer).catch(() => undefined);
    }
    return result.ok;
  }

  private async restoreCommittedProjection(
    address: DocumentAddress,
    renderer: SelectionProjectionCommandPort,
  ): Promise<void> {
    const committed = this.state.read(address.sessionId);
    const prepared = await renderer.prepareSelectionSnapshotProjection(
      address, committed, committed, transactionId(), new AbortController().signal,
    );
    const projected = this.withOverlayProjection(
      prepared, renderer, committed.provenance,
    );
    const activation = projected.activate();
    activation.accept();
  }

  private reserveHistory(
    change: SelectionHistoryChange<SelectionMaskSnapshot, SelectionOperation>,
  ) {
    return this.session.history.reserve({
      id: String(change.transactionId),
      type: `selection.${change.after.provenance.at(-1)?.mode ?? 'replace'}`,
      label: 'Make Selection',
      documentId: this.session.id,
      affectsDocument: false,
      byteSize: change.before.coverage.byteSize + change.after.coverage.byteSize,
      undo: () => this.restore(change.before),
      redo: () => this.restore(change.after),
    });
  }

  private async restore(target: LightTableCommittedSelection): Promise<void> {
    const address = this.address();
    const renderer = this.resolveRenderer();
    if (!address || !renderer) {
      throw new Error('The selection document or renderer is no longer available.');
    }
    const baseline = this.state.read(address.sessionId);
    const prepared = await renderer.prepareSelectionSnapshotProjection(
      address, baseline, target, transactionId(), new AbortController().signal,
    );
    const projected = this.withOverlayProjection(prepared, renderer, baseline.provenance);
    const activation = projected.activate();
    try {
      const published = this.session.runPublication(() => this.state.compareAndSwap(
        prepared.baselineRevision, prepared.result,
      ));
      if (!published) {
        throw new Error('The selection changed while history was restoring it.');
      }
      activation.accept();
    } catch (reason) {
      try { activation.rollback(); } catch { /* retain original failure */ }
      throw reason;
    }
  }

  private withOverlayProjection(
    prepared: PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation>,
    renderer: SelectionProjectionCommandPort,
    before: readonly SelectionOperation[],
  ): PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation> {
    return {
      transactionId: prepared.transactionId,
      baselineRevision: prepared.baselineRevision,
      result: prepared.result,
      activate: () => {
        const activation = prepared.activate();
        renderer.setCommittedSelectionProjection(prepared.result.provenance);
        return {
          accept: () => activation.accept(),
          rollback: () => {
            activation.rollback();
            renderer.setCommittedSelectionProjection(before);
          },
        };
      },
      dispose: () => prepared.dispose(),
    };
  }

  private address(): DocumentAddress | null {
    if (!this.isCurrentPresentation()) return null;
    const snapshot = this.session.getSnapshot();
    if (!snapshot.document || snapshot.lifecycle === 'closing'
      || snapshot.lifecycle === 'disposed') return null;
    return {
      sessionId: this.session.id as unknown as KernelDocumentSessionId,
      revision: snapshot.documentRevision as DocumentRevision,
    };
  }

  private matchesAddress(address: DocumentAddress): boolean {
    const current = this.address();
    return current?.sessionId === address.sessionId && current.revision === address.revision;
  }
}
