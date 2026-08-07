import type { DocumentSessionId } from '../documents/documentSession';

export interface ReversibleDocumentCommand {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly documentId: DocumentSessionId;
  readonly affectsDocument?: boolean;
  readonly byteSize?: number;
  readonly resourceIds?: readonly string[];
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose?(): void;
}

interface HistoryNode {
  readonly command: ReversibleDocumentCommand;
  readonly beforeStateId: number;
  readonly afterStateId: number;
}

export interface DocumentCommandHistorySnapshot {
  readonly documentId: DocumentSessionId;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly busy: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly estimatedBytes: number;
  readonly currentStateId: number;
  readonly savedStateId: number;
  readonly dirty: boolean;
}

export interface DocumentCommandHistoryOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export type DocumentCommandHistoryListener = (
  snapshot: DocumentCommandHistorySnapshot
) => void;

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

/**
 * Serial, document-scoped reversible command history.
 *
 * GPU resources remain owned by the renderer; commands only hold explicit
 * resource identities and optional release callbacks. This keeps the
 * application layer independent from WebGPU while still allowing bounded GPU
 * history and deterministic cleanup.
 */
export class DocumentCommandHistory {
  readonly documentId: DocumentSessionId;

  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly listeners = new Set<DocumentCommandHistoryListener>();
  private undoNodes: HistoryNode[] = [];
  private redoNodes: HistoryNode[] = [];
  private pendingCommands: ReversibleDocumentCommand[] = [];
  private busy = false;
  private generation = 0;
  private nextStateId = 1;
  private currentStateId = 0;
  private savedStateId = 0;
  private snapshot: DocumentCommandHistorySnapshot;

  constructor(
    documentId: DocumentSessionId,
    options: DocumentCommandHistoryOptions = {}
  ) {
    this.documentId = documentId;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = (): DocumentCommandHistorySnapshot => this.snapshot;

  subscribe = (listener: DocumentCommandHistoryListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  record(command: ReversibleDocumentCommand): void {
    this.assertTarget(command);
    if (this.busy) {
      this.pendingCommands.push(command);
      this.publish();
      return;
    }
    this.append(command);
    this.publish();
  }

  private append(command: ReversibleDocumentCommand): void {
    this.disposeNodes(this.redoNodes);
    this.redoNodes = [];
    const beforeStateId = this.currentStateId;
    const afterStateId = command.affectsDocument === false
      ? beforeStateId
      : this.nextStateId++;
    this.undoNodes.push({ command, beforeStateId, afterStateId });
    this.currentStateId = afterStateId;
    this.enforceBudget();
  }

  async undo(): Promise<boolean> {
    if (this.busy) return false;
    const node = this.undoNodes.pop();
    if (!node) return false;
    const generation = this.generation;
    this.busy = true;
    this.publish();
    try {
      await node.command.undo();
      if (generation !== this.generation) {
        node.command.dispose?.();
        return false;
      }
      this.redoNodes.push(node);
      this.currentStateId = node.beforeStateId;
      return true;
    } catch (reason) {
      if (generation === this.generation) this.undoNodes.push(node);
      else node.command.dispose?.();
      throw reason;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.flushPendingCommands();
        this.publish();
      }
    }
  }

  async redo(): Promise<boolean> {
    if (this.busy) return false;
    const node = this.redoNodes.pop();
    if (!node) return false;
    const generation = this.generation;
    this.busy = true;
    this.publish();
    try {
      await node.command.redo();
      if (generation !== this.generation) {
        node.command.dispose?.();
        return false;
      }
      this.undoNodes.push(node);
      this.currentStateId = node.afterStateId;
      return true;
    } catch (reason) {
      if (generation === this.generation) this.redoNodes.push(node);
      else node.command.dispose?.();
      throw reason;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.flushPendingCommands();
        this.publish();
      }
    }
  }

  markSaved(): void {
    this.savedStateId = this.currentStateId;
    this.publish();
  }

  clear(options: { preserveDirtyState?: boolean } = {}): void {
    const wasDirty = this.snapshot.dirty;
    this.generation += 1;
    this.disposeNodes([...this.undoNodes, ...this.redoNodes]);
    this.pendingCommands.forEach((command) => command.dispose?.());
    this.undoNodes = [];
    this.redoNodes = [];
    this.pendingCommands = [];
    this.busy = false;
    this.currentStateId = options.preserveDirtyState && wasDirty
      ? this.nextStateId++
      : 0;
    this.savedStateId = 0;
    this.publish();
  }

  dispose(): void {
    this.clear();
    this.listeners.clear();
  }

  getRetainedResourceIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const node of [...this.undoNodes, ...this.redoNodes]) {
      node.command.resourceIds?.forEach((id) => ids.add(id));
    }
    this.pendingCommands.forEach((command) => {
      command.resourceIds?.forEach((id) => ids.add(id));
    });
    return ids;
  }

  private flushPendingCommands(): void {
    const pending = this.pendingCommands;
    this.pendingCommands = [];
    pending.forEach((command) => this.append(command));
  }

  private assertTarget(command: ReversibleDocumentCommand): void {
    if (command.documentId !== this.documentId) {
      throw new Error(
        `Command ${command.id} targets ${command.documentId}, not ${this.documentId}.`
      );
    }
  }

  private enforceBudget(): void {
    let byteSize = this.undoNodes.reduce(
      (total, node) => total + (node.command.byteSize ?? 0),
      0
    );
    while (
      this.undoNodes.length > this.maxEntries
      || (byteSize > this.maxBytes && this.undoNodes.length > 1)
    ) {
      const evicted = this.undoNodes.shift();
      if (!evicted) break;
      byteSize -= evicted.command.byteSize ?? 0;
      evicted.command.dispose?.();
    }
  }

  private disposeNodes(nodes: readonly HistoryNode[]): void {
    for (const node of nodes) node.command.dispose?.();
  }

  private buildSnapshot(): DocumentCommandHistorySnapshot {
    const estimatedBytes = [...this.undoNodes, ...this.redoNodes].reduce(
      (total, node) => total + (node.command.byteSize ?? 0),
      0
    ) + this.pendingCommands.reduce(
      (total, command) => total + (command.byteSize ?? 0),
      0
    );
    return {
      documentId: this.documentId,
      canUndo: this.undoNodes.length > 0 && !this.busy,
      canRedo: this.redoNodes.length > 0 && !this.busy,
      busy: this.busy,
      undoDepth: this.undoNodes.length,
      redoDepth: this.redoNodes.length,
      estimatedBytes,
      currentStateId: this.currentStateId,
      savedStateId: this.savedStateId,
      dirty: this.currentStateId !== this.savedStateId
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
