import { describe, expect, it } from 'vitest';
import { documentPresentationAvailability } from './documentPresentationAvailability';

describe('documentPresentationAvailability', () => {
  it('accepts an owned ready presentation', () => {
    expect(documentPresentationAvailability({
      documentId: 'a', presentedDocumentId: 'a', residentDocumentId: 'a', rendererStatus: 'ready'
    })).toEqual({ ready: true, resident: true, available: true });
  });

  it('retains an owned frame while presentation is suspended', () => {
    expect(documentPresentationAvailability({
      documentId: 'a', presentedDocumentId: null, residentDocumentId: 'a', rendererStatus: 'suspended'
    })).toEqual({ ready: false, resident: true, available: true });
  });

  it.each(['failed', 'disposed', 'starting', 'idle'] as const)(
    'rejects a stale resident frame when the renderer is %s',
    (rendererStatus) => {
      expect(documentPresentationAvailability({
        documentId: 'a', presentedDocumentId: null, residentDocumentId: 'a', rendererStatus
      }).available).toBe(false);
    }
  );

  it('rejects a resident frame owned by another document', () => {
    expect(documentPresentationAvailability({
      documentId: 'a', presentedDocumentId: null, residentDocumentId: 'b', rendererStatus: 'suspended'
    }).available).toBe(false);
  });

  it('does not accept a presented id without matching resident ownership', () => {
    expect(documentPresentationAvailability({
      documentId: 'a', presentedDocumentId: 'a', residentDocumentId: null, rendererStatus: 'ready'
    })).toEqual({ ready: false, resident: false, available: false });
  });
});
