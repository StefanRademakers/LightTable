import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import { DocumentSession } from '../lighttable/application/documents/documentSession';
import { requestWorkspaceDocumentClose } from './requestWorkspaceDocumentClose';

const documentId = 'document-a' as DocumentSessionId;
const closed = (activeDocumentId: DocumentSessionId | null = null) => ({
  ok: true as const,
  value: { activeDocumentId }
});

describe('requestWorkspaceDocumentClose', () => {
  it('closes a clean document without confirmation', async () => {
    const confirmDiscardChanges = vi.fn();
    const close = vi.fn(() => closed());

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Clean', dirty: false }],
      host: { confirmDiscardChanges },
      close
    })).resolves.toEqual({ status: 'closed', activeDocumentId: null });

    expect(confirmDiscardChanges).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(documentId, false);
  });

  it('keeps a dirty document open when discard is rejected', async () => {
    const confirmDiscardChanges = vi.fn(async () => false);
    const close = vi.fn(() => closed());

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: { confirmDiscardChanges },
      close
    })).resolves.toEqual({ status: 'retained' });

    expect(confirmDiscardChanges).toHaveBeenCalledWith('Dirty');
    expect(close).not.toHaveBeenCalled();
  });

  it('closes a dirty document with explicit discard permission', async () => {
    const confirmDiscardChanges = vi.fn(async () => true);
    const close = vi.fn(() => closed('document-b' as DocumentSessionId));
    const discardRecovery = vi.fn(async () => undefined);

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: { confirmDiscardChanges },
      discardRecovery,
      close
    })).resolves.toEqual({
      status: 'closed',
      activeDocumentId: 'document-b'
    });

    expect(close).toHaveBeenCalledWith(documentId, true);
    expect(discardRecovery).toHaveBeenCalledOnce();
  });

  it('pins recovery cleanup to the admitted revision and rejects late edits', async () => {
    const session = new DocumentSession({
      id: documentId,
      source: { id: 'source', name: 'Dirty', mediaType: 'image/webp' }
    });
    session.setReady();
    session.markChanged();
    const discardRecovery = vi.fn(async () => undefined);
    const confirmDiscardChanges = vi.fn(async () => {
      expect(() => session.markChanged()).toThrow(/close is pending/i);
      return true;
    });
    const close = vi.fn(() => closed());

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: { confirmDiscardChanges },
      documentSession: session,
      discardRecovery,
      close
    })).resolves.toEqual({ status: 'closed', activeDocumentId: null });

    expect(discardRecovery).toHaveBeenCalledWith(1);
    expect(close).toHaveBeenCalledWith(documentId, true);
    session.dispose();
  });

  it('keeps the dirty document open when recovery cleanup fails', async () => {
    const close = vi.fn(() => closed());
    const onRecoveryCleanupFailed = vi.fn();

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: { confirmDiscardChanges: vi.fn(async () => true) },
      discardRecovery: async () => { throw new Error('Recovery disk is unavailable.'); },
      onRecoveryCleanupFailed,
      close
    })).resolves.toEqual({ status: 'retained' });

    expect(close).not.toHaveBeenCalled();
    expect(onRecoveryCleanupFailed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Recovery disk is unavailable.' })
    );
  });

  it('waits for an active successful save before closing', async () => {
    const session = new DocumentSession({
      id: documentId,
      source: { id: 'source', name: 'Saving', mediaType: 'image/webp' }
    });
    session.setReady();
    session.markChanged();
    let finishSave: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishSave = resolve; });
    const save = session.tasks.run('save', 'Save document', async () => {
      await gate;
      session.markSaved();
    });
    const close = vi.fn(() => closed());

    const closing = requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Saving', dirty: true }],
      host: { confirmDiscardChanges: vi.fn() },
      documentSession: session,
      close
    });
    expect(close).not.toHaveBeenCalled();

    finishSave();
    await save;
    await expect(closing).resolves.toEqual({ status: 'closed', activeDocumentId: null });
    expect(close).toHaveBeenCalledWith(documentId, false);
    session.dispose();
  });

  it('asks before discarding edits made while an active save completed', async () => {
    const session = new DocumentSession({
      id: documentId,
      source: { id: 'source', name: 'Saving', mediaType: 'image/webp' }
    });
    session.setReady();
    session.markChanged();
    let finishSave: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishSave = resolve; });
    const save = session.tasks.run('save', 'Save document', async () => {
      await gate;
      session.markSaved();
      session.markChanged();
    });
    const confirmDiscardChanges = vi.fn(async () => false);
    const close = vi.fn(() => closed());

    const closing = requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Saving', dirty: true }],
      host: { confirmDiscardChanges },
      documentSession: session,
      close
    });
    finishSave();
    await save;

    await expect(closing).resolves.toEqual({ status: 'retained' });
    expect(confirmDiscardChanges).toHaveBeenCalledWith('Saving');
    expect(close).not.toHaveBeenCalled();
    session.dispose();
  });
});
