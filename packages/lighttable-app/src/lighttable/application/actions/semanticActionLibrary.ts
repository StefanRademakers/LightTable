import { LIGHTTABLE_COMMAND_DEFINITIONS } from '@lighttable/command-contract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';
import { checkActionCommandContracts, type RecordedCommandContract } from './actionCommandContracts';

export const LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY = 'lighttable.actions.v1';
export const LIGHTTABLE_ACTION_LIBRARY_VERSION = 2;
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

type StoredActionStep = Omit<RecordedActionStep, 'contract'> & { readonly contract?: RecordedCommandContract };

const parseStep = (value: unknown, sequence: number): StoredActionStep | null => {
  if (!record(value) || value.sequence !== sequence || !boundedString(value.requestId, 512)
    || !boundedString(value.command, 128) || !commands.has(value.command as never)
    || (value.origin !== 'ui' && value.origin !== 'actions-playback'
      && value.origin !== 'mcp' && value.origin !== 'internal')
    || (value.documentId !== null && !boundedString(value.documentId, 512))
    || (value.outcome !== 'completed' && value.outcome !== 'accepted') || value.replayable !== true
    || !finite(value.startedAt) || !finite(value.durationMs) || value.durationMs < 0
    || (value.note !== null && (typeof value.note !== 'string' || value.note.length > 2_048))) return null;
  try {
    if (jsonBytes(value.parameters) > 256 * 1024 || jsonBytes(value.result) > 256 * 1024) return null;
  } catch { return null; }
  return structuredClone(value) as unknown as StoredActionStep;
};

type ParsedAction = { readonly action: SavedSemanticAction; readonly migrated: boolean }
  | { readonly error: string };

const parseAction = (value: unknown, allowMissingLegacyContract: boolean): ParsedAction => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || !finite(value.createdAt) || !finite(value.updatedAt) || !record(value.recording)) {
    return { error: 'Action metadata is invalid.' };
  }
  const recording = value.recording;
  if (recording.status !== 'stopped' || recording.id !== value.id
    || recording.name !== value.name || !finite(recording.startedAt) || !finite(recording.stoppedAt)
    || !Array.isArray(recording.steps) || recording.steps.length < 1 || recording.steps.length > MAX_STEPS
    || !finite(recording.byteLength) || recording.byteLength < 0 || recording.limitReached !== false) {
    return { error: 'Action recording metadata is invalid.' };
  }
  const steps = recording.steps.map((step, index) => parseStep(step, index + 1));
  if (steps.some((step) => !step)) return { error: 'Action steps are malformed.' };
  const contracts = checkActionCommandContracts(steps as StoredActionStep[], allowMissingLegacyContract);
  if (!contracts.ok) return { error: contracts.message };
  const parsedRecording = recording as unknown as ActionRecordingSnapshot;
  const action: SavedSemanticAction = { id: value.id, name: value.name,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    recording: { ...parsedRecording, steps: contracts.steps } };
  try {
    return jsonBytes(action) <= MAX_ACTION_BYTES
      ? { action, migrated: contracts.migrated }
      : { error: 'Action exceeds the storage boundary.' };
  } catch { return { error: 'Action is not serializable.' }; }
};

const empty = (error: string | null = null): SemanticActionLibrarySnapshot => ({
  actions: [], selectedId: null, error
});
type RestoredLibrary = { readonly snapshot: SemanticActionLibrarySnapshot; readonly migrated: boolean };

export class SemanticActionLibrary {
  private snapshotValue: SemanticActionLibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly readyValue: Promise<void>;

  constructor(private readonly storage?: SemanticActionLibraryStorage) {
    this.snapshotValue = empty();
    try {
      const loaded = storage?.read() ?? null;
      if (loaded instanceof Promise) {
        this.readyValue = loaded.then(async (serialized) => {
          const restored = this.restore(serialized);
          this.publish(restored.snapshot);
          if (restored.migrated) await this.rewriteMigrated(restored.snapshot);
        },
          () => { this.publish(empty('Saved Actions could not be read.')); });
      } else {
        const restored = this.restore(loaded);
        this.snapshotValue = restored.snapshot;
        this.readyValue = restored.migrated
          ? this.rewriteMigrated(restored.snapshot)
          : Promise.resolve();
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
        !replayable || (outcome !== 'completed' && outcome !== 'accepted'))) return null;
    const now = Date.now();
    const id = recording.id ?? `action-${now}`;
    const previous = this.snapshotValue.actions.find((action) => action.id === id);
    const parsed = parseAction({ id, name: normalizedName, createdAt: previous?.createdAt ?? now,
      updatedAt: now, recording: { ...recording, id, name: normalizedName, status: 'stopped',
        limitReached: false } }, false);
    if ('error' in parsed) return null;
    const action = parsed.action;
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

  private restore(serialized: string | null): RestoredLibrary {
    if (!serialized) return { snapshot: empty(), migrated: false };
    if (new TextEncoder().encode(serialized).byteLength > MAX_LIBRARY_BYTES) {
      return { snapshot: empty('Saved Actions exceed the storage boundary.'), migrated: false };
    }
    try {
      const value: unknown = JSON.parse(serialized);
      if (!record(value) || value.format !== 'lighttable-actions'
        || (value.version !== 1 && value.version !== LIGHTTABLE_ACTION_LIBRARY_VERSION)
        || !Array.isArray(value.actions)
        || value.actions.length > MAX_ACTIONS
        || (value.selectedId !== null && typeof value.selectedId !== 'string')) {
        return { snapshot: empty('Saved Actions use an unsupported or invalid format.'), migrated: false };
      }
      const parsed = value.actions.map((action) => parseAction(action, value.version === 1));
      const invalid = parsed.find((action) => 'error' in action);
      if (invalid && 'error' in invalid) {
        return { snapshot: empty(`Saved Actions contain incompatible workflow data: ${invalid.error}`),
          migrated: false };
      }
      const valid = parsed.map((entry) => (entry as Exclude<ParsedAction, { error: string }>).action);
      const selectedId = typeof value.selectedId === 'string'
        && valid.some(({ id }) => id === value.selectedId) ? value.selectedId : valid[0]?.id ?? null;
      return { snapshot: { actions: valid, selectedId, error: null },
        migrated: value.version === 1 || parsed.some((entry) => !('error' in entry) && entry.migrated) };
    } catch { return { snapshot: empty('Saved Actions could not be parsed.'), migrated: false }; }
  }

  private async rewriteMigrated(snapshot: SemanticActionLibrarySnapshot): Promise<void> {
    if (!this.storage) return;
    const serialized = this.serialize(snapshot);
    if (!serialized) {
      this.publish({ ...snapshot, error: 'Migrated Actions exceed the storage boundary.' });
      return;
    }
    try { await this.storage.write(serialized); } catch {
      this.publish({ ...snapshot, error: 'Migrated Actions could not be rewritten.' });
    }
  }

  private serialize(snapshot: SemanticActionLibrarySnapshot): string | null {
    const envelope = { format: 'lighttable-actions', version: LIGHTTABLE_ACTION_LIBRARY_VERSION,
      selectedId: snapshot.selectedId, actions: snapshot.actions };
    try {
      const serialized = JSON.stringify(envelope);
      return new TextEncoder().encode(serialized).byteLength <= MAX_LIBRARY_BYTES ? serialized : null;
    } catch { return null; }
  }

  private async persist(snapshot: SemanticActionLibrarySnapshot): Promise<boolean> {
    const serialized = this.serialize(snapshot);
    if (!serialized) return false;
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
