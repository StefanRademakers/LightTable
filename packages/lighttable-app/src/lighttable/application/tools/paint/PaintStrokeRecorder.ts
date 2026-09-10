import type { BrushSettings } from '../../../editor/session/editorSession';
import type { BrushPoint } from '../../../editor/tools/brush/strokeBuilder';
import type { PaintGestureTarget } from '../../../editor/tools/paint/paintGestureController';
import type { PaintBrushStrokePlan } from '../../../editor/tools/paint/sampledBrushTypes';

export interface RecordedPaintStroke {
  readonly target: PaintGestureTarget;
  readonly brush: BrushSettings;
  readonly operator?: PaintBrushStrokePlan;
  readonly samples: readonly BrushPoint[];
}

const cloneOperator = (operator: PaintBrushStrokePlan): PaintBrushStrokePlan =>
  operator.operator === 'tone' ? { ...operator } : ({
    ...operator,
    source: { ...operator.source, point: { ...operator.source.point } },
    sourceOffset: { ...operator.sourceOffset }
  });

/** Bounded semantic evidence recorder; it never participates in live paint rendering. */
export class PaintStrokeRecorder {
  private recording: {
    target: PaintGestureTarget;
    brush: BrushSettings;
    operator?: PaintBrushStrokePlan;
    samples: BrushPoint[];
    byteLength: number;
    overflowed: boolean;
  } | null = null;

  begin(
    enabled: boolean,
    target: PaintGestureTarget,
    brush: BrushSettings,
    point: BrushPoint,
    operator?: PaintBrushStrokePlan
  ): void {
    this.recording = enabled ? {
      target: { ...target, sourceToDocument: { ...target.sourceToDocument } },
      brush: { ...brush },
      ...(operator ? { operator: cloneOperator(operator) } : {}),
      samples: [{ ...point }],
      byteLength: 512 + JSON.stringify(point).length,
      overflowed: false
    } : null;
  }

  capture(points: readonly BrushPoint[]): void {
    if (!this.recording || this.recording.overflowed) return;
    const addedBytes = points.reduce(
      (total, point) => total + JSON.stringify(point).length,
      0
    );
    if (this.recording.samples.length + points.length > 4096
      || this.recording.byteLength + addedBytes > 220 * 1024) {
      this.recording.overflowed = true;
      this.recording.samples = [];
      return;
    }
    this.recording.samples.push(...points.map((point) => ({ ...point })));
    this.recording.byteLength += addedBytes;
  }

  take(): RecordedPaintStroke | null {
    const completed = this.recording;
    this.recording = null;
    return completed && !completed.overflowed ? completed : null;
  }

  reset(): void { this.recording = null; }
}
