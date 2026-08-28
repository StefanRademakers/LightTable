import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPLICATION_PREFERENCES,
  BUILT_IN_LOCAL_AI_PROVIDER_ID,
  LIGHTTABLE_PREFERENCES_STORAGE_KEY,
  loadApplicationPreferences,
  normalizeAiProviderConfigs,
  parseApplicationPreferences,
  saveApplicationPreferences
} from './applicationPreferences';
import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  PROJECT_USER_STORAGE_LOCATIONS
} from '../lighttable/application/projects/projectManifest';

describe('application preferences', () => {
  it('accepts the current strict alpha contract', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: {
        zoomWithScrollWheel: false,
        openMaskEditingOnDoubleClick: false,
        preserveTransformLocalAxes: true
      },
      projects: {
        folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, characters: 'Cast' },
        createFolders: ['characters', 'sets'],
        userFolders: [{ name: 'Refs', path: 'Production/Refs' }]
      },
      genAi: DEFAULT_APPLICATION_PREFERENCES.genAi
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: {
        zoomWithScrollWheel: false,
        openMaskEditingOnDoubleClick: false,
        preserveTransformLocalAxes: true
      },
      projects: {
        folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, characters: 'Cast' },
        createFolders: ['characters', 'sets'],
        userFolders: [{ name: 'Refs', path: 'Production/Refs' }]
      },
      genAi: DEFAULT_APPLICATION_PREFERENCES.genAi
    });
  });

  it('fills new alpha preferences without discarding valid saved settings', () => {
    expect(parseApplicationPreferences({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 }
    })).toEqual({
      version: 1,
      autosave: { enabled: false, intervalMs: 120_000 },
      tools: {
        zoomWithScrollWheel: true,
        openMaskEditingOnDoubleClick: true,
        preserveTransformLocalAxes: true
      },
      projects: {
        folders: DEFAULT_PROJECT_FOLDER_MAPPINGS,
        createFolders: PROJECT_USER_STORAGE_LOCATIONS,
        userFolders: []
      },
      genAi: DEFAULT_APPLICATION_PREFERENCES.genAi
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
          ai: 'Custom AI',
          aiHistory: 'Custom History',
          trash: 'Custom Trash',
          cache: 'Custom Cache'
        }
      }
    });
    expect(parsed.projects.folders.ai).toBe(DEFAULT_PROJECT_FOLDER_MAPPINGS.ai);
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

  it('normalizes independent HTTP providers without carrying the pre-alpha local shape', () => {
    const providers = normalizeAiProviderConfigs([
      {
        id: 'studio-box', displayName: 'Studio box', enabled: true,
        transport: { type: 'http', baseUrl: 'http://localhost:9000/', timeoutMs: 400 }
      },
      {
        id: 'remote-lab', displayName: 'Remote lab', enabled: false,
        transport: { type: 'http', baseUrl: 'https://ai.example.test/api', timeoutMs: 999_999,
          allowRemote: true }
      }
    ]);
    expect(providers.map(({ id }) => id)).toEqual([
      BUILT_IN_LOCAL_AI_PROVIDER_ID, 'studio-box', 'remote-lab'
    ]);
    expect(providers[1]?.transport).toMatchObject({ baseUrl: 'http://localhost:9000', timeoutMs: 1_000 });
    expect(providers[2]?.transport).toMatchObject({ timeoutMs: 300_000, allowRemote: true });
  });

  it('rejects invalid provider URLs and remote auto-start configurations', () => {
    const providers = normalizeAiProviderConfigs([
      {
        id: BUILT_IN_LOCAL_AI_PROVIDER_ID, displayName: 'Unsafe managed runtime', enabled: true,
        transport: { type: 'http', baseUrl: 'https://example.test', timeoutMs: 30_000 },
        localProcess: { autoStart: true }
      },
      {
        id: 'credentials-in-url', displayName: 'Invalid', enabled: true,
        transport: { type: 'http', baseUrl: 'https://user:secret@example.test', timeoutMs: 30_000 }
      }
    ]);
    expect(providers).toEqual([DEFAULT_APPLICATION_PREFERENCES.genAi.providers[0]]);
  });
});
