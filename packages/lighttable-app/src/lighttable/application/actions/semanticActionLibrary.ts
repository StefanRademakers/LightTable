import { LIGHTTABLE_COMMAND_DEFINITIONS } from '@lighttable/command-contract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';
import { checkActionCommandContracts, type RecordedCommandContract } from './actionCommandContracts';

export const LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY = 'lighttable.actions.v1';
export const LIGHTTABLE_ACTION_LIBRARY_VERSION = 3;
export const LIGHTTABLE_DEFAULT_ACTION_SET_ID = 'action-set-default';
export const LIGHTTABLE_MAX_ACTION_SETS = 16;
const MAX_ACTIONS = 32;
const MAX_ACTION_BYTES = 2 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
const MAX_STEPS = 256;
const commands = new Set(LIGHTTABLE_COMMAND_DEFINITIONS.map(({ id }) => id));

export interface SavedSemanticActionSet {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SavedSemanticAction {
  readonly id: string;
  readonly setId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recording: ActionRecordingSnapshot;
}

export interface SemanticActionLibrarySnapshot {
  readonly sets: readonly SavedSemanticActionSet[];
  readonly selectedSetId: string;
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
const orderedSets = (sets: readonly SavedSemanticActionSet[]): SavedSemanticActionSet[] => [...sets]
  .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
const orderedActions = (actions: readonly SavedSemanticAction[]): SavedSemanticAction[] => [...actions]
  .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
const defaultSet = (): SavedSemanticActionSet => ({
  id: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  name: 'Default Set',
  createdAt: 0,
  updatedAt: 0
});

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

const parseAction = (value: unknown, allowMissingLegacyContract: boolean,
  legacySetId?: string): ParsedAction => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || !finite(value.createdAt) || !finite(value.updatedAt) || !record(value.recording)) {
    return { error: 'Action metadata is invalid.' };
  }
  const setId = legacySetId ?? value.setId;
  if (!boundedString(setId, 255)) return { error: 'Action Set identity is invalid.' };
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
  const action: SavedSemanticAction = { id: value.id, setId, name: value.name,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    recording: { ...parsedRecording, steps: contracts.steps } };
  try {
    return jsonBytes(action) <= MAX_ACTION_BYTES
      ? { action, migrated: contracts.migrated }
      : { error: 'Action exceeds the storage boundary.' };
  } catch { return { error: 'Action is not serializable.' }; }
};

const parseSet = (value: unknown): SavedSemanticActionSet | null => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || !finite(value.createdAt) || !finite(value.updatedAt)) return null;
  return { id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt };
};

const empty = (error: string | null = null): SemanticActionLibrarySnapshot => ({
  sets: [defaultSet()], selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  actions: [], selectedId: null, error
});
type RestoredLibrary = { readonly snapshot: SemanticActionLibrarySnapshot; readonly migrated: boolean };

const nextId = (prefix: string, existing: ReadonlySet<string>): string => {
  const base = `${prefix}-${Date.now()}`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

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
        }, () => { this.publish(empty('Saved Actions could not be read.')); });
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

  async createSet(name: string): Promise<SavedSemanticActionSet | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 255
      || this.snapshotValue.sets.length >= LIGHTTABLE_MAX_ACTION_SETS) return null;
    const now = Date.now();
    const set: SavedSemanticActionSet = {
      id: nextId('action-set', new Set(this.snapshotValue.sets.map(({ id }) => id))),
      name: normalizedName,
      createdAt: now,
      updatedAt: now
    };
    const snapshot = { ...this.snapshotValue, sets: orderedSets([...this.snapshotValue.sets, set]),
      selectedSetId: set.id, selectedId: null, error: null };
    return await this.persist(snapshot) ? set : null;
  }

  async renameSet(id: string, name: string): Promise<SavedSemanticActionSet | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    const existing = this.snapshotValue.sets.find((set) => set.id === id);
    if (!existing || !normalizedName || normalizedName.length > 255) return null;
    const renamed = { ...existing, name: normalizedName, updatedAt: Date.now() };
    const sets = orderedSets(this.snapshotValue.sets.map((set) => set.id === id ? renamed : set));
    return await this.persist({ ...this.snapshotValue, sets, error: null }) ? renamed : null;
  }

  async selectSet(id: string): Promise<SavedSemanticActionSet | null> {
    await this.readyValue;
    const set = this.snapshotValue.sets.find((candidate) => candidate.id === id) ?? null;
    if (!set) return null;
    const selectedId = orderedActions(this.snapshotValue.actions.filter((action) => action.setId === id))[0]?.id
      ?? null;
    return await this.persist({ ...this.snapshotValue, selectedSetId: id, selectedId, error: null })
      ? set : null;
  }

  async deleteSet(id: string): Promise<boolean> {
    await this.readyValue;
    if (this.snapshotValue.sets.length <= 1
      || !this.snapshotValue.sets.some((set) => set.id === id)) return false;
    const sets = this.snapshotValue.sets.filter((set) => set.id !== id);
    const actions = this.snapshotValue.actions.filter((action) => action.setId !== id);
    const selectedSetId = this.snapshotValue.selectedSetId === id
      ? sets[0]!.id : this.snapshotValue.selectedSetId;
    const selectedId = actions.some((action) => action.id === this.snapshotValue.selectedId
      && action.setId === selectedSetId)
      ? this.snapshotValue.selectedId
      : orderedActions(actions.filter((action) => action.setId === selectedSetId))[0]?.id ?? null;
    return this.persist({ sets, selectedSetId, actions, selectedId, error: null });
  }

  async save(recording: ActionRecordingSnapshot, name: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 255 || recording.status !== 'stopped'
      || recording.steps.length < 1 || recording.steps.some(({ replayable, outcome }) =>
        !replayable || (outcome !== 'completed' && outcome !== 'accepted'))) return null;
    const now = Date.now();
    const requestedId = recording.id ?? nextId('action', new Set(this.snapshotValue.actions.map(({ id }) => id)));
    const previous = this.snapshotValue.actions.find((action) => action.id === requestedId
      && action.setId === this.snapshotValue.selectedSetId);
    const id = previous ? requestedId : this.snapshotValue.actions.some((action) => action.id === requestedId)
      ? nextId('action', new Set(this.snapshotValue.actions.map((action) => action.id))) : requestedId;
    const parsed = parseAction({ id, setId: this.snapshotValue.selectedSetId,
      name: normalizedName, createdAt: previous?.createdAt ?? now, updatedAt: now,
      recording: { ...recording, id, name: normalizedName, status: 'stopped', limitReached: false } }, false);
    if ('error' in parsed) return null;
    const action = parsed.action;
    const actions = orderedActions([
      ...this.snapshotValue.actions.filter((candidate) => candidate.id !== id), action
    ]);
    if (actions.length > MAX_ACTIONS) return null;
    return await this.persist({ ...this.snapshotValue, actions, selectedId: id, error: null }) ? action : null;
  }

  async select(id: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const action = this.snapshotValue.actions.find((candidate) => candidate.id === id) ?? null;
    if (!action) return null;
    return await this.persist({ ...this.snapshotValue, selectedSetId: action.setId,
      selectedId: id, error: null }) ? action : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.readyValue;
    if (!this.snapshotValue.actions.some((action) => action.id === id)) return false;
    const actions = this.snapshotValue.actions.filter((action) => action.id !== id);
    return this.persist({ ...this.snapshotValue, actions,
      selectedId: this.snapshotValue.selectedId === id
        ? actions.find((action) => action.setId === this.snapshotValue.selectedSetId)?.id ?? null
        : this.snapshotValue.selectedId,
      error: null });
  }

  private restore(serialized: string | null): RestoredLibrary {
    if (!serialized) return { snapshot: empty(), migrated: false };
    if (new TextEncoder().encode(serialized).byteLength > MAX_LIBRARY_BYTES) {
      return { snapshot: empty('Saved Actions exceed the storage boundary.'), migrated: false };
    }
    try {
      const value: unknown = JSON.parse(serialized);
      if (!record(value) || value.format !== 'lighttable-actions'
        || (value.version !== 1 && value.version !== 2
          && value.version !== LIGHTTABLE_ACTION_LIBRARY_VERSION)
        || !Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS
        || (value.selectedId !== null && typeof value.selectedId !== 'string')) {
        return { snapshot: empty('Saved Actions use an unsupported or invalid format.'), migrated: false };
      }
      const legacy = value.version === 1 || value.version === 2;
      const sets = legacy ? [defaultSet()] : this.restoreSets(value);
      if (!sets) return { snapshot: empty('Saved Actions contain invalid Action Set data.'), migrated: false };
      const setIds = new Set(sets.map(({ id }) => id));
      const parsed = value.actions.map((action) => parseAction(action, value.version === 1,
        legacy ? LIGHTTABLE_DEFAULT_ACTION_SET_ID : undefined));
      const invalid = parsed.find((action) => 'error' in action);
      if (invalid && 'error' in invalid) {
        return { snapshot: empty(`Saved Actions contain incompatible workflow data: ${invalid.error}`),
          migrated: false };
      }
      const actions = orderedActions(parsed.map((entry) =>
        (entry as Exclude<ParsedAction, { error: string }>).action));
      if (new Set(actions.map(({ id }) => id)).size !== actions.length
        || actions.some((action) => !setIds.has(action.setId))) {
        return { snapshot: empty('Saved Actions contain invalid Action Set relationships.'), migrated: false };
      }
      const selectedSetId = legacy ? LIGHTTABLE_DEFAULT_ACTION_SET_ID : value.selectedSetId;
      if (typeof selectedSetId !== 'string' || !setIds.has(selectedSetId)) {
        return { snapshot: empty('Saved Actions contain an invalid selected Action Set.'), migrated: false };
      }
      const selectedId = typeof value.selectedId === 'string'
        && actions.some(({ id, setId }) => id === value.selectedId && setId === selectedSetId)
        ? value.selectedId
        : actions.find((action) => action.setId === selectedSetId)?.id ?? null;
      return { snapshot: { sets, selectedSetId, actions, selectedId, error: null },
        migrated: legacy || parsed.some((entry) => !('error' in entry) && entry.migrated) };
    } catch { return { snapshot: empty('Saved Actions could not be parsed.'), migrated: false }; }
  }

  private restoreSets(value: Record<string, unknown>): SavedSemanticActionSet[] | null {
    if (!Array.isArray(value.sets) || value.sets.length < 1
      || value.sets.length > LIGHTTABLE_MAX_ACTION_SETS) return null;
    const sets = value.sets.map(parseSet);
    if (sets.some((set) => !set)) return null;
    const valid = orderedSets(sets as SavedSemanticActionSet[]);
    return new Set(valid.map(({ id }) => id)).size === valid.length ? valid : null;
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
      selectedSetId: snapshot.selectedSetId, selectedId: snapshot.selectedId,
      sets: snapshot.sets, actions: snapshot.actions };
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
