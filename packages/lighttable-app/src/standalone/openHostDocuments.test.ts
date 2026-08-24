import { describe, expect, it, vi } from 'vitest';
import type { LightTableHost } from '../platform/LightTableHost';
import { openHostDocuments } from './openHostDocuments';
import { waitForDocumentOpeningToSettle } from './openHostDocuments';
import { DocumentSession, type DocumentSessionId } from '../lighttable/application/documents/documentSession';

const host = (overrides: Partial<LightTableHost>): LightTableHost => ({
  kind: 'electron',
  confirmDiscardChanges: async () => true,
  save: async () => ({ status: 'canceled' }),
  ...overrides
});

describe('File > Open host selection', () => {
  it('keeps every file returned by a multi-document host picker', async () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.svg')];
    const openFile = vi.fn(async () => files[0]!);
    expect(await openHostDocuments(host({ openFiles: async () => files, openFile })))
      .toEqual(files);
    expect(openFile).not.toHaveBeenCalled();
  });

  it('preserves single-file and cancel behavior for older hosts', async () => {
    const file = new File(['a'], 'a.png');
    expect(await openHostDocuments(host({ openFile: async () => file }))).toEqual([file]);
    expect(await openHostDocuments(host({ openFile: async () => null }))).toEqual([]);
  });

  it('waits for each single-renderer document session to leave opening', async () => {
    const session = new DocumentSession({
      id: 'multi-open' as DocumentSessionId,
      source: { id: 'source', name: 'source.jpg', mediaType: 'image/jpeg' }
    });
    const settled = vi.fn();
    const waiting = waitForDocumentOpeningToSettle(session).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    session.setReady();
    await waiting;
    expect(settled).toHaveBeenCalledOnce();
    session.dispose();
  });
});
