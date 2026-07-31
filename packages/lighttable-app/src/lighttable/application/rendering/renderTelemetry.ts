import type { CorrectionRenderStage } from './renderDirtyState';

export type RenderTelemetryStage = 'document-composite'
  | CorrectionRenderStage
  | 'display-resolve';

export interface RenderStageTelemetrySnapshot {
  readonly executions: number;
  readonly totalEncodeMs: number;
  readonly lastEncodeMs: number;
  readonly maximumEncodeMs: number;
}

export interface RenderTelemetrySnapshot {
  readonly renderCalls: number;
  readonly submittedFrames: number;
  readonly noWorkSkips: number;
  readonly correctionFrames: number;
  readonly stages: Readonly<Record<RenderTelemetryStage, RenderStageTelemetrySnapshot>>;
}

const STAGES: readonly RenderTelemetryStage[] = [
  'document-composite',
  'source-geometry',
  'linear-spatial',
  'output',
  'display-post',
  'display-resolve'
];

const emptyStage = (): RenderStageTelemetrySnapshot => ({
  executions: 0,
  totalEncodeMs: 0,
  lastEncodeMs: 0,
  maximumEncodeMs: 0
});

const emptyStages = () => Object.fromEntries(
  STAGES.map((stage) => [stage, emptyStage()])
) as Record<RenderTelemetryStage, RenderStageTelemetrySnapshot>;

/**
 * Low-overhead CPU-side instrumentation for the correction frame graph.
 *
 * Timings cover command encoding and resource preparation, not asynchronous
 * GPU execution. Counts are intentionally retained until explicitly reset so
 * a developer can reproduce an interaction and capture one stable report
 * without a polling UI waking the editor on every frame.
 */
export class RenderTelemetry {
  private renderCalls = 0;
  private submittedFrames = 0;
  private noWorkSkips = 0;
  private correctionFrames = 0;
  private stages = emptyStages();

  recordRenderCall() {
    this.renderCalls += 1;
  }

  recordNoWorkSkip() {
    this.noWorkSkips += 1;
  }

  recordSubmittedFrame() {
    this.submittedFrames += 1;
  }

  recordCorrectionFrame() {
    this.correctionFrames += 1;
  }

  measure<Output>(stage: RenderTelemetryStage, operation: () => Output): Output {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      const duration = performance.now() - startedAt;
      const current = this.stages[stage];
      this.stages[stage] = {
        executions: current.executions + 1,
        totalEncodeMs: current.totalEncodeMs + duration,
        lastEncodeMs: duration,
        maximumEncodeMs: Math.max(current.maximumEncodeMs, duration)
      };
    }
  }

  snapshot(): RenderTelemetrySnapshot {
    return {
      renderCalls: this.renderCalls,
      submittedFrames: this.submittedFrames,
      noWorkSkips: this.noWorkSkips,
      correctionFrames: this.correctionFrames,
      stages: Object.fromEntries(STAGES.map((stage) => [
        stage,
        { ...this.stages[stage] }
      ])) as Record<RenderTelemetryStage, RenderStageTelemetrySnapshot>
    };
  }

  reset() {
    this.renderCalls = 0;
    this.submittedFrames = 0;
    this.noWorkSkips = 0;
    this.correctionFrames = 0;
    this.stages = emptyStages();
  }
}

const formatMs = (value: number) => `${value.toFixed(2)} ms`;

export const formatRenderTelemetry = (snapshot: RenderTelemetrySnapshot) => {
  const correctionFrames = snapshot.correctionFrames;
  const stageLines = STAGES.map((stage) => {
    const current = snapshot.stages[stage];
    const reused = Math.max(0, correctionFrames - current.executions);
    return `${stage}: ${current.executions} executions`
      + `; ${reused} correction-frame reuses`
      + `; encode total ${formatMs(current.totalEncodeMs)}`
      + `; last ${formatMs(current.lastEncodeMs)}`
      + `; max ${formatMs(current.maximumEncodeMs)}`;
  });
  return [
    `Render calls: ${snapshot.renderCalls}`,
    `Submitted frames: ${snapshot.submittedFrames}`,
    `No-work skips: ${snapshot.noWorkSkips}`,
    `Correction frames: ${correctionFrames}`,
    ...stageLines
  ].join('\n');
};
