import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableRecoveryStore } from '../platform/LightTableRecoveryStore';
import { discardDocumentRecovery } from './discardDocumentRecovery';

const documentId = 'document-current' as DocumentSessionId;
const store = (): LightTableRecoveryStore => ({
  write: vi.fn(),
  remove: vi.fn(async () => undefined),
  removeRecord: vi.fn(async () => undefined),
  list: vi.fn(),
  read: vi.fn()
});

describe('discardDocumentRecovery', () => {
  it('removes an ordinary journal by current document ID', async () => {
    const recovery = store();
    await discardDocumentRecovery(recovery, documentId, undefined, 17);
    expect(recovery.remove).toHaveBeenCalledWith(documentId, 17);
    expect(recovery.removeRecord).not.toHaveBeenCalled();
  });

  it('removes a recovered copy by its original recovery ID', async () => {
    const recovery = store();
    await discardDocumentRecovery(recovery, documentId, 'recovery-original');
    expect(recovery.removeRecord).toHaveBeenCalledWith('recovery-original');
    expect(recovery.remove).not.toHaveBeenCalled();
  });
});
