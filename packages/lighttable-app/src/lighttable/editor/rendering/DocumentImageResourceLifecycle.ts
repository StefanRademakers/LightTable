import type { DocumentResourceState } from './DocumentResourceState';

export interface DocumentImageResourceLifecycleOptions {
  resourceState: DocumentResourceState;
  teardown: readonly (() => void)[];
  maximumTextureDimension: number;
}

/**
 * Coordinates replacement and destruction of all GPU resources that belong to
 * one image document. The resource generation is invalidated before teardown,
 * so pending async decodes/readbacks can no longer publish stale results.
 */
export class DocumentImageResourceLifecycle {
  constructor(private readonly options: DocumentImageResourceLifecycleOptions) {}

  begin(width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width <= 0 || height <= 0
      || width > this.options.maximumTextureDimension
      || height > this.options.maximumTextureDimension) {
      throw new Error(
        `Document dimensions ${width} × ${height} exceed this GPU's `
        + `${this.options.maximumTextureDimension}-pixel texture limit.`
      );
    }
    this.destroy();
    this.options.resourceState.setDimensions(width, height);
  }

  destroy() {
    this.options.resourceState.invalidate();
    const failures: unknown[] = [];
    for (const release of this.options.teardown) {
      try { release(); } catch (reason) { failures.push(reason); }
    }
    if (failures.length) {
      console.error('LightTable document GPU cleanup failed.', new AggregateError(failures));
    }
  }
}
