import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import { DocumentSession, type DocumentSessionId } from '../../documents/documentSession';
import { DocumentSelectionStateStore } from '../selection/DocumentSelectionStateStore';
import {
  publishTransformDocumentSelection,
  TransformSelectionPublicationError
} from './publishTransformDocumentSelection';

const fixture = () => {
  const before = createImageDocument('Before', 12, 10, 'before');
  const after = { ...before, revision: before.revision + 1 };
  const session = new DocumentSession({
    id: 'transform-publication' as DocumentSessionId,
    source: { id: 'source', name: 'image.png', mediaType: 'image/png' }
  });
  session.setDocument(before);
  session.setReady();
  const store = new DocumentSelectionStateStore(session);
  const expectedLease = store.acquire(0);
  const afterMask = SelectionMaskSnapshot.inactive(12, 10);
  let projectedDocument = before;
  const applyDocumentSnapshot = vi.fn((document: typeof before) => {
    projectedDocument = document;
  });
  const publishEditorProjection = vi.fn();
  return {
    before,
    after,
    session,
    store,
    expectedLease,
    afterMask,
    applyDocumentSnapshot,
    publishEditorProjection,
    projectedDocument: () => projectedDocument
  };
};

describe('publishTransformDocumentSelection', () => {
  it('reverts pixels synchronously before projecting old dimensions on publication failure', () => {
    const state = fixture();
    let pixelSide = 'before';
    const order: string[] = [];
    expect(() => publishTransformDocumentSelection({
      session: state.session, document: state.after, selection: [],
      coverage: state.afterMask, expectedLease: state.expectedLease,
      bindingIsCurrent: () => true, rendererIsAddressable: () => true,
      publishPixels: () => {
        expect(state.session.getSnapshot().document).toBe(state.after);
        pixelSide = 'after'; order.push('pixels-after');
        return () => { pixelSide = 'before'; order.push('pixels-before'); };
      },
      getProjectedDocument: state.projectedDocument,
      applyDocumentSnapshot: (document) => {
        expect(pixelSide).toBe(document === state.after ? 'after' : 'before');
        order.push(document === state.after ? 'project-after' : 'project-before');
        state.applyDocumentSnapshot(document);
      },
      publishEditorProjection: () => { throw new Error('projection failed'); }
    })).toThrow('projection failed');
    expect(order).toEqual(['pixels-after', 'project-after', 'pixels-before', 'project-before']);
    expect(state.session.getSnapshot().document).toBe(state.before);
  });

  it('publishes successfully when the production opening predicate becomes stale after CAS', () => {
    const state = fixture();
    const openingIsCurrent = () => {
      const lease = state.store.acquire(state.session.getSnapshot().documentRevision);
      return lease.document.sessionId === state.expectedLease.document.sessionId
        && lease.document.revision === state.expectedLease.document.revision
        && lease.selection.revision === state.expectedLease.selection.revision
        && lease.selection.coverage === state.expectedLease.selection.coverage;
    };

    publishTransformDocumentSelection({
      session: state.session,
      document: state.after,
      selection: [],
      coverage: state.afterMask,
      expectedLease: state.expectedLease,
      bindingIsCurrent: openingIsCurrent,
      publishPixels: () => () => undefined,
      rendererIsAddressable: () => true,
      getProjectedDocument: state.projectedDocument,
      applyDocumentSnapshot: state.applyDocumentSnapshot,
      publishEditorProjection: state.publishEditorProjection
    });

    expect(openingIsCurrent()).toBe(false);
    expect(state.session.getSnapshot().document).toBe(state.after);
    expect(state.projectedDocument()).toBe(state.after);
    expect(state.store.acquire(state.session.getSnapshot().documentRevision).selection.coverage)
      .toBe(state.afterMask);
    expect(state.publishEditorProjection).toHaveBeenCalledOnce();
  });

  it('rejects before CAS when the opening binding is stale', () => {
    const state = fixture();

    expect(() => publishTransformDocumentSelection({
      session: state.session,
      document: state.after,
      selection: [],
      coverage: state.afterMask,
      expectedLease: state.expectedLease,
      bindingIsCurrent: () => false,
      publishPixels: () => () => undefined,
      rendererIsAddressable: () => true,
      getProjectedDocument: state.projectedDocument,
      applyDocumentSnapshot: state.applyDocumentSnapshot,
      publishEditorProjection: state.publishEditorProjection
    })).toThrow('lease is no longer current');

    expect(state.session.getSnapshot().document).toBe(state.before);
    expect(state.store.acquire(0).selection.coverage).toBe(
      state.expectedLease.selection.coverage
    );
    expect(state.applyDocumentSnapshot).not.toHaveBeenCalled();
  });

  it('restores canonical and projected before-state after a post-CAS binding loss', () => {
    const state = fixture();
    let rendererChecks = 0;

    expect(() => publishTransformDocumentSelection({
      session: state.session,
      document: state.after,
      selection: [],
      coverage: state.afterMask,
      expectedLease: state.expectedLease,
      bindingIsCurrent: () => true,
      publishPixels: () => () => undefined,
      rendererIsAddressable: () => ++rendererChecks < 2,
      getProjectedDocument: state.projectedDocument,
      applyDocumentSnapshot: state.applyDocumentSnapshot,
      publishEditorProjection: state.publishEditorProjection
    })).toThrow('renderer changed during projection');

    const restored = state.store.acquire(0);
    expect(state.session.getSnapshot().document).toBe(state.before);
    expect(restored.selection.coverage).toBe(state.expectedLease.selection.coverage);
    expect(restored.selection.revision).not.toBe(state.expectedLease.selection.revision);
    expect(state.projectedDocument()).toBe(state.before);
    expect(state.publishEditorProjection).not.toHaveBeenCalled();
  });

  it('reports an indeterminate phase instead of guessing after rollback rejection', () => {
    const state = fixture();
    const competing = createImageDocument('Competing', 12, 10, 'competing');
    const applyDocumentSnapshot = (document: typeof state.before) => {
      state.applyDocumentSnapshot(document);
      state.session.setDocument(competing);
    };

    let failure: unknown;
    let rendererChecks = 0;
    try {
      publishTransformDocumentSelection({
        session: state.session,
        document: state.after,
        selection: [],
        coverage: state.afterMask,
        expectedLease: state.expectedLease,
        bindingIsCurrent: () => true,
        publishPixels: () => () => undefined,
        rendererIsAddressable: () => ++rendererChecks < 2,
        getProjectedDocument: state.projectedDocument,
        applyDocumentSnapshot,
        publishEditorProjection: state.publishEditorProjection
      });
    } catch (reason) {
      failure = reason;
    }

    expect(failure).toBeInstanceOf(TransformSelectionPublicationError);
    expect((failure as TransformSelectionPublicationError).phase).toBe('indeterminate');
    expect(state.session.getSnapshot().document).toBe(competing);
  });
});
