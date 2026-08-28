import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentTaskRegistry } from './documentTaskRegistry';

const documentId = 'document-a' as DocumentSessionId;

describe('DocumentTaskRegistry', () => {
  it('publishes running progress and a terminal completed state', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const result = await registry.run('open', 'Open image', async (task) => {
      task.reportProgress(0.4);
      return 42;
    });

    expect(result).toEqual({ status: 'completed', value: 42 });
    const state = Object.values(registry.getSnapshot().tasks)[0];
    expect(state).toMatchObject({
      kind: 'open',
      status: 'completed',
      progress: 1,
      error: null
    });
    expect(registry.getSnapshot().activeTaskIds).toEqual([]);
  });

  it('cancels and invalidates the previous task of the same kind', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    let finishFirst: (() => void) | undefined;
    const first = registry.run('open', 'First', async () => {
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      return 'stale';
    });
    const second = registry.run('open', 'Second', async () => 'current');
    finishFirst?.();

    expect(await first).toEqual({ status: 'canceled' });
    expect(await second).toEqual({ status: 'completed', value: 'current' });
  });

  it('captures failures instead of leaving a task running', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const result = await registry.run('save', 'Save', async () => {
      throw new Error('disk full');
    });

    expect(result.status).toBe('failed');
    expect(Object.values(registry.getSnapshot().tasks)[0]).toMatchObject({
      status: 'failed',
      error: 'disk full'
    });
  });

  it('aborts active work on disposal', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const observedAbort = vi.fn();
    const result = registry.run('analysis', 'Analyze', async (task) => {
      task.signal.addEventListener('abort', observedAbort);
      await new Promise((resolve) => task.signal.addEventListener('abort', resolve));
      task.throwIfCanceled();
      return true;
    });

    registry.dispose();
    expect((await result).status).toBe('canceled');
    expect(observedAbort).toHaveBeenCalledOnce();
  });

  it('bounds terminal task history during a long-lived document session', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    for (let index = 0; index < 140; index += 1) {
      await registry.run('export', `Export ${index}`, async () => index, { replace: false });
    }

    const tasks = Object.values(registry.getSnapshot().tasks);
    expect(tasks).toHaveLength(128);
    expect(tasks[0]?.label).toBe('Export 12');
    expect(tasks.at(-1)?.label).toBe('Export 139');
  });
});
