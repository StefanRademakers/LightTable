import { describe, expect, it } from 'vitest';
import type { DocumentSessionId } from './documentSession';
import { OwnedDocumentRuntimeServices } from './useDocumentRuntimeServices';

describe('OwnedDocumentRuntimeServices', () => {
  it('uses one document identity and disposes renderer/task ownership together', () => {
    const services = new OwnedDocumentRuntimeServices(
      'document-1' as DocumentSessionId
    );
    const generation = services.rendererLifecycle.beginStart();
    services.rendererLifecycle.markReady(generation);

    expect(services.history.getSnapshot().documentId).toBe('document-1');
    expect(services.tasks.getSnapshot().documentId).toBe('document-1');
    expect(services.rendererLifecycle.getSnapshot().status).toBe('ready');

    services.dispose();
    expect(services.rendererLifecycle.getSnapshot().status).toBe('disposed');
  });
});
