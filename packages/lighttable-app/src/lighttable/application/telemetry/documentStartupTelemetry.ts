import type { LightTableStartupTimings } from './editorTelemetry';
import type {
  DocumentStartupTimeline,
  DocumentStartupTimelineEvent,
  DocumentStartupTimelineStage
} from './documentStartupTimeline';

export type StartupClock = () => number;

/**
 * Owns timing state for exactly one document-open generation.
 *
 * Keeping this state outside React prevents ordinary renders and inactive tab
 * projection from restarting or corrupting startup measurements.
 */
export class DocumentStartupTelemetry {
  private readonly now: StartupClock;
  private startedAt = 0;
  private awaitingFirstFrame = false;
  private timings: LightTableStartupTimings = {};
  private timeline: DocumentStartupTimeline | null = null;

  constructor(now: StartupClock = () => performance.now()) {
    this.now = now;
  }

  begin(timeline?: DocumentStartupTimeline): void {
    this.startedAt = this.now();
    this.awaitingFirstFrame = true;
    this.timings = {};
    this.timeline = timeline ?? null;
  }

  markTimelineStage(
    stage: DocumentStartupTimelineStage,
    detail?: DocumentStartupTimelineEvent['detail']
  ): number | null {
    return this.timeline?.mark(stage, detail) ?? null;
  }

  activeTimeline(): DocumentStartupTimeline | null {
    return this.timeline;
  }

  merge(timings: LightTableStartupTimings): void {
    this.timings = { ...this.timings, ...timings };
  }

  rendererReady(elapsedMs: number): void {
    this.timings.webGpuMs = elapsedMs;
  }

  sourceReady(elapsedMs: number): void {
    this.timings.downloadMs = elapsedMs;
  }

  completeFirstFrame(): LightTableStartupTimings | null {
    if (!this.awaitingFirstFrame) return null;
    this.awaitingFirstFrame = false;
    this.timings.firstFrameMs = this.now() - this.startedAt;
    return this.snapshot();
  }

  beginDeferredScopes(): number {
    return this.now();
  }

  completeDeferredScopes(startedAt: number): LightTableStartupTimings {
    this.timings.scopesMs = this.now() - startedAt;
    return this.snapshot();
  }

  snapshot(): LightTableStartupTimings {
    return { ...this.timings };
  }
}
