import { describe, expect, it } from 'vitest';
import {
  formatGpuMemory,
  formatStartupTimings
} from './editorTelemetry';

describe('editor telemetry formatting', () => {
  it('formats only measured startup phases in pipeline order', () => {
    expect(formatStartupTimings({
      firstFrameMs: 438.6,
      webGpuMs: 101.2,
      downloadMs: 364.7
    })).toBe('WebGPU: 101 ms · download: 365 ms · first frame: 439 ms');
  });

  it('formats empty timing and memory values predictably', () => {
    expect(formatStartupTimings(null)).toBe('');
    expect(formatGpuMemory(0)).toBe('0 MB');
    expect(formatGpuMemory(192 * 1024 * 1024)).toBe('192 MB');
    expect(formatGpuMemory(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
  });
});
