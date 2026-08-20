import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { WorkspaceSession } from '../workspace/workspaceSession';
import {
  AutomationPublicationEventStore,
  projectAutomationPublicationEvents
} from './automationPublicationEventStore';

describe('AutomationPublicationEventStore', () => {
  it('reports bounded reconnect gaps and deterministic pagination', () => {
    const store = new AutomationPublicationEventStore(3);
    for (let revision = 1; revision <= 4; revision += 1) {
      store.append({ kind: 'document-revision-changed', documentId: 'document-1' as never,
        detail: { canonicalRevision: revision } });
    }
    const first = store.query(0, 2);
    expect(first).toMatchObject({ gap: true, oldestCursor: 2, latestCursor: 4,
      cursor: 3, hasMore: true });
    expect(first.events.map(({ cursor }) => cursor)).toEqual([2, 3]);
    expect(store.query(first.cursor, 2)).toMatchObject({ gap: false, hasMore: false,
      cursor: 4, events: [{ cursor: 4 }] });
    expect(new AutomationPublicationEventStore().query(99, 20)).toMatchObject({
      gap: true, cursor: 0, latestCursor: 0, oldestCursor: 1, events: []
    });
  });

  it('waits without polling and resolves one bounded batch from the reconnect cursor', async () => {
    const store = new AutomationPublicationEventStore();
    const waiting = store.wait(0, 20, 1_000);
    store.appendAll([
      { kind: 'document-revision-changed', documentId: 'document-1' as never,
        detail: { canonicalRevision: 2 } },
      { kind: 'history-changed', documentId: 'document-1' as never,
        detail: { stateId: 2 } }
    ]);
    await expect(waiting).resolves.toMatchObject({
      timedOut: false,
      cursor: 2,
      latestCursor: 2,
      gap: false,
      events: [
        { cursor: 1, kind: 'document-revision-changed' },
        { cursor: 2, kind: 'history-changed' }
      ]
    });
    store.dispose();
  });

  it('returns queued events immediately and bounds idle waits and disposal', async () => {
    const store = new AutomationPublicationEventStore();
    store.append({ kind: 'document-opened', documentId: 'document-1' as never, detail: {} });
    await expect(store.wait(0, 20, 10_000)).resolves.toMatchObject({
      timedOut: false, cursor: 1, events: [{ cursor: 1 }]
    });
    await expect(store.wait(1, 20, 0)).resolves.toMatchObject({
      timedOut: true, cursor: 1, events: []
    });
    const disposed = store.wait(1, 20, 10_000);
    store.dispose();
    await expect(disposed).resolves.toMatchObject({ timedOut: true, cursor: 1, events: [] });
  });

  it('bounds concurrent idle waiters independently of transport limits', async () => {
    const store = new AutomationPublicationEventStore();
    const waiting = Array.from({ length: 64 }, () => store.wait(0, 20, 10_000));
    await expect(store.wait(0, 20, 10_000)).rejects.toThrow('waiter limit');
    store.dispose();
    await expect(Promise.all(waiting)).resolves.toHaveLength(64);
  });

  it('projects compact semantic changes from the existing workspace/session owners', async () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-1' as never });
    let before = workspace.getSnapshot();
    const opened = workspace.open({ source: { id: 'source', name: 'test.png', mediaType: 'image/png' } });
    if (!opened.ok) throw new Error('Document did not open.');
    const session = opened.value;
    let after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after).map(({ kind }) => kind))
      .toEqual(['document-opened', 'active-document-changed']);

    session.setDocument(createRasterLayer(createImageDocument('Event test', 80, 60, 'source')));
    session.setReady();
    before = workspace.getSnapshot();
    session.markChanged(3);
    after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after)).toContainEqual(
      expect.objectContaining({ kind: 'document-revision-changed',
        detail: expect.objectContaining({ canonicalRevision: 3 }) })
    );

    before = after;
    session.updateEditor((current) => ({ ...current, selection: [{ mode: 'replace', shape: {
      kind: 'rectangle', points: [{ x: 1, y: 2 }, { x: 10, y: 20 }]
    } }] }));
    after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after)).toContainEqual(
      expect.objectContaining({ kind: 'selection-changed', detail: {
        rasterOperationCount: 1, vectorElementCount: 0, vectorPathCount: 0,
        vectorAnchorCount: 0, hasActiveVectorTarget: false
      } })
    );

    before = after;
    session.history.record({ id: 'history-1', documentId: session.id,
      type: 'test', label: 'Semantic edit', undo: () => undefined, redo: () => undefined });
    after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after)).toContainEqual(
      expect.objectContaining({ kind: 'history-changed',
        detail: expect.objectContaining({ undoDepth: 1 }) })
    );

    before = after;
    const generation = session.renderer.beginStart();
    session.renderer.markReady(generation);
    after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after)).toContainEqual(
      expect.objectContaining({ kind: 'renderer-changed', detail: expect.objectContaining({
        status: 'ready', generation
      }) })
    );

    before = after;
    let finish!: () => void;
    const running = session.tasks.run('analysis', 'Inspect', () =>
      new Promise<void>((resolve) => { finish = resolve; }));
    after = workspace.getSnapshot();
    expect(projectAutomationPublicationEvents(before, after)).toContainEqual(
      expect.objectContaining({ kind: 'tasks-changed',
        detail: expect.objectContaining({ activeCount: 1 }) })
    );
    expect(projectAutomationPublicationEvents(after, after)).toEqual([]);
    finish();
    await running;
    workspace.dispose();
  });
});
