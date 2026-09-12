import type { DocumentSessionId } from '../documents/documentSession';
import type { LightTableCommandId, LightTableCommandResult } from './lightTableCommandContract';

declare const trackedCommand: unique symbol;
/** Internal identity, never serialized in a public command envelope. */
export interface TrackedTextCreationCommand {
  readonly [trackedCommand]: true;
  readonly result: Promise<LightTableCommandResult>;
}
export interface FileTextCreationPrerequisite {
  consume(command: TrackedTextCreationCommand): Promise<LightTableCommandResult>;
}
interface Entry {
  readonly documentId: DocumentSessionId | undefined;
  readonly command: LightTableCommandId | undefined;
  readonly handle: TrackedTextCreationCommand;
  readonly run: (handle: TrackedTextCreationCommand) => Promise<LightTableCommandResult>;
  readonly resolve: (result: LightTableCommandResult) => void;
  readonly reject: (reason: unknown) => void;
  status: 'queued' | 'running' | 'completed';
  consumed: boolean;
}
const fileCommands = new Set<LightTableCommandId>([
  'file.exportNative', 'file.exportPng', 'file.exportBitmap', 'file.exportPsd', 'file.exportSvg'
]);

/** The single document runner queue. Only a captured text.create may precede its active file parent. */
export class DocumentCommandExecutionQueue {
  private readonly entries = new WeakMap<TrackedTextCreationCommand, Entry>();
  private readonly pending = new Map<DocumentSessionId, Entry[]>();
  private readonly active = new Map<DocumentSessionId, Entry>();

  enqueue(documentId: DocumentSessionId | undefined, command: LightTableCommandId | undefined,
    run: Entry['run']): TrackedTextCreationCommand {
    let resolve!: Entry['resolve'], reject!: Entry['reject'];
    const result = new Promise<LightTableCommandResult>((yes, no) => { resolve = yes; reject = no; });
    const handle = Object.freeze({ result }) as TrackedTextCreationCommand;
    const entry: Entry = { documentId, command, handle, run, resolve, reject, status: 'queued', consumed: false };
    this.entries.set(handle, entry);
    if (!documentId) { void this.run(entry); return handle; }
    const queue = this.pending.get(documentId) ?? []; queue.push(entry); this.pending.set(documentId, queue);
    if (!this.active.has(documentId)) {
      // Install the active entry before yielding; simultaneous callers cannot start another drain.
      this.active.set(documentId, entry); queueMicrotask(() => { void this.drain(documentId); });
    }
    return handle;
  }
  private async run(entry: Entry) {
    entry.status = 'running';
    try { entry.resolve(await entry.run(entry.handle)); }
    catch (reason) { entry.reject(reason); }
    finally { entry.status = 'completed'; }
  }
  private async drain(documentId: DocumentSessionId) {
    const queue = this.pending.get(documentId)!;
    while (queue.length) {
      const next = queue.shift()!; this.active.set(documentId, next); await this.run(next);
    }
    this.active.delete(documentId); this.pending.delete(documentId);
  }
  filePrerequisite(parentHandle: TrackedTextCreationCommand): FileTextCreationPrerequisite | undefined {
    const parent = this.entries.get(parentHandle);
    if (!parent?.command || !fileCommands.has(parent.command)) return undefined;
    return { consume: async childHandle => {
      const child = this.entries.get(childHandle), id = parent.documentId;
      if (parent.consumed || !id || parent.status !== 'running' || this.active.get(id) !== parent
        || !child || child.command !== 'text.create' || child.documentId !== id || child.consumed
        || child.status === 'running') throw new Error('The captured text creation is not an available file prerequisite.');
      parent.consumed = true; child.consumed = true;
      if (child.status === 'queued') {
        const queue = this.pending.get(id)!, index = queue.indexOf(child);
        if (index < 0) throw new Error('The captured text creation no longer owns its queue position.');
        queue.splice(index, 1); await this.run(child);
      }
      return child.handle.result;
    } };
  }
}
