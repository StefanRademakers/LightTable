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

  it('supersedes only background removal and leaves unrelated automation running', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    let finishAutomation!: () => void;
    let finishFirstRemoval!: () => void;
    const automation = registry.run('automation', 'Action playback', async () => {
      await new Promise<void>((resolve) => { finishAutomation = resolve; });
      return 'action';
    }, { replace: false });
    const firstRemoval = registry.run('background-removal', 'First removal', async () => {
      await new Promise<void>((resolve) => { finishFirstRemoval = resolve; });
      return 'stale';
    });
    const secondRemoval = registry.run(
      'background-removal', 'Second removal', async () => 'current'
    );

    finishFirstRemoval();
    expect(await firstRemoval).toEqual({ status: 'canceled' });
    expect(await secondRemoval).toEqual({ status: 'completed', value: 'current' });
    expect(registry.getSnapshot().activeTaskIds).toHaveLength(1);
    finishAutomation();
    expect(await automation).toEqual({ status: 'completed', value: 'action' });
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

  it('accepts a definitive operation result after its terminal commit boundary', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    let finish!: () => void;
    const result = registry.run('automation', 'Atomic commit', async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return 'committed';
    }, { replace: false, completionPolicy: 'operation-result' });

    registry.cancelKind('automation');
    finish();

    await expect(result).resolves.toEqual({ status: 'completed', value: 'committed' });
    expect(Object.values(registry.getSnapshot().tasks)).toEqual([
      expect.objectContaining({ label: 'Atomic commit', status: 'completed', progress: 1 }),
    ]);
    expect(registry.getSnapshot().activeTaskIds).toEqual([]);
  });

  it('finishes a terminal-boundary task as canceled when its operation observes abort', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const result = registry.run('automation', 'Cancelable inference', async (task) => {
      await new Promise((resolve) => task.signal.addEventListener('abort', resolve));
      task.throwIfCanceled();
      return 'unreachable';
    }, { replace: false, completionPolicy: 'operation-result' });

    registry.cancelKind('automation');

    await expect(result).resolves.toEqual({ status: 'canceled' });
    expect(Object.values(registry.getSnapshot().tasks)).toEqual([
      expect.objectContaining({ label: 'Cancelable inference', status: 'canceled' }),
    ]);
    expect(registry.getSnapshot().activeTaskIds).toEqual([]);
  });

  it('classifies an operation-owned AbortError as cancellation', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const result = await registry.run('background-removal', 'Switched document', async () => {
      throw new DOMException('The document changed.', 'AbortError');
    }, { completionPolicy: 'operation-result' });

    expect(result).toEqual({ status: 'canceled' });
    expect(Object.values(registry.getSnapshot().tasks)[0]).toMatchObject({
      status: 'canceled', error: null
    });
  });

  it('classifies a document-lifetime AbortError as cancellation', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const result = await registry.run('background-removal', 'Canceled on document switch', async () => {
      throw new DOMException('Document switched.', 'AbortError');
    }, { completionPolicy: 'operation-result' });

    expect(result).toEqual({ status: 'canceled' });
    expect(Object.values(registry.getSnapshot().tasks)[0]).toMatchObject({
      status: 'canceled', error: null
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

  it('refuses new tasks while a document transition owns admission', async () => {
    const registry = new DocumentTaskRegistry(documentId);
    const operation = vi.fn(async () => true);
    const barrier = registry.acquireAdmissionBarrier('Document close is pending.');

    await expect(registry.run('save', 'Raced save', operation)).resolves.toEqual({
      status: 'failed',
      error: expect.objectContaining({ message: 'Document close is pending.' })
    });
    expect(operation).not.toHaveBeenCalled();
    expect(registry.getSnapshot().activeTaskIds).toEqual([]);

    barrier.release();
    await expect(registry.run('save', 'Allowed save', operation)).resolves.toMatchObject({
      status: 'completed',
      value: true
    });
  });
});
