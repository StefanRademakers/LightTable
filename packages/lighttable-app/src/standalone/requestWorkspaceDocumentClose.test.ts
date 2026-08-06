import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import { requestWorkspaceDocumentClose } from './requestWorkspaceDocumentClose';

const documentId = 'document-a' as DocumentSessionId;

describe('requestWorkspaceDocumentClose', () => {
  it('closes a clean document without confirmation', async () => {
    const confirmDiscardChanges = vi.fn();
    const close = vi.fn(() => ({ ok: true as const }));

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Clean', dirty: false }],
      host: { confirmDiscardChanges },
      close
    })).resolves.toBe(true);

    expect(confirmDiscardChanges).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(documentId, false);
  });

  it('keeps a dirty document open when discard is rejected', async () => {
    const confirmDiscardChanges = vi.fn(async () => false);
    const close = vi.fn(() => ({ ok: true as const }));

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: { confirmDiscardChanges },
      close
    })).resolves.toBe(false);

    expect(confirmDiscardChanges).toHaveBeenCalledWith('Dirty');
    expect(close).not.toHaveBeenCalled();
  });

  it('closes a dirty document with explicit discard permission', async () => {
    const confirmDiscardChanges = vi.fn(async () => true);
    const close = vi.fn(() => ({ ok: true as const }));
    const remove = vi.fn(async () => undefined);

    await expect(requestWorkspaceDocumentClose({
      documentId,
      documents: [{ id: documentId, title: 'Dirty', dirty: true }],
      host: {
        confirmDiscardChanges,
        recovery: {
          remove,
          removeRecord: vi.fn(),
          write: vi.fn(),
          list: vi.fn(),
          read: vi.fn()
        }
      },
      close
    })).resolves.toBe(true);

    expect(close).toHaveBeenCalledWith(documentId, true);
    expect(remove).toHaveBeenCalledWith(documentId);
  });
});
