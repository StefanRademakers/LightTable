import { describe, expect, it, vi } from 'vitest';
import { DocumentCommandExecutionQueue, type FileTextCreationPrerequisite, type TrackedTextCreationCommand } from './DocumentCommandExecutionQueue';
import type { DocumentSessionId } from '../documents/documentSession';
import type { LightTableCommandResult } from './lightTableCommandContract';
const a = 'A' as DocumentSessionId, b = 'B' as DocumentSessionId;
const result: LightTableCommandResult = { requestId: 'fixture', status: 'completed', value: {}, revisions: { workspace: 0 } };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const parent = async (queue: DocumentCommandExecutionQueue) => {
  const ready = deferred(), release = deferred(); let capability!: FileTextCreationPrerequisite;
  const handle = queue.enqueue(a, 'file.exportPng', async handle => {
    capability = queue.filePrerequisite(handle)!; ready.resolve(); await release.promise; return result;
  });
  await ready.promise; return { handle, capability, release: release.resolve };
};
describe('single-level file text queue capability', () => {
  it.each(['foreign-queue', 'foreign-document', 'non-text', 'forged'] as const)('rejects %s without consuming its queued mutation', async kind => {
    const queue = new DocumentCommandExecutionQueue(), p = await parent(queue), run = vi.fn(async () => result);
    const otherQueue = kind === 'foreign-queue' ? new DocumentCommandExecutionQueue() : queue;
    const child = kind === 'forged' ? { result: Promise.resolve(result) } as TrackedTextCreationCommand
      : otherQueue.enqueue(kind === 'foreign-document' ? b : a, kind === 'non-text' ? 'layer.createRaster' : 'text.create', run);
    await expect(p.capability.consume(child)).rejects.toThrow('not an available');
    if (kind === 'non-text') expect(run).not.toHaveBeenCalled();
    p.release(); await Promise.all([p.handle.result, child.result]);
  });
  it('consumes one child once across reacquired capability and rejects reentrant child use', async () => {
    const queue = new DocumentCommandExecutionQueue(), p = await parent(queue);
    const run = vi.fn(async () => {
      await expect(p.capability.consume(child)).rejects.toThrow('not an available'); return result;
    });
    const child = queue.enqueue(a, 'text.create', run), second = queue.enqueue(a, 'text.create', async () => result);
    expect(await p.capability.consume(child)).toBe(result);
    await expect(p.capability.consume(child)).rejects.toThrow('not an available');
    await expect(queue.filePrerequisite(p.handle)!.consume(second)).rejects.toThrow('not an available');
    p.release(); await Promise.all([p.handle.result, child.result, second.result]); expect(run).toHaveBeenCalledOnce();
  });
  it('does not grant non-file parents a capability and rejects queued/completed parents', async () => {
    const queue = new DocumentCommandExecutionQueue(), p = await parent(queue);
    const queued = queue.enqueue(a, 'file.exportPng', async () => result);
    const ordinary = queue.enqueue(a, 'layer.createRaster', async () => result);
    const child = queue.enqueue(a, 'text.create', async () => result);
    expect(queue.filePrerequisite(ordinary)).toBeUndefined(); expect(queue.filePrerequisite(child)).toBeUndefined();
    await expect(queue.filePrerequisite(queued)!.consume(child)).rejects.toThrow('not an available');
    p.release(); await Promise.all([p.handle.result, queued.result, ordinary.result, child.result]);
    await expect(p.capability.consume(child)).rejects.toThrow('not an available');
  });
});
