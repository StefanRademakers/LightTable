import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPLICATION_PREFERENCES,
  LIGHTTABLE_PREFERENCES_STORAGE_KEY,
  loadApplicationPreferences,
  parseApplicationPreferences,
  saveApplicationPreferences
} from './applicationPreferences';

describe('application preferences', () => {
  it('accepts the current strict alpha contract', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: false }
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: false }
    });
  });

  it('fills new alpha preferences without discarding valid saved settings', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 }
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: true, openMaskEditingOnDoubleClick: true }
    });
  });

  it('falls back atomically for malformed or unsupported settings', () => {
    expect(parseApplicationPreferences({ version: 2, autosave: {} }))
      .toEqual(DEFAULT_APPLICATION_PREFERENCES);
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: true, intervalMs: 30_000 },
      tools: null
    })).toEqual(DEFAULT_APPLICATION_PREFERENCES);
    expect(loadApplicationPreferences({ getItem: () => '{broken' }))
      .toEqual(DEFAULT_APPLICATION_PREFERENCES);
  });

  it('persists one canonical preferences object', () => {
    const writes: Record<string, string> = {};
    saveApplicationPreferences(DEFAULT_APPLICATION_PREFERENCES, {
      setItem: (key, value) => { writes[key] = value; }
    });
    expect(JSON.parse(writes[LIGHTTABLE_PREFERENCES_STORAGE_KEY]!))
      .toEqual(DEFAULT_APPLICATION_PREFERENCES);
  });
});
