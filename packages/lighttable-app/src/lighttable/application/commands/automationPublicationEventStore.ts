import type { DocumentSessionId, DocumentSessionSnapshot } from '../documents/documentSession';
import type { WorkspaceSnapshot } from '../workspace/workspaceSession';

export type AutomationPublicationEventKind =
  | 'document-opened' | 'document-closed' | 'active-document-changed'
  | 'document-revision-changed' | 'active-layer-changed' | 'selection-changed'
  | 'history-changed' | 'tasks-changed' | 'renderer-changed';

export interface AutomationPublicationEvent {
  readonly cursor: number;
  readonly timestamp: number;
  readonly kind: AutomationPublicationEventKind;
  readonly documentId: DocumentSessionId | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface AutomationPublicationEventQueryResult {
  readonly cursor: number;
  readonly latestCursor: number;
  readonly oldestCursor: number;
  readonly gap: boolean;
  readonly hasMore: boolean;
  readonly events: readonly AutomationPublicationEvent[];
}

type EventInput = Omit<AutomationPublicationEvent, 'cursor' | 'timestamp'>;

export class AutomationPublicationEventStore {
  private cursor = 0;
  private readonly events: AutomationPublicationEvent[] = [];

  constructor(private readonly maximum = 512) {}

  append(input: EventInput): AutomationPublicationEvent {
    const event = Object.freeze({ ...input, detail: Object.freeze({ ...input.detail }),
      cursor: ++this.cursor, timestamp: Date.now() });
    this.events.push(event);
    if (this.events.length > this.maximum) this.events.splice(0, this.events.length - this.maximum);
    return event;
  }

  appendAll(inputs: readonly EventInput[]): void {
    inputs.forEach((input) => this.append(input));
  }

  query(afterCursor = 0, limit = 100): AutomationPublicationEventQueryResult {
    const boundedAfter = Number.isSafeInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0;
    const boundedLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(200, limit)) : 100;
    const oldestCursor = this.events[0]?.cursor ?? this.cursor + 1;
    const gap = boundedAfter < oldestCursor - 1 || boundedAfter > this.cursor;
    const effectiveAfter = gap ? oldestCursor - 1 : boundedAfter;
    const available = this.events.filter(({ cursor }) => cursor > effectiveAfter);
    const events = available.slice(0, boundedLimit);
    return {
      cursor: events.at(-1)?.cursor ?? effectiveAfter,
      latestCursor: this.cursor,
      oldestCursor,
      gap,
      hasMore: available.length > events.length,
      events
    };
  }
}

const sameRasterSelection = (left: DocumentSessionSnapshot, right: DocumentSessionSnapshot) => (
  left.editor.selection.length === right.editor.selection.length
  && left.editor.selection.every((operation, index) => operation === right.editor.selection[index])
);

const vectorSelectionKey = (snapshot: DocumentSessionSnapshot) => {
  const selection = snapshot.editor.vectorSelection;
  return [
    ...selection.elements.map(({ layerId, elementId }) => `e:${layerId}:${elementId}`),
    ...selection.paths.map(({ layerId, pathId }) => `p:${layerId}:${pathId}`),
    ...selection.anchors.map(({ layerId, pathId, subpathId, anchorId }) =>
      `a:${layerId}:${pathId}:${subpathId}:${anchorId}`),
    selection.active ? `x:${JSON.stringify(selection.active)}` : 'x:'
  ].join('|');
};

const selectionDetail = (snapshot: DocumentSessionSnapshot) => ({
  rasterOperationCount: snapshot.editor.selection.length,
  vectorElementCount: snapshot.editor.vectorSelection.elements.length,
  vectorPathCount: snapshot.editor.vectorSelection.paths.length,
  vectorAnchorCount: snapshot.editor.vectorSelection.anchors.length,
  hasActiveVectorTarget: snapshot.editor.vectorSelection.active !== null
});

const taskKey = (snapshot: DocumentSessionSnapshot) => Object.values(snapshot.tasks.tasks)
  .map(({ id, status, progress }) => `${id}:${status}:${progress ?? ''}`).join('|');

const documentStateDetail = (snapshot: DocumentSessionSnapshot) => ({
  lifecycle: snapshot.lifecycle,
  canonicalRevision: snapshot.documentRevision,
  historyStateId: snapshot.history.currentStateId,
  activeLayerId: snapshot.document?.activeLayerId ?? null
});

/** Produces compact events from authoritative immutable session snapshots. */
export const projectAutomationPublicationEvents = (
  previous: WorkspaceSnapshot,
  current: WorkspaceSnapshot
): readonly EventInput[] => {
  const events: EventInput[] = [];
  const previousIds = new Set(previous.documentOrder);
  const currentIds = new Set(current.documentOrder);
  for (const documentId of current.documentOrder) {
    if (!previousIds.has(documentId)) events.push({ kind: 'document-opened', documentId,
      detail: documentStateDetail(current.documents[documentId]!) });
  }
  for (const documentId of previous.documentOrder) {
    if (!currentIds.has(documentId)) events.push({ kind: 'document-closed', documentId, detail: {} });
  }
  if (previous.activeDocumentId !== current.activeDocumentId) {
    events.push({ kind: 'active-document-changed', documentId: current.activeDocumentId,
      detail: { previousDocumentId: previous.activeDocumentId } });
  }
  for (const documentId of current.documentOrder) {
    const before = previous.documents[documentId];
    const after = current.documents[documentId];
    if (!before || !after) continue;
    if (before.documentRevision !== after.documentRevision) {
      events.push({ kind: 'document-revision-changed', documentId, detail: {
        previousRevision: before.documentRevision, canonicalRevision: after.documentRevision
      } });
    }
    const beforeLayer = before.document?.activeLayerId ?? null;
    const afterLayer = after.document?.activeLayerId ?? null;
    if (beforeLayer !== afterLayer) events.push({ kind: 'active-layer-changed', documentId,
      detail: { previousLayerId: beforeLayer, activeLayerId: afterLayer } });
    if (!sameRasterSelection(before, after)
      || vectorSelectionKey(before) !== vectorSelectionKey(after)) {
      events.push({ kind: 'selection-changed', documentId, detail: selectionDetail(after) });
    }
    if (before.history.currentStateId !== after.history.currentStateId
      || before.history.undoDepth !== after.history.undoDepth
      || before.history.redoDepth !== after.history.redoDepth
      || before.history.busy !== after.history.busy) {
      events.push({ kind: 'history-changed', documentId, detail: {
        stateId: after.history.currentStateId, undoDepth: after.history.undoDepth,
        redoDepth: after.history.redoDepth, busy: after.history.busy
      } });
    }
    if (taskKey(before) !== taskKey(after)) events.push({ kind: 'tasks-changed', documentId,
      detail: { activeCount: after.tasks.activeTaskIds.length,
        activeTaskIds: after.tasks.activeTaskIds.slice(0, 16),
        truncated: after.tasks.activeTaskIds.length > 16 } });
    if (before.renderer.status !== after.renderer.status
      || before.renderer.generation !== after.renderer.generation
      || before.renderer.active !== after.renderer.active) {
      events.push({ kind: 'renderer-changed', documentId, detail: {
        status: after.renderer.status, generation: after.renderer.generation,
        active: after.renderer.active
      } });
    }
  }
  return events;
};
