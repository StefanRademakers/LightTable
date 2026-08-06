import { describe, expect, it } from 'vitest';
import { AutomationTaskEventStore } from './automationTaskEventStore';

describe('AutomationTaskEventStore', () => {
  it('retains a bounded reconnect-safe cursor window', () => {
    const store = new AutomationTaskEventStore(3);
    store.append('task-1', 'queued');
    const running = store.append('task-1', 'running');
    store.append('task-1', 'progress', { progress: 0.5, operationId: 'shape' });
    store.append('task-1', 'completed', { progress: 1 });
    const page = store.query(running.cursor, 20);
    expect(page.events.map(({ status }) => status)).toEqual(['progress', 'completed']);
    expect(page.events[0]).toMatchObject({ progress: 0.5, operationId: 'shape' });
    expect(page.cursor).toBe(page.events[1].cursor);
  });
});
