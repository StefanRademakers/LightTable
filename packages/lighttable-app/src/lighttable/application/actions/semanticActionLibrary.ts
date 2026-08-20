import { LIGHTTABLE_COMMAND_DEFINITIONS } from '@lighttable/command-contract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';

export const LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY = 'lighttable.actions.v1';
export const LIGHTTABLE_ACTION_LIBRARY_VERSION = 1;
const MAX_ACTIONS = 32;
const MAX_ACTION_BYTES = 2 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
const MAX_STEPS = 256;
const commands = new Set(LIGHTTABLE_COMMAND_DEFINITIONS.map(({ id }) => id));

export interface SavedSemanticAction {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recording: ActionRecordingSnapshot;
}

export interface SemanticActionLibrarySnapshot {
  readonly actions: readonly SavedSemanticAction[];
  readonly selectedId: string | null;
  readonly error: string | null;
}

export interface SemanticActionLibraryStorage {
  read(): string | null | Promise<string | null>;
  write(value: string): void | Promise<void>;
}

export const createLocalStorageActionLibraryStorage = (
  storage: Pick<Storage, 'getItem' | 'setItem'>
): SemanticActionLibraryStorage => ({
  read: () => storage.getItem(LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY),
  write: (value) => storage.setItem(LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY, value)
});

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const boundedString = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum
);
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const parseStep = (value: unknown, sequence: number): RecordedActionStep | null => {
  if (!record(value) || value.sequence !== sequence || !boundedString(value.requestId, 512)
    || !boundedString(value.command, 128) || !commands.has(value.command as never)
    || (value.origin !== 'ui' && value.origin !== 'actions-playback'
      && value.origin !== 'mcp' && value.origin !== 'internal')
    || (value.documentId !== null && !boundedString(value.documentId, 512))
    || value.outcome !== 'completed' || value.replayable !== true
    || !finite(value.startedAt) || !finite(value.durationMs) || value.durationMs < 0
    || (value.note !== null && (typeof value.note !== 'string' || value.note.length > 2_048))) return null;
  try {
    if (jsonBytes(value.parameters) > 256 * 1024 || jsonBytes(value.result) > 256 * 1024) return null;
  } catch { return null; }
  return structuredClone(value) as unknown as RecordedActionStep;
};

const parseAction = (value: unknown): SavedSemanticAction | null => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || !finite(value.createdAt) || !finite(value.updatedAt) || !record(value.recording)) return null;
  const recording = value.recording;
  if (recording.status !== 'stopped' || recording.id !== value.id
    || recording.name !== value.name || !finite(recording.startedAt) || !finite(recording.stoppedAt)
    || !Array.isArray(recording.steps) || recording.steps.length < 1 || recording.steps.length > MAX_STEPS
    || !finite(recording.byteLength) || recording.byteLength < 0 || recording.limitReached !== false) return null;
  const steps = recording.steps.map((step, index) => parseStep(step, index + 1));
  if (steps.some((step) => !step)) return null;
  const parsedRecording = recording as unknown as ActionRecordingSnapshot;
  const action: SavedSemanticAction = { id: value.id, name: value.name,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    recording: { ...parsedRecording, steps: steps as RecordedActionStep[] } };
  try { return jsonBytes(action) <= MAX_ACTION_BYTES ? action : null; } catch { return null; }
};

const empty = (error: string | null = null): SemanticActionLibrarySnapshot => ({
  actions: [], selectedId: null, error
});

export class SemanticActionLibrary {
  private snapshotValue: SemanticActionLibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly readyValue: Promise<void>;

  constructor(private readonly storage?: SemanticActionLibraryStorage) {
    this.snapshotValue = empty();
    try {
      const loaded = storage?.read() ?? null;
      if (loaded instanceof Promise) {
        this.readyValue = loaded.then((serialized) => { this.publish(this.restore(serialized)); },
          () => { this.publish(empty('Saved Actions could not be read.')); });
      } else {
        this.snapshotValue = this.restore(loaded);
        this.readyValue = Promise.resolve();
      }
    } catch {
      this.snapshotValue = empty('Saved Actions could not be read.');
      this.readyValue = Promise.resolve();
    }
  }

  snapshot = (): SemanticActionLibrarySnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };

  ready = (): Promise<void> => this.readyValue;

  async save(recording: ActionRecordingSnapshot, name: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 255 || recording.status !== 'stopped'
      || recording.steps.length < 1 || recording.steps.some(({ replayable, outcome }) =>
        !replayable || outcome !== 'completed')) return null;
    const now = Date.now();
    const id = recording.id ?? `action-${now}`;
    const previous = this.snapshotValue.actions.find((action) => action.id === id);
    const action = parseAction({ id, name: normalizedName, createdAt: previous?.createdAt ?? now,
      updatedAt: now, recording: { ...recording, id, name: normalizedName, status: 'stopped',
        limitReached: false } });
    if (!action) return null;
    const actions = [...this.snapshotValue.actions.filter((candidate) => candidate.id !== id), action]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    if (actions.length > MAX_ACTIONS) return null;
    return await this.persist({ actions, selectedId: id, error: null }) ? action : null;
  }

  async select(id: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const action = this.snapshotValue.actions.find((candidate) => candidate.id === id) ?? null;
    if (!action) return null;
    return await this.persist({ ...this.snapshotValue, selectedId: id, error: null }) ? action : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.readyValue;
    if (!this.snapshotValue.actions.some((action) => action.id === id)) return false;
    const actions = this.snapshotValue.actions.filter((action) => action.id !== id);
    return this.persist({ actions, selectedId: this.snapshotValue.selectedId === id
      ? actions[0]?.id ?? null : this.snapshotValue.selectedId, error: null });
  }

  private restore(serialized: string | null): SemanticActionLibrarySnapshot {
    if (!serialized) return empty();
    if (new TextEncoder().encode(serialized).byteLength > MAX_LIBRARY_BYTES) {
      return empty('Saved Actions exceed the storage boundary.');
    }
    try {
      const value: unknown = JSON.parse(serialized);
      if (!record(value) || value.format !== 'lighttable-actions'
        || value.version !== LIGHTTABLE_ACTION_LIBRARY_VERSION || !Array.isArray(value.actions)
        || value.actions.length > MAX_ACTIONS
        || (value.selectedId !== null && typeof value.selectedId !== 'string')) {
        return empty('Saved Actions use an unsupported or invalid format.');
      }
      const actions = value.actions.map(parseAction);
      if (actions.some((action) => !action)) return empty('Saved Actions contain invalid workflow data.');
      const valid = actions as SavedSemanticAction[];
      const selectedId = typeof value.selectedId === 'string'
        && valid.some(({ id }) => id === value.selectedId) ? value.selectedId : valid[0]?.id ?? null;
      return { actions: valid, selectedId, error: null };
    } catch { return empty('Saved Actions could not be parsed.'); }
  }

  private async persist(snapshot: SemanticActionLibrarySnapshot): Promise<boolean> {
    const envelope = { format: 'lighttable-actions', version: LIGHTTABLE_ACTION_LIBRARY_VERSION,
      selectedId: snapshot.selectedId, actions: snapshot.actions };
    let serialized: string;
    try { serialized = JSON.stringify(envelope); } catch { return false; }
    if (new TextEncoder().encode(serialized).byteLength > MAX_LIBRARY_BYTES) return false;
    try { await this.storage?.write(serialized); } catch {
      this.publish({ ...this.snapshotValue, error: 'Saved Actions could not be written.' });
      return false;
    }
    this.publish(snapshot); return true;
  }

  private publish(snapshot: SemanticActionLibrarySnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener();
  }
}
