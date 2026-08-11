import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPLICATION_PREFERENCES,
  LIGHTTABLE_PREFERENCES_STORAGE_KEY,
  loadApplicationPreferences,
  parseApplicationPreferences,
  saveApplicationPreferences
} from './applicationPreferences';
import { DEFAULT_PROJECT_FOLDER_MAPPINGS } from '../lighttable/application/projects/projectManifest';

describe('application preferences', () => {
  it('accepts the current strict alpha contract', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: false },
      projects: { folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, characters: 'Cast' }, userFolders: [{ name: 'Refs', path: 'Production/Refs' }] }
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: false },
      projects: { folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, characters: 'Cast' }, userFolders: [{ name: 'Refs', path: 'Production/Refs' }] }
    });
  });

  it('fills new alpha preferences without discarding valid saved settings', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 }
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: { zoomWithScrollWheel: true, openMaskEditingOnDoubleClick: true },
      projects: { folders: DEFAULT_PROJECT_FOLDER_MAPPINGS, userFolders: [] }
    });
  });

  it('rejects project mappings that escape the project root', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: true, intervalMs: 30_000 },
      tools: { zoomWithScrollWheel: true, openMaskEditingOnDoubleClick: true },
      projects: { folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, props: '../Props' } }
    })).toEqual(DEFAULT_APPLICATION_PREFERENCES);
  });

  it('keeps AI and technical project folders system-managed', () => {
    const parsed = parseApplicationPreferences({
      version: 1,
      autosave: { enabled: true, intervalMs: 30_000 },
      tools: { zoomWithScrollWheel: true, openMaskEditingOnDoubleClick: true },
      projects: {
        folders: {
          ...DEFAULT_PROJECT_FOLDER_MAPPINGS,
          aiRenders: 'Custom AI',
          aiHistory: 'Custom History',
          trash: 'Custom Trash',
          cache: 'Custom Cache'
        }
      }
    });
    expect(parsed.projects.folders.aiRenders).toBe(DEFAULT_PROJECT_FOLDER_MAPPINGS.aiRenders);
    expect(parsed.projects.folders.aiHistory).toBe(DEFAULT_PROJECT_FOLDER_MAPPINGS.aiHistory);
    expect(parsed.projects.folders.trash).toBe(DEFAULT_PROJECT_FOLDER_MAPPINGS.trash);
    expect(parsed.projects.folders.cache).toBe(DEFAULT_PROJECT_FOLDER_MAPPINGS.cache);
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
