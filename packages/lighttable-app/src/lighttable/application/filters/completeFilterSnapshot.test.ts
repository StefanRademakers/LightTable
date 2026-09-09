import { describe, expect, it } from 'vitest';
import {
  FILTER_DEFINITIONS,
  defaultFilterSettings
} from '@lighttable/filter-core';
import { parseCompleteFilterSnapshot } from './completeFilterSnapshot';

describe('complete filter snapshot codec', () => {
  it('accepts every catalog kind with exact complete canonical settings', () => {
    expect(FILTER_DEFINITIONS).toHaveLength(56);
    for (const { kind } of FILTER_DEFINITIONS) {
      const parsed = parseCompleteFilterSnapshot({
        kind, enabled: true, settings: defaultFilterSettings(kind)
      });
      expect(parsed?.kind).toBe(kind);
    }
  });

  it('rejects missing, extra, coerced, non-finite and out-of-range values', () => {
    expect(parseCompleteFilterSnapshot({
      kind: 'gaussian-blur', enabled: true, settings: {}
    })).toBeNull();
    expect(parseCompleteFilterSnapshot({
      kind: 'gaussian-blur', enabled: true, settings: { radius: 8, extra: true }
    })).toBeNull();
    expect(parseCompleteFilterSnapshot({
      kind: 'gaussian-blur', enabled: true, settings: { radius: '8' }
    })).toBeNull();
    expect(parseCompleteFilterSnapshot({
      kind: 'gaussian-blur', enabled: true, settings: { radius: Number.NaN }
    })).toBeNull();
    expect(parseCompleteFilterSnapshot({
      kind: 'gaussian-blur', enabled: true, settings: { radius: 101 }
    })).toBeNull();
  });
});
