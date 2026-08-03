import type { LayerId } from '../../editor/document/documentTypes';

interface PendingInput {
  readonly id: number;
  readonly layerId: LayerId;
  readonly startedAt: number;
  sourceKey: string | null;
}

export interface TextInputLatencySnapshot {
  readonly sampleCount: number;
  readonly pendingCount: number;
  readonly supersededCount: number;
  readonly inputToSubmitP95Ms: number;
  readonly inputToSubmitMaxMs: number;
  readonly inputToGpuP95Ms: number;
  readonly inputToGpuMaxMs: number;
}

const MAX_SAMPLES = 256;
const validTime = (value: number) => Number.isFinite(value) && value >= 0;
const percentile95 = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
};
const appendBounded = (values: number[], value: number) => {
  values.push(value);
  if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
};

/** Correlates a UI mutation only with the exact authored source that reaches a submitted frame. */
export class TextInputLatencyTracker {
  private sequence = 0;
  private readonly pending = new Map<LayerId, PendingInput>();
  private readonly submitted = new Map<number, { readonly startedAt: number }>();
  private readonly submitSamples: number[] = [];
  private readonly gpuSamples: number[] = [];
  private supersededCount = 0;

  begin(layerId: LayerId, startedAt: number) {
    if (!validTime(startedAt)) throw new TypeError('startedAt must be finite and non-negative.');
    if (this.pending.has(layerId)) this.supersededCount += 1;
    const input = { id: ++this.sequence, layerId, startedAt, sourceKey: null };
    this.pending.set(layerId, input);
    return input.id;
  }

  syncSource(layerId: LayerId, sourceKey: string) {
    const input = this.pending.get(layerId);
    if (!input) return false;
    if (!sourceKey) throw new TypeError('sourceKey must not be empty.');
    if (input.sourceKey && input.sourceKey !== sourceKey) {
      this.pending.delete(layerId);
      this.supersededCount += 1;
      return false;
    }
    input.sourceKey = sourceKey;
    return true;
  }

  retainLayers(layerIds: ReadonlySet<LayerId>) {
    for (const layerId of this.pending.keys()) {
      if (!layerIds.has(layerId)) {
        this.pending.delete(layerId);
        this.supersededCount += 1;
      }
    }
  }

  markSubmitted(
    exactSourceKey: (layerId: LayerId) => string | null,
    submittedAt: number
  ) {
    if (!validTime(submittedAt)) throw new TypeError('submittedAt must be finite and non-negative.');
    const submittedIds: number[] = [];
    for (const [layerId, input] of this.pending) {
      if (!input.sourceKey || exactSourceKey(layerId) !== input.sourceKey) continue;
      appendBounded(this.submitSamples, Math.max(0, submittedAt - input.startedAt));
      this.submitted.set(input.id, { startedAt: input.startedAt });
      this.pending.delete(layerId);
      submittedIds.push(input.id);
    }
    return Object.freeze(submittedIds);
  }

  markGpuComplete(inputIds: readonly number[], completedAt: number) {
    if (!validTime(completedAt)) throw new TypeError('completedAt must be finite and non-negative.');
    let completed = 0;
    for (const inputId of inputIds) {
      const input = this.submitted.get(inputId);
      if (!input) continue;
      appendBounded(this.gpuSamples, Math.max(0, completedAt - input.startedAt));
      this.submitted.delete(inputId);
      completed += 1;
    }
    return completed;
  }

  clear() {
    this.pending.clear();
    this.submitted.clear();
  }

  reset() {
    this.clear();
    this.submitSamples.length = 0;
    this.gpuSamples.length = 0;
    this.supersededCount = 0;
  }

  snapshot(): TextInputLatencySnapshot {
    return Object.freeze({
      sampleCount: this.submitSamples.length,
      pendingCount: this.pending.size + this.submitted.size,
      supersededCount: this.supersededCount,
      inputToSubmitP95Ms: percentile95(this.submitSamples),
      inputToSubmitMaxMs: this.submitSamples.length ? Math.max(...this.submitSamples) : 0,
      inputToGpuP95Ms: percentile95(this.gpuSamples),
      inputToGpuMaxMs: this.gpuSamples.length ? Math.max(...this.gpuSamples) : 0
    });
  }
}
