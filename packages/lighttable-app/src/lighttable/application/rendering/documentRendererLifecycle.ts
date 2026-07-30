export type DocumentRendererStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'suspended'
  | 'failed'
  | 'disposed';

export interface DocumentRendererSnapshot {
  readonly status: DocumentRendererStatus;
  readonly generation: number;
  readonly active: boolean;
  readonly estimatedGpuBytes: number;
  readonly error: string | null;
}

export type DocumentRendererListener = (
  snapshot: DocumentRendererSnapshot
) => void;

/**
 * Application-owned lifecycle for one document renderer.
 *
 * It intentionally does not import WebGPU. Concrete engines remain an
 * infrastructure concern, while document switching, stale-start protection,
 * memory accounting and terminal disposal have one testable owner.
 */
export class DocumentRendererLifecycle {
  private snapshot: DocumentRendererSnapshot = {
    status: 'idle',
    generation: 0,
    active: true,
    estimatedGpuBytes: 0,
    error: null
  };

  private readonly listeners = new Set<DocumentRendererListener>();

  getSnapshot = (): DocumentRendererSnapshot => this.snapshot;

  subscribe = (listener: DocumentRendererListener): (() => void) => {
    this.assertUsable();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  beginStart(): number {
    this.assertUsable();
    const generation = this.snapshot.generation + 1;
    this.update({
      status: 'starting',
      generation,
      estimatedGpuBytes: 0,
      error: null
    });
    return generation;
  }

  isCurrent(generation: number): boolean {
    return this.snapshot.status !== 'disposed'
      && this.snapshot.generation === generation;
  }

  markReady(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.update({
      status: this.snapshot.active ? 'ready' : 'suspended',
      error: null
    });
    return true;
  }

  markFailed(generation: number, reason: string): boolean {
    if (!this.isCurrent(generation)) return false;
    this.update({
      status: 'failed',
      error: reason,
      estimatedGpuBytes: 0
    });
    return true;
  }

  setActive(active: boolean): void {
    this.assertUsable();
    if (active === this.snapshot.active) return;
    const status = this.snapshot.status === 'ready' && !active
      ? 'suspended'
      : this.snapshot.status === 'suspended' && active
        ? 'ready'
        : this.snapshot.status;
    this.update({ active, status });
  }

  setMemoryEstimate(bytes: number, generation = this.snapshot.generation): boolean {
    if (!this.isCurrent(generation)) return false;
    const estimatedGpuBytes = Math.max(0, Math.round(bytes));
    if (estimatedGpuBytes === this.snapshot.estimatedGpuBytes) return true;
    this.update({ estimatedGpuBytes });
    return true;
  }

  reset(generation = this.snapshot.generation): boolean {
    if (!this.isCurrent(generation)) return false;
    this.update({
      status: 'idle',
      estimatedGpuBytes: 0,
      error: null
    });
    return true;
  }

  dispose(): void {
    if (this.snapshot.status === 'disposed') return;
    this.snapshot = {
      ...this.snapshot,
      status: 'disposed',
      estimatedGpuBytes: 0,
      error: null
    };
    this.emit();
    this.listeners.clear();
  }

  private update(
    patch: Partial<Omit<DocumentRendererSnapshot, 'generation'>> & {
      readonly generation?: number;
    }
  ): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private assertUsable(): void {
    if (this.snapshot.status === 'disposed') {
      throw new Error('Document renderer lifecycle is disposed.');
    }
  }
}
