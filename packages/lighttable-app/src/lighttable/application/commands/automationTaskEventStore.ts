export type AutomationTaskStatus = 'queued' | 'running' | 'progress' | 'completed' | 'failed' | 'canceled';
export interface AutomationTaskEvent {
  readonly cursor: number; readonly taskId: string; readonly status: AutomationTaskStatus;
  readonly timestamp: number; readonly progress: number | null; readonly operationId: string | null;
  readonly message: string | null;
}

export class AutomationTaskEventStore {
  private cursor = 0;
  private readonly events: AutomationTaskEvent[] = [];
  private readonly listeners = new Set<() => void>();
  constructor(private readonly maximum = 512) {}

  append(taskId: string, status: AutomationTaskStatus, options: {
    progress?: number; operationId?: string; message?: string
  } = {}): AutomationTaskEvent {
    const event: AutomationTaskEvent = { cursor: ++this.cursor, taskId, status,
      timestamp: Date.now(), progress: options.progress ?? null,
      operationId: options.operationId ?? null, message: options.message ?? null };
    this.events.push(event);
    if (this.events.length > this.maximum) this.events.splice(0, this.events.length - this.maximum);
    for (const listener of this.listeners) listener();
    return event;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };
  snapshot = (): number => this.cursor;

  query(afterCursor = 0, limit = 100): { readonly cursor: number; readonly events: readonly AutomationTaskEvent[] } {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    const events = this.events.filter(({ cursor }) => cursor > afterCursor).slice(0, bounded);
    return { cursor: events.at(-1)?.cursor ?? Math.max(afterCursor, this.events[0]?.cursor ? this.events[0].cursor - 1 : 0), events };
  }
}
