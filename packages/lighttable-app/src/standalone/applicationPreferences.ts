import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  normalizeProjectFolderMappings,
  normalizeProjectUserFolders,
  type ProjectFolderMappings,
  type ProjectUserFolder,
  PROJECT_USER_STORAGE_LOCATIONS,
  type ProjectUserStorageLocation
} from '../lighttable/application/projects/projectManifest';
import type { LightTableAiProviderConfig } from '../platform/LightTableHost';

export const LIGHTTABLE_PREFERENCES_STORAGE_KEY = 'lighttable:preferences';

export interface ApplicationPreferences {
  readonly version: 1;
  readonly autosave: {
    readonly enabled: boolean;
    readonly intervalMs: number;
  };
  readonly tools: {
    readonly zoomWithScrollWheel: boolean;
    readonly openMaskEditingOnDoubleClick: boolean;
    /** Keep the confirmed oriented transform frame instead of starting from document axes. */
    readonly preserveTransformLocalAxes: boolean;
  };
  readonly projects: {
    readonly folders: ProjectFolderMappings;
    /** Standard semantic folders created for new projects. Existing projects are never changed. */
    readonly createFolders: readonly ProjectUserStorageLocation[];
    readonly userFolders: readonly ProjectUserFolder[];
  };
  readonly genAi: {
    /** Shared composer defaults; provider adapters own request translation. */
    readonly createProviderId: string;
    readonly editProviderId: string;
    readonly providers: readonly LightTableAiProviderConfig[];
  };
}

export const BUILT_IN_LOCAL_AI_PROVIDER_ID = 'lighttable-local';

export const DEFAULT_LOCAL_AI_PROVIDER: LightTableAiProviderConfig = {
  id: BUILT_IN_LOCAL_AI_PROVIDER_ID,
  displayName: 'Free Local AI',
  enabled: true,
  transport: { type: 'http', baseUrl: 'http://127.0.0.1:7862', timeoutMs: 30_000 },
  localProcess: { autoStart: true }
};

export const DEFAULT_APPLICATION_PREFERENCES: ApplicationPreferences = {
  version: 1,
  autosave: {
    enabled: true,
    intervalMs: 30_000
  },
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
  genAi: {
    createProviderId: 'openart',
    editProviderId: 'openart',
    providers: [DEFAULT_LOCAL_AI_PROVIDER]
  }
};

const AUTOSAVE_INTERVALS = new Set([30_000, 60_000, 120_000, 300_000, 600_000]);

export const normalizeProjectPreferenceFolders = (value: unknown): ProjectFolderMappings | null => {
  const folders = normalizeProjectFolderMappings(value);
  if (!folders) return null;
  return {
    ...DEFAULT_PROJECT_FOLDER_MAPPINGS,
    characters: folders.characters,
    props: folders.props,
    environments: folders.environments,
    sets: folders.sets
  };
};

export const parseApplicationPreferences = (value: unknown): ApplicationPreferences => {
  if (!value || typeof value !== 'object') return DEFAULT_APPLICATION_PREFERENCES;
  const candidate = value as Partial<ApplicationPreferences>;
  if (candidate.version !== 1 || !candidate.autosave
    || typeof candidate.autosave.enabled !== 'boolean'
    || !AUTOSAVE_INTERVALS.has(candidate.autosave.intervalMs)
    || (candidate.tools !== undefined && (
      !candidate.tools
      || typeof candidate.tools !== 'object'
      || typeof candidate.tools.zoomWithScrollWheel !== 'boolean'
      || typeof candidate.tools.openMaskEditingOnDoubleClick !== 'boolean'
      || (candidate.tools.preserveTransformLocalAxes !== undefined
        && typeof candidate.tools.preserveTransformLocalAxes !== 'boolean')
    ))
    || (candidate.projects !== undefined && (
      !candidate.projects
      || typeof candidate.projects !== 'object'
      || !normalizeProjectPreferenceFolders(candidate.projects.folders)
      || (candidate.projects.userFolders !== undefined
        && !normalizeProjectUserFolders(candidate.projects.userFolders))
    ))) {
    return DEFAULT_APPLICATION_PREFERENCES;
  }
  const projectFolders = candidate.projects
    ? normalizeProjectPreferenceFolders(candidate.projects.folders)
    : DEFAULT_PROJECT_FOLDER_MAPPINGS;
  if (!projectFolders) return DEFAULT_APPLICATION_PREFERENCES;
  const requestedCreateFolders = candidate.projects?.createFolders;
  const createFolders = requestedCreateFolders === undefined
    ? PROJECT_USER_STORAGE_LOCATIONS
    : Array.isArray(requestedCreateFolders)
      && requestedCreateFolders.every((location) => PROJECT_USER_STORAGE_LOCATIONS.includes(location))
      && new Set(requestedCreateFolders).size === requestedCreateFolders.length
      ? PROJECT_USER_STORAGE_LOCATIONS.filter((location) => requestedCreateFolders.includes(location))
      : null;
  if (!createFolders) return DEFAULT_APPLICATION_PREFERENCES;
  const providers = normalizeAiProviderConfigs(candidate.genAi?.providers);
  return {
    version: 1,
    autosave: {
      enabled: candidate.autosave.enabled,
      intervalMs: candidate.autosave.intervalMs
    },
    tools: {
      zoomWithScrollWheel: candidate.tools?.zoomWithScrollWheel ?? true,
      openMaskEditingOnDoubleClick: candidate.tools?.openMaskEditingOnDoubleClick ?? true,
      preserveTransformLocalAxes: candidate.tools?.preserveTransformLocalAxes ?? true
    },
    projects: {
      folders: projectFolders,
      createFolders,
      userFolders: normalizeProjectUserFolders(candidate.projects?.userFolders ?? []) ?? []
    },
    genAi: {
      createProviderId: typeof candidate.genAi?.createProviderId === 'string'
        && candidate.genAi.createProviderId.trim()
        ? candidate.genAi.createProviderId.trim()
        : DEFAULT_APPLICATION_PREFERENCES.genAi.createProviderId,
      editProviderId: typeof candidate.genAi?.editProviderId === 'string'
        && candidate.genAi.editProviderId.trim()
        ? candidate.genAi.editProviderId.trim()
        : DEFAULT_APPLICATION_PREFERENCES.genAi.editProviderId,
      providers
    }
  };
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const normalizeAiProviderConfigs = (value: unknown): readonly LightTableAiProviderConfig[] => {
  if (value === undefined) return [DEFAULT_LOCAL_AI_PROVIDER];
  if (!Array.isArray(value)) return [DEFAULT_LOCAL_AI_PROVIDER];
  const seen = new Set<string>();
  const normalized: LightTableAiProviderConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<LightTableAiProviderConfig>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const displayName = typeof candidate.displayName === 'string' ? candidate.displayName.trim() : '';
    const transport = candidate.transport;
    if (!id || !displayName || seen.has(id) || !transport || transport.type !== 'http') continue;
    let url: URL;
    try { url = new URL(transport.baseUrl); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.username || url.password || url.search || url.hash) continue;
    const timeoutMs = Number.isFinite(transport.timeoutMs)
      ? Math.min(300_000, Math.max(1_000, Math.round(transport.timeoutMs))) : 30_000;
    const autoStart = id === BUILT_IN_LOCAL_AI_PROVIDER_ID && candidate.localProcess?.autoStart === true;
    if (autoStart && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) continue;
    seen.add(id);
    normalized.push({
      id,
      displayName,
      enabled: candidate.enabled !== false,
      transport: {
        type: 'http',
        baseUrl: url.toString().replace(/\/$/u, ''),
        ...(typeof transport.apiToken === 'string' && transport.apiToken ? { apiToken: transport.apiToken } : {}),
        timeoutMs,
        ...(transport.allowRemote === true ? { allowRemote: true } : {})
      },
      ...(id === BUILT_IN_LOCAL_AI_PROVIDER_ID ? { localProcess: { autoStart } } : {}),
      ...(candidate.defaults ? { defaults: {
        ...(typeof candidate.defaults.createModelId === 'string' && candidate.defaults.createModelId
          ? { createModelId: candidate.defaults.createModelId } : {}),
        ...(typeof candidate.defaults.editModelId === 'string' && candidate.defaults.editModelId
          ? { editModelId: candidate.defaults.editModelId } : {})
      } } : {})
    });
  }
  if (!seen.has(BUILT_IN_LOCAL_AI_PROVIDER_ID)) normalized.unshift(DEFAULT_LOCAL_AI_PROVIDER);
  return normalized;
};

export const loadApplicationPreferences = (
  storage: Pick<Storage, 'getItem'> = localStorage
): ApplicationPreferences => {
  try {
    const value = storage.getItem(LIGHTTABLE_PREFERENCES_STORAGE_KEY);
    return value ? parseApplicationPreferences(JSON.parse(value)) : DEFAULT_APPLICATION_PREFERENCES;
  } catch {
    return DEFAULT_APPLICATION_PREFERENCES;
  }
};

export const saveApplicationPreferences = (
  preferences: ApplicationPreferences,
  storage: Pick<Storage, 'setItem'> = localStorage
): void => storage.setItem(LIGHTTABLE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
