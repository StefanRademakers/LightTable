import { describe, expect, it } from 'vitest';
import type { LayerId } from '../../editor/document/documentTypes';
import { TextInputLatencyTracker } from './TextInputLatencyTracker';

const layer = 'text-layer' as LayerId;

describe('TextInputLatencyTracker', () => {
  it('records only a matching authored source through submit and GPU completion', () => {
    const tracker = new TextInputLatencyTracker();
    const inputId = tracker.begin(layer, 10);
    tracker.syncSource(layer, 'revision-2');
    expect(tracker.markSubmitted(() => 'revision-1', 20)).toEqual([]);
    expect(tracker.markSubmitted(() => 'revision-2', 24)).toEqual([inputId]);
    tracker.markGpuComplete([inputId], 31);
    expect(tracker.snapshot()).toMatchObject({
      sampleCount: 1, pendingCount: 0,
      inputToSubmitP95Ms: 14, inputToSubmitMaxMs: 14,
      inputToGpuP95Ms: 21, inputToGpuMaxMs: 21
    });
  });

  it('excludes superseded and removed-layer inputs from latency samples', () => {
    const tracker = new TextInputLatencyTracker();
    tracker.begin(layer, 1);
    tracker.syncSource(layer, 'revision-1');
    tracker.begin(layer, 2);
    tracker.syncSource(layer, 'revision-2');
    tracker.retainLayers(new Set());
    expect(tracker.markSubmitted(() => 'revision-2', 10)).toEqual([]);
    expect(tracker.snapshot()).toMatchObject({
      sampleCount: 0, pendingCount: 0, supersededCount: 2
    });
  });

  it('keeps a bounded rolling window and reports its p95', () => {
    const tracker = new TextInputLatencyTracker();
    for (let index = 0; index < 300; index += 1) {
      tracker.begin(layer, index * 10);
      tracker.syncSource(layer, `revision-${index}`);
      tracker.markSubmitted(() => `revision-${index}`, index * 10 + index);
    }
    expect(tracker.snapshot()).toMatchObject({
      sampleCount: 256,
      inputToSubmitP95Ms: 287,
      inputToSubmitMaxMs: 299
    });
  });
});
