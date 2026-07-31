export type RenderInvalidationReason =
  | 'source'
  | 'document'
  | 'adjustments'
  | 'effects'
  | 'view-mode'
  | 'viewport'
  | 'histogram';

export interface RenderDirtySnapshot {
  documentComposite: boolean;
  correction: boolean;
  blurInput: boolean;
  viewport: boolean;
  histogram: boolean;
}

export type CorrectionRenderStage =
  | 'source-geometry'
  | 'linear-spatial'
  | 'output'
  | 'display-post';

const CORRECTION_STAGE_ORDER: Record<CorrectionRenderStage, number> = {
  'source-geometry': 0,
  'linear-spatial': 1,
  output: 2,
  'display-post': 3
};

/**
 * Owns the dependency fan-out between editor mutations and renderer stages.
 *
 * Keeping this policy outside WebGpuEngine makes it explicit that a viewport
 * resize must not rebuild the grade, while a source/document mutation must.
 */
export class RenderDirtyState {
  private earliestDirtyCorrectionStage: CorrectionRenderStage | null = 'source-geometry';
  private dirty: RenderDirtySnapshot = {
    documentComposite: true,
    correction: true,
    blurInput: true,
    viewport: true,
    histogram: true
  };

  get documentCompositeRequired() {
    return this.dirty.documentComposite;
  }

  get correctionRequired() {
    return this.dirty.correction;
  }

  correctionStageRequired(stage: CorrectionRenderStage) {
    return this.earliestDirtyCorrectionStage !== null
      && CORRECTION_STAGE_ORDER[stage] >= CORRECTION_STAGE_ORDER[this.earliestDirtyCorrectionStage];
  }

  invalidateCorrectionFrom(stage: CorrectionRenderStage) {
    if (
      this.earliestDirtyCorrectionStage === null
      || CORRECTION_STAGE_ORDER[stage] < CORRECTION_STAGE_ORDER[this.earliestDirtyCorrectionStage]
    ) this.earliestDirtyCorrectionStage = stage;
    this.dirty.correction = true;
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

  /**
   * Reports work that can produce commands in the current frame graph.
   *
   * `blurInput` is dependency bookkeeping for correction implementations and
   * is deliberately not counted separately: a blur input is only consumed as
   * part of a correction frame. This keeps observer callbacks from submitting
   * an empty command buffer after all visible work has already completed.
   */
  get hasPendingFrameWork() {
    return this.dirty.documentComposite || this.dirty.correction
      || this.dirty.viewport || this.dirty.histogram;
  }

  snapshot(): Readonly<RenderDirtySnapshot> {
    return { ...this.dirty };
  }

  invalidate(reason: RenderInvalidationReason) {
    switch (reason) {
      case 'source':
        this.earliestDirtyCorrectionStage = 'source-geometry';
        this.dirty = {
          documentComposite: true,
          correction: true,
          blurInput: true,
          viewport: true,
          histogram: true
        };
        break;
      case 'document':
        this.invalidateCorrectionFrom('source-geometry');
        this.dirty.documentComposite = true;
        this.dirty.blurInput = true;
        this.dirty.histogram = true;
        break;
      case 'adjustments':
        this.invalidateCorrectionFrom('source-geometry');
        this.dirty.blurInput = true;
        this.dirty.histogram = true;
        break;
      case 'effects':
        this.invalidateCorrectionFrom('source-geometry');
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

  markDocumentCompositeRendered() {
    this.dirty.documentComposite = false;
  }

  markBlurInputRendered() {
    this.dirty.blurInput = false;
  }

  markCorrectionRendered() {
    this.earliestDirtyCorrectionStage = null;
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
