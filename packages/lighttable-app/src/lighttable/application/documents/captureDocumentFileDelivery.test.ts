import { describe, expect, it, vi } from 'vitest';
import { captureDocumentFileDelivery, type DocumentFileDeliverySource } from './captureDocumentFileDelivery';

const fixture = () => {
  let document = { id: 'A', revision: 1 }; let renderer = {}; let generation = 1; let mount = 1;
  const host = vi.fn<NonNullable<DocumentFileDeliverySource['onExportFile']>>(async () => ({ status: 'committed', durability: 'atomic-replace' }));
  const opening: DocumentFileDeliverySource = { taskRegistry: { isDisposed: false }, commandHistory: {},
    getDocument: () => document, getRenderer: () => renderer, getRendererGeneration: () => generation,
    onExportFile: host, setError: vi.fn(), setStatus: vi.fn() };
  let current = opening; const download = vi.fn();
  const delivery = captureDocumentFileDelivery(() => current, () => mount, download);
  const file = new File(['bytes'], 'file.png');
  return { delivery, opening, host, download, file,
    replace: (value: DocumentFileDeliverySource) => { current = value; },
    edit: () => { document = { ...document, revision: document.revision + 1 }; },
    retire: (kind: 'document' | 'renderer' | 'generation' | 'mount' | 'tasks' | 'history') => {
      if (kind === 'document') document = { id: 'B', revision: 1 };
      else if (kind === 'renderer') renderer = {};
      else if (kind === 'generation') generation++;
      else if (kind === 'mount') mount++;
      else if (kind === 'tasks') current = { ...current, taskRegistry: { isDisposed: false } };
      else current = { ...current, commandHistory: {} };
    } };
};

describe('document file host and terminal UI lifetime', () => {
  it('keeps original callbacks across same-owner rerender without retargeting host delivery', async () => {
    const f = fixture(); const successorHost = vi.fn(); const successorError = vi.fn();
    f.replace({ ...f.opening, onExportFile: successorHost, setError: successorError });
    await f.delivery.deliver(f.file); f.delivery.error('Original owner'); f.delivery.status('Saved');
    expect(f.host).toHaveBeenCalledExactlyOnceWith(f.file); expect(successorHost).not.toHaveBeenCalled();
    expect(f.opening.setError).toHaveBeenCalledWith('Original owner'); expect(successorError).not.toHaveBeenCalled();
  });
  it.each(['document', 'renderer', 'generation', 'mount', 'tasks', 'history'] as const)(
    'rejects %s retirement before host delivery and never writes successor notices', async kind => {
      const f = fixture(); f.retire(kind);
      await expect(f.delivery.deliver(f.file)).rejects.toMatchObject({ name: 'AbortError' });
      f.delivery.error('Late error'); f.delivery.status('Late success');
      expect(f.host).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled();
      expect(f.opening.setError).not.toHaveBeenCalled(); expect(f.opening.setStatus).not.toHaveBeenCalled();
    });
  it('keeps same-session saved-revision notices meaningful after a newer canonical edit', () => {
    const f = fixture(); f.edit(); f.delivery.status('Saved revision; newer edits remain unsaved');
    expect(f.opening.setStatus).toHaveBeenCalledWith('Saved revision; newer edits remain unsaved');
  });
  it('does not route a late host failure notice into the next document', async () => {
    const f = fixture(); let resolve!: (value: { status: 'failed'; phase: string; message: string }) => void;
    f.host.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const pending = f.delivery.deliver(f.file).catch(error => f.delivery.error(error.message));
    f.retire('document'); resolve({ status: 'failed', phase: 'write', message: 'Disk full' }); await pending;
    expect(f.opening.setError).not.toHaveBeenCalled();
  });
  it('preserves current host failures and normal cancellation without invoking download', async () => {
    const f = fixture(); f.host.mockResolvedValueOnce({ status: 'failed', phase: 'write', message: 'Disk full' });
    await expect(f.delivery.deliver(f.file)).rejects.toThrow('Disk full');
    f.host.mockResolvedValueOnce({ status: 'canceled' });
    await expect(f.delivery.deliver(f.file)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.download).not.toHaveBeenCalled();
  });
});
