export type TextInteractionTraceStage =
  | 'controller'
  | 'overlay-build'
  | 'overlay-set'
  | 'render-start'
  | 'queue-submit'
  | 'gpu-complete';

export interface TextInteractionTraceIdentity {
  readonly id: number;
  readonly kind: 'caret';
  readonly startedAt: number;
}

interface TextInteractionTraceGlobal {
  __LIGHTTABLE_TEXT_INTERACTION_TRACE__?: boolean;
  __LIGHTTABLE_TEXT_IMMEDIATE_OVERLAY__?: boolean;
}

const TRACE_NAME = 'LightTable text interaction';
let traceSequence = 0;

export const beginTextInteractionTrace = (): TextInteractionTraceIdentity | null => {
  if (!(globalThis as TextInteractionTraceGlobal).__LIGHTTABLE_TEXT_INTERACTION_TRACE__) return null;
  return Object.freeze({ id: ++traceSequence, kind: 'caret', startedAt: performance.now() });
};

export const immediateTextInteractionOverlayEnabled = () => (
  (globalThis as TextInteractionTraceGlobal).__LIGHTTABLE_TEXT_IMMEDIATE_OVERLAY__ !== false
);

export const recordTextInteractionTrace = (
  trace: TextInteractionTraceIdentity | null | undefined,
  stage: TextInteractionTraceStage,
  stageStartedAt: number = trace?.startedAt ?? 0
) => {
  if (!trace || !(globalThis as TextInteractionTraceGlobal).__LIGHTTABLE_TEXT_INTERACTION_TRACE__) return;
  const endedAt = performance.now();
  performance.measure(TRACE_NAME, {
    start: trace.startedAt,
    end: endedAt,
    detail: {
      id: trace.id,
      kind: trace.kind,
      stage,
      elapsedMs: endedAt - trace.startedAt,
      stageMs: endedAt - stageStartedAt
    }
  });
};
