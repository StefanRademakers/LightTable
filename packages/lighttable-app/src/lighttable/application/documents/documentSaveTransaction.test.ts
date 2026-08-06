import { describe, expect, it, vi } from 'vitest';
import { executeDocumentSaveTransaction } from './documentSaveTransaction';

const request = (file = new File(['valid'], 'test-lighttable.png')) => ({
  file,
  recipe: null
});

describe('executeDocumentSaveTransaction', () => {
  it('commits only the exact pinned revision', async () => {
    let revision = 7;
    const commit = vi.fn();
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-1',
      documentId: 'document-1',
      revision,
      signal: new AbortController().signal,
      isCurrent: () => revision === 7,
      prepare: async () => request().file,
      buildRequest: (file) => request(file),
      write: async () => ({ status: 'committed', durability: 'atomic-replace' }),
      commit
    });

    expect(outcome).toMatchObject({ status: 'committed', markedClean: true, revision: 7 });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('does not write when edits supersede serialization', async () => {
    let revision = 4;
    const write = vi.fn();
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-2',
      documentId: 'document-1',
      revision,
      signal: new AbortController().signal,
      isCurrent: () => revision === 4,
      prepare: async () => {
        revision = 5;
        return request().file;
      },
      buildRequest: (file) => request(file),
      write,
      commit: vi.fn()
    });

    expect(outcome).toMatchObject({ status: 'canceled', markedClean: false });
    expect(write).not.toHaveBeenCalled();
  });

  it('leaves newer edits dirty when they arrive during host I/O', async () => {
    let revision = 9;
    const commit = vi.fn();
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-3',
      documentId: 'document-1',
      revision,
      signal: new AbortController().signal,
      isCurrent: () => revision === 9,
      prepare: async () => request().file,
      buildRequest: (file) => request(file),
      write: async () => {
        revision = 10;
        return { status: 'committed', durability: 'atomic-replace' };
      },
      commit
    });

    expect(outcome).toMatchObject({ status: 'committed', markedClean: false });
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'canceled' } as const, 'canceled'],
    [{ status: 'failed', phase: 'flush', message: 'disk failed' } as const, 'failed']
  ])('propagates a host %s result without committing', async (hostResult, status) => {
    const commit = vi.fn();
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-4',
      documentId: 'document-1',
      revision: 1,
      signal: new AbortController().signal,
      isCurrent: () => true,
      prepare: async () => request().file,
      buildRequest: (file) => request(file),
      write: async () => hostResult,
      commit
    });
    expect(outcome.status).toBe(status);
    expect(commit).not.toHaveBeenCalled();
  });

  it('publishes the explicit transaction lifecycle', async () => {
    const phases: string[] = [];
    await executeDocumentSaveTransaction({
      id: 'save-5',
      documentId: 'document-1',
      revision: 2,
      signal: new AbortController().signal,
      isCurrent: () => true,
      prepare: async () => request().file,
      buildRequest: (file) => request(file),
      write: async () => ({ status: 'committed', durability: 'download' }),
      commit: vi.fn(),
      publish: ({ phase }) => phases.push(phase)
    });
    expect(phases).toEqual(['preparing', 'prepared', 'writing', 'committed']);
  });

  it('treats cancellation during preparation as a normal canceled result', async () => {
    const controller = new AbortController();
    const write = vi.fn();
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-6',
      documentId: 'document-1',
      revision: 3,
      signal: controller.signal,
      isCurrent: () => true,
      prepare: async () => {
        controller.abort();
        return request().file;
      },
      buildRequest: (file) => request(file),
      write,
      commit: vi.fn()
    });
    expect(outcome.status).toBe('canceled');
    expect(write).not.toHaveBeenCalled();
  });

  it('reports serialization failures as prepare failures', async () => {
    const outcome = await executeDocumentSaveTransaction({
      id: 'save-7',
      documentId: 'document-1',
      revision: 3,
      signal: new AbortController().signal,
      isCurrent: () => true,
      prepare: async () => { throw new Error('serialize exploded'); },
      buildRequest: (file: File) => request(file),
      write: vi.fn(),
      commit: vi.fn()
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      phase: 'prepare',
      message: 'serialize exploded'
    });
  });
});
