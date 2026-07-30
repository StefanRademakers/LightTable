export type RenderInvalidationReason =
  | 'source'
  | 'document'
  | 'adjustments'
  | 'effects'
  | 'view-mode'
  | 'viewport'
  | 'histogram';

export interface RenderDirtySnapshot {
  correction: boolean;
  blurInput: boolean;
  viewport: boolean;
  histogram: boolean;
}

/**
 * Owns the dependency fan-out between editor mutations and renderer stages.
 *
 * Keeping this policy outside WebGpuEngine makes it explicit that a viewport
 * resize must not rebuild the grade, while a source/document mutation must.
 */
export class RenderDirtyState {
  private dirty: RenderDirtySnapshot = {
    correction: true,
    blurInput: true,
    viewport: true,
    histogram: true
  };

  get correctionRequired() {
    return this.dirty.correction;
  }

  get blurInputRequired() {
    return this.dirty.blurInput;
  }

  get viewportRequired() {
    return this.dirty.viewport;
  }

  get histogramRequired() {
    return this.dirty.histogram;
  }

  snapshot(): Readonly<RenderDirtySnapshot> {
    return { ...this.dirty };
  }

  invalidate(reason: RenderInvalidationReason) {
    switch (reason) {
      case 'source':
        this.dirty = {
          correction: true,
          blurInput: true,
          viewport: true,
          histogram: true
        };
        break;
      case 'document':
      case 'adjustments':
        this.dirty.correction = true;
        this.dirty.blurInput = true;
        this.dirty.histogram = true;
        break;
      case 'effects':
        this.dirty.correction = true;
        this.dirty.histogram = true;
        break;
      case 'view-mode':
        this.dirty.viewport = true;
        this.dirty.histogram = true;
        break;
      case 'viewport':
        this.dirty.viewport = true;
        break;
      case 'histogram':
        this.dirty.histogram = true;
        break;
    }
  }

  markBlurInputRendered() {
    this.dirty.blurInput = false;
  }

  markCorrectionRendered() {
    this.dirty.correction = false;
    this.dirty.viewport = true;
  }

  markViewportRendered() {
    this.dirty.viewport = false;
  }

  markHistogramScheduled() {
    this.dirty.histogram = false;
  }
}
