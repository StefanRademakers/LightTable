import { describe, expect, it } from 'vitest';
import { DocumentRendererLifecycle } from '../lighttable/application/rendering/documentRendererLifecycle';
import { waitForActiveDocumentRenderer } from './waitForActiveDocumentRenderer';

describe('waitForActiveDocumentRenderer', () => {
  const activeDocumentSubscription = () => () => undefined;

  it('waits for a fresh ready generation owned by the requested document', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    let active = 'document-a' as never;
    const waiting = waitForActiveDocumentRenderer({
      lifecycle, activeDocumentId: () => active,
      subscribeActiveDocument: activeDocumentSubscription,
      documentId: active, afterGeneration: lifecycle.getSnapshot().generation
    });
    const generation = lifecycle.beginStart();
    lifecycle.markReady(generation);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('rejects when the fresh renderer generation belongs to another document', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const waiting = waitForActiveDocumentRenderer({
      lifecycle, activeDocumentId: () => 'document-b' as never,
      subscribeActiveDocument: activeDocumentSubscription,
      documentId: 'document-a' as never, afterGeneration: lifecycle.getSnapshot().generation
    });
    lifecycle.beginStart();
    await expect(waiting).rejects.toThrow(/lost active renderer ownership/i);
  });

  it('rejects the exact failed generation instead of completing its command', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const documentId = 'document-a' as never;
    const waiting = waitForActiveDocumentRenderer({
      lifecycle, activeDocumentId: () => documentId,
      subscribeActiveDocument: activeDocumentSubscription,
      documentId, afterGeneration: lifecycle.getSnapshot().generation
    });
    const generation = lifecycle.beginStart();
    lifecycle.markFailed(generation, 'GPU startup failed.');
    await expect(waiting).rejects.toThrow('GPU startup failed.');
  });

  it('rejects immediately when workspace ownership changes without a renderer event', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    let active = 'document-a' as never;
    let listener: () => void = () => undefined;
    const waiting = waitForActiveDocumentRenderer({
      lifecycle,
      activeDocumentId: () => active,
      subscribeActiveDocument: (next) => {
        listener = next;
        return () => { listener = () => undefined; };
      },
      documentId: active,
      afterGeneration: lifecycle.getSnapshot().generation
    });
    active = 'document-b' as never;
    listener();
    await expect(waiting).rejects.toMatchObject({ failure: 'ownership-lost' });
  });
});
