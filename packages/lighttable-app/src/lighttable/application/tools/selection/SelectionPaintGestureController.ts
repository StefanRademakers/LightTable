import type { ImageDocument } from '../../../editor/document/documentTypes';
import { createFullCanvasSelection, type SelectionOperation } from '../../../editor/selection/selectionTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { BrushDab, BrushPoint } from '../../../editor/tools/brush/strokeBuilder';
import { StrokeBuilder } from '../../../editor/tools/brush/strokeBuilder';
import { StrokeSmoother } from '../../../editor/tools/brush/strokeSmoother';
import type {
  SelectionPaintPreviewPort,
  SelectionRendererPort,
  SelectionSessionDependencies
} from './selectionSessionPorts';

interface PaintGesture {
  readonly pointerId: number;
  readonly document: ImageDocument;
  readonly renderer: SelectionRendererPort;
  readonly preview: SelectionPaintPreviewPort;
  readonly before: SelectionOperation[];
  readonly beforeMask: Promise<SelectionMaskSnapshot>;
  readonly mode: 'add' | 'subtract';
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
  readonly smooth: number;
  readonly builder: StrokeBuilder;
  readonly smoother: StrokeSmoother;
  readonly dabs: BrushDab[];
  readonly samples: BrushPoint[];
  renderQueue: Promise<boolean>;
}

export interface SelectionPaintGestureControllerOptions {
  readonly resolveDependencies: () => SelectionSessionDependencies;
  readonly queueCommit: <Result>(operation: () => Promise<Result>) => Promise<Result>;
  readonly isCurrent: (document: ImageDocument, renderer: SelectionRendererPort) => boolean;
  readonly cloneSelection: (operations: readonly SelectionOperation[]) => SelectionOperation[];
  readonly committedMask: (
    dependencies: SelectionSessionDependencies,
    document: ImageDocument,
    operations: readonly SelectionOperation[]
  ) => SelectionMaskSnapshot | null;
  readonly notifyObservedCommit: (
    dependencies: SelectionSessionDependencies,
    observe: (() => void) | undefined
  ) => void;
}

/** Owns one selection-paint preview and its hand-off to the selection kernel. */
export class SelectionPaintGestureController {
  private gesture: PaintGesture | null = null;

  constructor(private readonly options: SelectionPaintGestureControllerOptions) {}

  owns(pointerId: number): boolean {
    return this.gesture?.pointerId === pointerId;
  }

  begin(
    pointerId: number,
    point: BrushPoint,
    mode: 'add' | 'subtract',
    options: { size: number; hardness: number; opacity: number; smooth: number }
  ): boolean {
    const dependencies = this.options.resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || this.gesture) return false;
    const size = Math.max(1, Math.min(1000, options.size));
    const smooth = Math.max(0, Math.min(1, options.smooth));
    const hardness = Math.max(0, Math.min(1, options.hardness));
    const opacity = Math.max(0.01, Math.min(1, options.opacity));
    const builder = new StrokeBuilder(size, 0.05);
    const smoother = new StrokeSmoother(smooth, size);
    const before = this.options.cloneSelection(dependencies.getSelection());
    const first = builder.begin(smoother.begin(point));
    const exactBefore = this.options.committedMask(dependencies, document, before);
    if (!exactBefore) {
      dependencies.setError('The document selection has no exact committed coverage.');
      return false;
    }
    const preview = renderer.beginSelectionPaintPreview(exactBefore);
    if (!preview) {
      dependencies.setError('The selection paint preview is unavailable.');
      return false;
    }
    let firstRender: Promise<boolean>;
    try {
      firstRender = preview.paintSelectionDabs(first, hardness, opacity, mode);
    } catch (reason) {
      preview.release();
      throw reason;
    }
    this.gesture = {
      pointerId, document, renderer, preview, before,
      beforeMask: Promise.resolve(exactBefore),
      mode, size, hardness, opacity, smooth, builder, smoother,
      dabs: first.map((dab) => ({ ...dab })),
      samples: [{ ...point }],
      renderQueue: firstRender
    };
    dependencies.publishSelection(before, pointerId);
    return true;
  }

  move(pointerId: number, points: readonly BrushPoint[]): boolean {
    const current = this.gesture;
    if (!current || current.pointerId !== pointerId || !points.length) return false;
    current.samples.push(...points.map((point) => ({ ...point })));
    const dabs = points.flatMap((point) => current.builder.add(current.smoother.add(point)));
    if (!dabs.length) return true;
    const request = current.preview.paintSelectionDabs(
      dabs, current.hardness, current.opacity, current.mode
    );
    current.renderQueue = Promise.all([current.renderQueue, request])
      .then(([previous, applied]) => previous && applied, () => false);
    current.dabs.push(...dabs.map((dab) => ({ ...dab })));
    return true;
  }

  finish(pointerId: number): boolean {
    const current = this.take(pointerId);
    if (!current) return false;
    const tail = current.smoother.finish().flatMap((point) => current.builder.add(point));
    if (tail.length) {
      const request = current.preview.paintSelectionDabs(
        tail, current.hardness, current.opacity, current.mode
      );
      current.renderQueue = Promise.all([current.renderQueue, request])
        .then(([previous, applied]) => previous && applied, () => false);
      current.dabs.push(...tail.map((dab) => ({ ...dab })));
    }
    const provenance: SelectionOperation = {
      mode: current.mode,
      source: {
        kind: 'selection-paint',
        dabs: current.dabs.map((dab) => ({ ...dab })),
        hardness: current.hardness,
        opacity: current.opacity
      },
      shape: createFullCanvasSelection(current.document.width, current.document.height)[0].shape
    };
    void this.options.queueCommit(() => this.commit(current, provenance));
    return true;
  }

  cancel(pointerId: number): boolean {
    const current = this.take(pointerId);
    if (!current) return false;
    this.restore(current);
    return true;
  }

  reset(): boolean {
    const current = this.gesture;
    this.gesture = null;
    if (!current) return false;
    this.restore(current);
    return true;
  }

  private take(pointerId: number): PaintGesture | null {
    if (!this.gesture || this.gesture.pointerId !== pointerId) return null;
    const current = this.gesture;
    this.gesture = null;
    return current;
  }

  private async commit(current: PaintGesture, provenance: SelectionOperation): Promise<void> {
    let beforeMask: SelectionMaskSnapshot | null = null;
    let handedOffToKernel = false;
    try {
      beforeMask = await current.beforeMask;
      const applied = await current.renderQueue;
      if (!applied || !this.options.isCurrent(current.document, current.renderer)) {
        if (this.options.isCurrent(current.document, current.renderer)) {
          await current.preview.restoreSelectionSnapshot(beforeMask);
          this.options.resolveDependencies().publishSelection(current.before, null, beforeMask);
          this.options.resolveDependencies().setError('The selection brush stroke could not be applied.');
        }
        return;
      }
      if (!await current.preview.restoreSelectionSnapshot(beforeMask)
        || !this.options.isCurrent(current.document, current.renderer)) {
        throw new Error('The selection brush baseline could not be restored.');
      }
      current.preview.release();
      handedOffToKernel = true;
      const committed = await this.options.resolveDependencies().commitPaint({
        dabs: current.dabs,
        hardness: current.hardness,
        opacity: current.opacity,
        mode: current.mode,
        provenance
      });
      if (!committed) throw new Error('The selection brush stroke could not be committed.');
      const latest = this.options.resolveDependencies();
      latest.setError(null);
      this.options.notifyObservedCommit(latest, () => latest.onPaintCommitted?.({
        kind: 'selection-paint',
        mode: current.mode,
        dabs: current.dabs.map((dab) => ({ ...dab })),
        samples: current.samples.map((sample) => ({ ...sample })),
        size: current.size,
        hardness: current.hardness,
        opacity: current.opacity,
        smooth: current.smooth
      }));
    } catch (reason) {
      if (handedOffToKernel) {
        if (this.options.isCurrent(current.document, current.renderer)) {
          this.options.resolveDependencies().setError(
            reason instanceof Error ? reason.message : 'The selection brush stroke could not be applied.'
          );
        }
      } else if (beforeMask && this.options.isCurrent(current.document, current.renderer)) {
        await current.preview.restoreSelectionSnapshot(beforeMask).catch(() => false);
        this.options.resolveDependencies().publishSelection(current.before, null, beforeMask);
        this.options.resolveDependencies().setError(
          reason instanceof Error ? reason.message : 'The selection brush stroke could not be applied.'
        );
      }
    } finally {
      if (!handedOffToKernel) current.preview.release();
    }
  }

  private restore(current: PaintGesture): void {
    void this.options.queueCommit(async () => {
      const beforeMask = await current.beforeMask;
      await current.renderQueue;
      if (!this.options.isCurrent(current.document, current.renderer)) return;
      if (!await current.preview.restoreSelectionSnapshot(beforeMask)) {
        throw new Error('The selection could not be restored.');
      }
      if (this.options.isCurrent(current.document, current.renderer)) {
        this.options.resolveDependencies().publishSelection(current.before, null, beforeMask);
      }
    }).catch((reason) => {
      if (this.options.isCurrent(current.document, current.renderer)) {
        this.options.resolveDependencies().setError(
          reason instanceof Error ? reason.message : 'The selection could not be restored.'
        );
      }
    }).finally(() => current.preview.release());
  }
}
