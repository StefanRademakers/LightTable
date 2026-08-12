import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  normalizeProjectFolderMappings,
  normalizeProjectUserFolders,
  type ProjectFolderMappings,
  type ProjectUserFolder,
  PROJECT_USER_STORAGE_LOCATIONS,
  type ProjectUserStorageLocation
} from '../lighttable/application/projects/projectManifest';

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
  };
  readonly projects: {
    readonly folders: ProjectFolderMappings;
    /** Standard semantic folders created for new projects. Existing projects are never changed. */
    readonly createFolders: readonly ProjectUserStorageLocation[];
    readonly userFolders: readonly ProjectUserFolder[];
  };
}

export const DEFAULT_APPLICATION_PREFERENCES: ApplicationPreferences = {
  version: 1,
  autosave: {
    enabled: true,
    intervalMs: 30_000
  },
  tools: {
    zoomWithScrollWheel: true,
    openMaskEditingOnDoubleClick: true
  },
  projects: {
    folders: DEFAULT_PROJECT_FOLDER_MAPPINGS,
    createFolders: PROJECT_USER_STORAGE_LOCATIONS,
    userFolders: []
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
  return {
    version: 1,
    autosave: {
      enabled: candidate.autosave.enabled,
      intervalMs: candidate.autosave.intervalMs
    },
    tools: {
      zoomWithScrollWheel: candidate.tools?.zoomWithScrollWheel ?? true,
      openMaskEditingOnDoubleClick: candidate.tools?.openMaskEditingOnDoubleClick ?? true
    },
    projects: {
      folders: projectFolders,
      createFolders,
      userFolders: normalizeProjectUserFolders(candidate.projects?.userFolders ?? []) ?? []
    }
  };
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
