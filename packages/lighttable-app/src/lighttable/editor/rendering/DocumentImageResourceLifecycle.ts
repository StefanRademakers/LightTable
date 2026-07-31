import type { DocumentResourceState } from './DocumentResourceState';

export interface DocumentImageResourceLifecycleOptions {
  resourceState: DocumentResourceState;
  teardown: readonly (() => void)[];
}

/**
 * Coordinates replacement and destruction of all GPU resources that belong to
 * one image document. The resource generation is invalidated before teardown,
 * so pending async decodes/readbacks can no longer publish stale results.
 */
export class DocumentImageResourceLifecycle {
  constructor(private readonly options: DocumentImageResourceLifecycleOptions) {}

  begin(width: number, height: number) {
    this.destroy();
    this.options.resourceState.setDimensions(width, height);
  }

  destroy() {
    this.options.resourceState.invalidate();
    this.options.teardown.forEach((release) => release());
  }
}
