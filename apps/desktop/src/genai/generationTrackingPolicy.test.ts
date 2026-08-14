import { describe, expect, it } from 'vitest';
import {
  GEN_AI_TRACKING_TIMEOUT_MS,
  generationTrackingTimedOut,
  generationTrackingTimeRemaining
} from './generationTrackingPolicy';

describe('generation tracking policy', () => {
  it('expires a running job after thirty minutes', () => {
    const now = 10 * GEN_AI_TRACKING_TIMEOUT_MS;
    expect(generationTrackingTimeRemaining({ updatedAt: now - 1_000 }, now)).toBe(
      GEN_AI_TRACKING_TIMEOUT_MS - 1_000
    );
    expect(generationTrackingTimedOut({ status: 'running', updatedAt: now - GEN_AI_TRACKING_TIMEOUT_MS }, now))
      .toBe(true);
  });

  it('never classifies a terminal job as a tracking timeout', () => {
    expect(generationTrackingTimedOut({ status: 'failed', updatedAt: 0 }, GEN_AI_TRACKING_TIMEOUT_MS))
      .toBe(false);
  });
});
