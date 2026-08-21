import { AsyncLocalStorage } from 'node:async_hooks';

const roundedMs = (value) => Math.round(Math.max(0, value) * 1000) / 1000;
const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const summarize = (entries) => [...entries.reduce((groups, entry) => {
  const name = entry.command ? `${entry.name}:${entry.command}` : entry.name;
  const key = `${entry.kind}:${name}`;
  const current = groups.get(key) ?? { kind: entry.kind, name, durations: [] };
  current.durations.push(entry.durationMs);
  groups.set(key, current);
  return groups;
}, new Map()).values()].map(({ kind, name, durations }) => ({
  kind,
  name,
  count: durations.length,
  totalMs: roundedMs(durations.reduce((total, value) => total + value, 0)),
  averageMs: roundedMs(durations.reduce((total, value) => total + value, 0) / durations.length),
  p50Ms: roundedMs(percentile(durations, 0.5)),
  p95Ms: roundedMs(percentile(durations, 0.95)),
  maximumMs: roundedMs(Math.max(...durations))
})).sort((left, right) => right.totalMs - left.totalMs || left.name.localeCompare(right.name));

/** Bounded, process-local MCP timing evidence. It never records parameters or document content. */
export class McpLatencyDiagnostics {
  constructor({ now = () => performance.now(), wallNow = () => Date.now(), maximum = 256 } = {}) {
    this.now = now;
    this.wallNow = wallNow;
    this.maximum = Math.max(16, Math.min(2048, maximum));
    this.startedAt = this.wallNow();
  }

  now;
  wallNow;
  maximum;
  startedAt;
  sequence = 0;
  entries = [];
  context = new AsyncLocalStorage();

  async measureTool(name, operation) {
    const id = ++this.sequence;
    const startedAt = this.now();
    const wallStartedAt = this.wallNow();
    let outcome = 'completed';
    try {
      const value = await this.context.run({ toolCallId: id }, operation);
      if (value?.isError === true) outcome = 'failed';
      return value;
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      this.append({ id, kind: 'tool', name, outcome, startedAt: wallStartedAt,
        durationMs: roundedMs(this.now() - startedAt), parentToolCallId: null });
    }
  }

  async measureBridge(name, details, operation) {
    const id = ++this.sequence;
    const startedAt = this.now();
    const wallStartedAt = this.wallNow();
    let outcome = 'completed';
    let taskId = null;
    let taskElapsedMs = null;
    let taskDurationMs = null;
    try {
      const value = await operation();
      taskId = typeof value?.taskId === 'string' ? value.taskId
        : name === 'task.query' && typeof value?.id === 'string' ? value.id : null;
      taskElapsedMs = Number.isFinite(value?.elapsedMs) ? roundedMs(value.elapsedMs) : null;
      taskDurationMs = Number.isFinite(value?.durationMs) ? roundedMs(value.durationMs) : null;
      if (value?.status === 'rejected' || value?.status === 'failed') outcome = 'failed';
      return value;
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      this.append({ id, kind: 'bridge', name, command: details.command ?? null,
        outcome, startedAt: wallStartedAt, durationMs: roundedMs(this.now() - startedAt),
        parentToolCallId: this.context.getStore()?.toolCallId ?? null, taskId,
        taskElapsedMs, taskDurationMs });
    }
  }

  instrument(client) {
    return {
      invoke: (method, parameters = {}) => this.measureBridge(method, {
        command: method === 'command.execute' && typeof parameters?.command === 'string'
          ? parameters.command : null
      }, () => client.invoke(method, parameters)),
      uploadArtifact: (input) => this.measureBridge('artifact.upload', {}, () => client.uploadArtifact(input)),
      readArtifact: (artifactId) => this.measureBridge('artifact.read', {}, () => client.readArtifact(artifactId))
    };
  }

  snapshot(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(256, Math.floor(limit)));
    const selected = this.entries.slice(-boundedLimit);
    const bridgeByTool = new Map();
    for (const entry of selected) {
      if (entry.kind !== 'bridge' || entry.parentToolCallId === null) continue;
      bridgeByTool.set(entry.parentToolCallId,
        (bridgeByTool.get(entry.parentToolCallId) ?? 0) + entry.durationMs);
    }
    const entries = selected.map((entry) => entry.kind === 'tool' ? {
      ...entry,
      bridgeMs: roundedMs(bridgeByTool.get(entry.id) ?? 0),
      serverOverheadMs: roundedMs(Math.max(0, entry.durationMs - (bridgeByTool.get(entry.id) ?? 0)))
    } : { ...entry });
    const tasks = [...selected.reduce((byId, entry) => {
      if (entry.kind !== 'bridge' || entry.taskId === null || entry.taskElapsedMs === null) return byId;
      byId.set(entry.taskId, {
        taskId: entry.taskId,
        elapsedMs: entry.taskElapsedMs,
        durationMs: entry.taskDurationMs,
        observedAt: entry.startedAt
      });
      return byId;
    }, new Map()).values()];
    return {
      startedAt: this.startedAt,
      capturedEntries: this.entries.length,
      returnedEntries: entries.length,
      droppedEntries: Math.max(0, this.sequence - this.entries.length),
      note: 'Tool duration and nested bridge duration overlap and must not be added. Timings exclude Codex/model processing and client startup.',
      summary: summarize(entries),
      tasks,
      entries
    };
  }

  reset() {
    this.entries = [];
    this.sequence = 0;
    this.startedAt = this.wallNow();
  }

  append(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.maximum) this.entries.splice(0, this.entries.length - this.maximum);
  }
}
