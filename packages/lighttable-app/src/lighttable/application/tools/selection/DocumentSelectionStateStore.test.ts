import { describe, expect, it } from 'vitest';
import type {
  DocumentSessionId as KernelDocumentSessionId,
  SelectionRevision,
} from '@lighttable/editor-kernel';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import {
  DocumentSession,
  type DocumentSessionId,
} from '../../documents/documentSession';
import { DocumentSelectionStateStore } from './DocumentSelectionStateStore';

const rectangle: SelectionOperation = {
  mode: 'replace',
  shape: { kind: 'rectangle', points: [{ x: 1, y: 2 }, { x: 5, y: 7 }] },
};

const createSession = () => {
  const session = new DocumentSession({
    id: 'document-1' as DocumentSessionId,
    source: { id: 'source-1', name: 'image.png', mediaType: 'image/png' },
  });
  session.setDocument(createImageDocument('image.png', 10, 8, 'asset'));
  session.setReady();
  return session;
};

describe('DocumentSelectionStateStore', () => {
  it('publishes one exact selection value when the expected revision matches', () => {
    const session = createSession();
    const store = new DocumentSelectionStateStore(session);
    const documentSessionId = session.id as unknown as KernelDocumentSessionId;
    const before = store.read(documentSessionId);
    const coverage = SelectionMaskSnapshot.fromRaw(10, 8, new Uint16Array(80));

    expect(store.compareAndSwap(before.revision, {
      documentSessionId,
      revision: 1 as SelectionRevision,
      canvas: { width: 10, height: 8 },
      active: true,
      coverage,
      supportBounds: { x: 1, y: 2, width: 4, height: 5 },
      provenance: [rectangle],
    })).toBe(true);

    expect(store.read(documentSessionId)).toMatchObject({
      revision: 1,
      active: true,
      coverage,
      supportBounds: { x: 1, y: 2, width: 4, height: 5 },
      provenance: [rectangle],
    });
    session.dispose();
  });

  it('rejects stale revisions without publishing partial state', () => {
    const session = createSession();
    const store = new DocumentSelectionStateStore(session);
    const documentSessionId = session.id as unknown as KernelDocumentSessionId;
    const baseline = store.read(documentSessionId);
    const next = {
      ...baseline,
      revision: 1 as SelectionRevision,
      active: true,
      coverage: SelectionMaskSnapshot.fromRaw(10, 8, new Uint16Array(80)),
      supportBounds: { x: 1, y: 2, width: 4, height: 5 },
      provenance: [rectangle],
    };

    expect(store.compareAndSwap(4 as SelectionRevision, next)).toBe(false);
    expect(store.read(documentSessionId)).toEqual(baseline);
    session.dispose();
  });

  it('rejects another document identity and mismatched coverage dimensions', () => {
    const session = createSession();
    const store = new DocumentSelectionStateStore(session);
    const documentSessionId = session.id as unknown as KernelDocumentSessionId;
    const baseline = store.read(documentSessionId);

    expect(() => store.read('document-2' as KernelDocumentSessionId)).toThrow(
      /another document session/i,
    );
    expect(store.compareAndSwap(baseline.revision, {
      ...baseline,
      revision: 1 as SelectionRevision,
      coverage: SelectionMaskSnapshot.inactive(5, 5),
    })).toBe(false);
    expect(store.read(documentSessionId)).toEqual(baseline);
    session.dispose();
  });
});
