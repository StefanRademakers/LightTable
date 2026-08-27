import { LIGHTTABLE_COMMAND_DEFINITIONS } from '@lighttable/command-contract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';
import {
  checkActionCommandContracts,
  type RecordedCommandContract
} from './actionCommandContracts';
import {
  validateActionVariables,
  type ActionVariableDefinition
} from './actionResultBindings';

export const LIGHTTABLE_ACTION_LIBRARY_STORAGE_KEY = 'lighttable.actions';
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
  readonly enabled?: boolean;
}

export interface SavedSemanticAction {
  readonly id: string;
  readonly setId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly enabled?: boolean;
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
const orderedSets = (sets: readonly SavedSemanticActionSet[]): SavedSemanticActionSet[] => [...sets];
const orderedActions = (actions: readonly SavedSemanticAction[]): SavedSemanticAction[] => [...actions];
const defaultSet = (): SavedSemanticActionSet => ({
  id: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  name: 'Default Set',
  createdAt: 0,
  updatedAt: 0,
  enabled: true
});

type StoredActionStep = Omit<RecordedActionStep, 'contract'> & { readonly contract: RecordedCommandContract };

const STEP_KEYS = new Set([
  'sequence', 'requestId', 'origin', 'command', 'contract', 'documentId', 'parameters',
  'outcome', 'result', 'startedAt', 'durationMs', 'replayable', 'note', 'rationale',
  'enabled'
]);
const LIBRARY_KEYS = new Set(['format', 'selectedSetId', 'selectedId', 'sets', 'actions']);
const ACTION_KEYS = new Set(['id', 'setId', 'name', 'createdAt', 'updatedAt', 'enabled', 'recording']);
const RECORDING_KEYS = new Set([
  'status', 'id', 'name', 'startedAt', 'stoppedAt', 'steps', 'variables', 'byteLength', 'limitReached'
]);
const SET_KEYS = new Set(['id', 'name', 'createdAt', 'updatedAt', 'enabled']);

const parseStep = (value: unknown, sequence: number): StoredActionStep | null => {
  if (!record(value) || value.sequence !== sequence || !boundedString(value.requestId, 512)
    || Object.keys(value).some((key) => !STEP_KEYS.has(key))
    || !boundedString(value.command, 128) || !commands.has(value.command as never)
    || (value.origin !== 'ui' && value.origin !== 'actions-playback'
      && value.origin !== 'mcp' && value.origin !== 'internal')
    || (value.documentId !== null && !boundedString(value.documentId, 512))
    || (value.outcome !== 'completed' && value.outcome !== 'accepted') || value.replayable !== true
    || !finite(value.startedAt) || !finite(value.durationMs) || value.durationMs < 0
    || (value.note !== null && (typeof value.note !== 'string' || value.note.length > 2_048))
    || (value.rationale !== null && (typeof value.rationale !== 'string'
      || value.rationale.trim() !== value.rationale || value.rationale.length > 280))
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) return null;
  try {
    if (jsonBytes(value.parameters) > 256 * 1024 || jsonBytes(value.result) > 256 * 1024) return null;
  } catch { return null; }
  return structuredClone(value) as unknown as StoredActionStep;
};

type ParsedAction = { readonly action: SavedSemanticAction }
  | { readonly error: string };

const parseAction = (value: unknown): ParsedAction => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || Object.keys(value).some((key) => !ACTION_KEYS.has(key))
    || !finite(value.createdAt) || !finite(value.updatedAt) || !record(value.recording)) {
    return { error: 'Action metadata is invalid.' };
  }
  const setId = value.setId;
  if (!boundedString(setId, 255)) return { error: 'Action Set identity is invalid.' };
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    return { error: 'Action enabled state is invalid.' };
  }
  const recording = value.recording;
  if (recording.status !== 'stopped' || recording.id !== value.id
    || Object.keys(recording).some((key) => !RECORDING_KEYS.has(key))
    || recording.name !== value.name || !finite(recording.startedAt) || !finite(recording.stoppedAt)
    || !Array.isArray(recording.steps) || recording.steps.length > MAX_STEPS
    || !finite(recording.byteLength) || recording.byteLength < 0 || recording.limitReached !== false) {
    return { error: 'Action recording metadata is invalid.' };
  }
  const variables = recording.variables;
  if (!Array.isArray(variables)) return { error: 'Action variables are malformed.' };
  const variableError = validateActionVariables(variables as ActionVariableDefinition[]);
  if (variableError) return { error: variableError };
  const steps = recording.steps.map((step, index) => parseStep(step, index + 1));
  if (steps.some((step) => !step)) return { error: 'Action steps are malformed.' };
  const contracts = checkActionCommandContracts(
    steps as StoredActionStep[], variables as ActionVariableDefinition[]
  );
  if (!contracts.ok) return { error: contracts.message };
  const parsedRecording = recording as unknown as ActionRecordingSnapshot;
  const action: SavedSemanticAction = { id: value.id, setId, name: value.name,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    enabled: value.enabled !== false,
    recording: { ...parsedRecording, variables: structuredClone(variables), steps: contracts.steps } };
  try {
    return jsonBytes(action) <= MAX_ACTION_BYTES
      ? { action }
      : { error: 'Action exceeds the storage boundary.' };
  } catch { return { error: 'Action is not serializable.' }; }
};

const parseSet = (value: unknown): SavedSemanticActionSet | null => {
  if (!record(value) || !boundedString(value.id, 255) || !boundedString(value.name, 255)
    || Object.keys(value).some((key) => !SET_KEYS.has(key))
    || !finite(value.createdAt) || !finite(value.updatedAt)
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) return null;
  return { id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt,
    enabled: value.enabled !== false };
};

const empty = (error: string | null = null): SemanticActionLibrarySnapshot => ({
  sets: [defaultSet()], selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  actions: [], selectedId: null, error
});
const nextId = (prefix: string, existing: ReadonlySet<string>): string => {
  const base = `${prefix}-${Date.now()}`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

export class SemanticActionLibrary {
  private snapshotValue: SemanticActionLibrarySnapshot;
  private durableSnapshotValue: SemanticActionLibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly readyValue: Promise<void>;
  private writeValue: Promise<void> = Promise.resolve();
  private writeRevision = 0;
  private disposed = false;

  constructor(private readonly storage?: SemanticActionLibraryStorage) {
    this.snapshotValue = empty();
    this.durableSnapshotValue = this.snapshotValue;
    try {
      const loaded = storage?.read() ?? null;
      if (loaded instanceof Promise) {
        this.readyValue = loaded.then((serialized) => {
          const restored = this.restore(serialized);
          this.durableSnapshotValue = restored;
          this.publish(restored);
        }, () => {
          const failed = empty('Saved Actions could not be read.');
          this.durableSnapshotValue = failed;
          this.publish(failed);
        });
      } else {
        this.snapshotValue = this.restore(loaded);
        this.durableSnapshotValue = this.snapshotValue;
        this.readyValue = Promise.resolve();
      }
    } catch {
      this.snapshotValue = empty('Saved Actions could not be read.');
      this.durableSnapshotValue = this.snapshotValue;
      this.readyValue = Promise.resolve();
    }
  }

  snapshot = (): SemanticActionLibrarySnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

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
      updatedAt: now,
      enabled: true
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

  async moveSet(id: string, direction: -1 | 1): Promise<boolean> {
    await this.readyValue;
    const index = this.snapshotValue.sets.findIndex((set) => set.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.snapshotValue.sets.length) return false;
    const sets = [...this.snapshotValue.sets];
    [sets[index], sets[target]] = [sets[target]!, sets[index]!];
    return this.persist({ ...this.snapshotValue, sets, error: null });
  }

  async save(recording: ActionRecordingSnapshot, name: string,
    targetSetId = this.snapshotValue.selectedSetId): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    const targetSet = this.snapshotValue.sets.find((set) => set.id === targetSetId);
    if (!normalizedName || normalizedName.length > 255 || recording.status !== 'stopped'
      || !targetSet
      || recording.steps.some(({ replayable, outcome }) =>
        !replayable || (outcome !== 'completed' && outcome !== 'accepted'))) return null;
    const now = Date.now();
    const requestedId = recording.id ?? nextId('action', new Set(this.snapshotValue.actions.map(({ id }) => id)));
    const previous = this.snapshotValue.actions.find((action) => action.id === requestedId
      && action.setId === targetSetId);
    const id = previous ? requestedId : this.snapshotValue.actions.some((action) => action.id === requestedId)
      ? nextId('action', new Set(this.snapshotValue.actions.map((action) => action.id))) : requestedId;
    const parsed = parseAction({ id, setId: targetSetId,
      name: normalizedName, createdAt: previous?.createdAt ?? now, updatedAt: now,
      enabled: previous ? previous.enabled !== false : targetSet.enabled !== false,
      recording: { ...recording, id, name: normalizedName, status: 'stopped', limitReached: false } });
    if ('error' in parsed) return null;
    const action = parsed.action;
    const existingIndex = this.snapshotValue.actions.findIndex((candidate) => candidate.id === id);
    const actions = [...this.snapshotValue.actions];
    if (existingIndex >= 0) actions[existingIndex] = action;
    else actions.push(action);
    if (actions.length > MAX_ACTIONS) return null;
    return await this.persist({ ...this.snapshotValue, actions, selectedSetId: targetSetId,
      selectedId: id, error: null }) ? action : null;
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

  async rename(id: string, name: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const normalizedName = name.trim();
    const existing = this.snapshotValue.actions.find((action) => action.id === id);
    if (!existing || !normalizedName || normalizedName.length > 255) return null;
    const renamed: SavedSemanticAction = { ...existing, name: normalizedName, updatedAt: Date.now(),
      recording: { ...existing.recording, name: normalizedName } };
    const actions = this.snapshotValue.actions.map((action) => action.id === id ? renamed : action);
    return await this.persist({ ...this.snapshotValue, actions, error: null }) ? renamed : null;
  }

  async duplicate(id: string): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const existing = this.snapshotValue.actions.find((action) => action.id === id);
    if (!existing || this.snapshotValue.actions.length >= MAX_ACTIONS) return null;
    const now = Date.now();
    const duplicateId = nextId('action', new Set(this.snapshotValue.actions.map((action) => action.id)));
    const duplicate: SavedSemanticAction = { ...structuredClone(existing), id: duplicateId,
      name: `${existing.name} copy`, createdAt: now, updatedAt: now,
      recording: { ...structuredClone(existing.recording), id: duplicateId, name: `${existing.name} copy` } };
    const index = this.snapshotValue.actions.findIndex((action) => action.id === id);
    const actions = [...this.snapshotValue.actions];
    actions.splice(index + 1, 0, duplicate);
    return await this.persist({ ...this.snapshotValue, actions, selectedSetId: duplicate.setId,
      selectedId: duplicate.id, error: null }) ? duplicate : null;
  }

  async move(id: string, direction: -1 | 1): Promise<boolean> {
    await this.readyValue;
    const action = this.snapshotValue.actions.find((candidate) => candidate.id === id);
    if (!action) return false;
    const setIndexes = this.snapshotValue.actions.map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.setId === action.setId).map(({ index }) => index);
    const localIndex = setIndexes.indexOf(this.snapshotValue.actions.indexOf(action));
    const target = localIndex + direction;
    if (localIndex < 0 || target < 0 || target >= setIndexes.length) return false;
    const actions = [...this.snapshotValue.actions];
    const targetIndex = setIndexes[target]!;
    const sourceIndex = setIndexes[localIndex]!;
    [actions[sourceIndex], actions[targetIndex]] = [actions[targetIndex]!, actions[sourceIndex]!];
    return this.persist({ ...this.snapshotValue, actions, error: null });
  }

  async setEnabled(id: string, enabled: boolean): Promise<SavedSemanticAction | null> {
    await this.readyValue;
    const existing = this.snapshotValue.actions.find((action) => action.id === id);
    if (!existing) return null;
    const updated: SavedSemanticAction = { ...existing, enabled, updatedAt: Date.now() };
    const actions = this.snapshotValue.actions.map((action) => action.id === id ? updated : action);
    return await this.persist({ ...this.snapshotValue, actions, error: null }) ? updated : null;
  }

  async setSetEnabled(setId: string, enabled: boolean): Promise<readonly SavedSemanticAction[] | null> {
    await this.readyValue;
    if (!this.snapshotValue.sets.some((set) => set.id === setId)) return null;
    const now = Date.now();
    const sets = this.snapshotValue.sets.map((set) => set.id === setId
      ? { ...set, enabled, updatedAt: now } : set);
    const updated = this.snapshotValue.actions;
    return await this.persist({ ...this.snapshotValue, sets, actions: updated, error: null })
      ? updated.filter((action) => action.setId === setId) : null;
  }

  private restore(serialized: string | null): SemanticActionLibrarySnapshot {
    if (!serialized) return empty();
    if (new TextEncoder().encode(serialized).byteLength > MAX_LIBRARY_BYTES) {
      return empty('Saved Actions exceed the storage boundary.');
    }
    try {
      const value: unknown = JSON.parse(serialized);
      if (!record(value) || value.format !== 'lighttable-actions'
        || Object.keys(value).some((key) => !LIBRARY_KEYS.has(key))
        || !Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS
        || (value.selectedId !== null && typeof value.selectedId !== 'string')) {
        return empty('Saved Actions use an unsupported or invalid format.');
      }
      const sets = this.restoreSets(value);
      if (!sets) return empty('Saved Actions contain invalid Action Set data.');
      const setIds = new Set(sets.map(({ id }) => id));
      const parsed = value.actions.map(parseAction);
      const invalid = parsed.find((action) => 'error' in action);
      if (invalid && 'error' in invalid) {
        return empty(`Saved Actions contain incompatible workflow data: ${invalid.error}`);
      }
      const actions = orderedActions(parsed.map((entry) =>
        (entry as Exclude<ParsedAction, { error: string }>).action));
      if (new Set(actions.map(({ id }) => id)).size !== actions.length
        || actions.some((action) => !setIds.has(action.setId))) {
        return empty('Saved Actions contain invalid Action Set relationships.');
      }
      const selectedSetId = value.selectedSetId;
      if (typeof selectedSetId !== 'string' || !setIds.has(selectedSetId)) {
        return empty('Saved Actions contain an invalid selected Action Set.');
      }
      const selectedId = typeof value.selectedId === 'string'
        && actions.some(({ id, setId }) => id === value.selectedId && setId === selectedSetId)
        ? value.selectedId
        : actions.find((action) => action.setId === selectedSetId)?.id ?? null;
      return { sets, selectedSetId, actions, selectedId, error: null };
    } catch { return empty('Saved Actions could not be parsed.'); }
  }

  private restoreSets(value: Record<string, unknown>): SavedSemanticActionSet[] | null {
    if (!Array.isArray(value.sets) || value.sets.length < 1
      || value.sets.length > LIGHTTABLE_MAX_ACTION_SETS) return null;
    const sets = value.sets.map(parseSet);
    if (sets.some((set) => !set)) return null;
    const valid = orderedSets(sets as SavedSemanticActionSet[]);
    return new Set(valid.map(({ id }) => id)).size === valid.length ? valid : null;
  }

  private serialize(snapshot: SemanticActionLibrarySnapshot): string | null {
    const envelope = { format: 'lighttable-actions',
      selectedSetId: snapshot.selectedSetId, selectedId: snapshot.selectedId,
      sets: snapshot.sets, actions: snapshot.actions };
    try {
      const serialized = JSON.stringify(envelope);
      return new TextEncoder().encode(serialized).byteLength <= MAX_LIBRARY_BYTES ? serialized : null;
    } catch { return null; }
  }

  private async persist(snapshot: SemanticActionLibrarySnapshot): Promise<boolean> {
    const serialized = this.serialize(snapshot);
    if (!serialized) {
      this.publish({ ...this.snapshotValue, error: 'Saved Actions exceed the storage boundary.' });
      return false;
    }
    // Publish synchronously so a second rapid mutation builds on this snapshot,
    // then serialize storage writes to preserve that same order on disk.
    this.publish(snapshot);
    const revision = ++this.writeRevision;
    const write = this.writeValue.then(async () => { await this.storage?.write(serialized); });
    this.writeValue = write.catch(() => undefined);
    try {
      await write;
      this.durableSnapshotValue = snapshot;
    } catch {
      if (revision === this.writeRevision) {
        this.publish({ ...this.durableSnapshotValue, error: 'Saved Actions could not be written.' });
      }
      return false;
    }
    return true;
  }

  private publish(snapshot: SemanticActionLibrarySnapshot): void {
    if (this.disposed) return;
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener();
  }
}
