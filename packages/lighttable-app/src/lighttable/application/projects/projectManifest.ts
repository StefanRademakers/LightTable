export const LIGHTTABLE_PROJECT_FORMAT = 'lighttable-project' as const;
export const LIGHTTABLE_PROJECT_VERSION = 2 as const;
export const LIGHTTABLE_PROJECT_MANIFEST_NAME = 'project.ltproject' as const;

export const PROJECT_STORAGE_LOCATIONS = [
  'aiRenders', 'aiHistory', 'aiInput', 'characters', 'props',
  'environments', 'sets', 'trash', 'cache', 'thumbnails', 'indexes', 'temp'
] as const;

export type ProjectStorageLocation = typeof PROJECT_STORAGE_LOCATIONS[number];
export const PROJECT_USER_STORAGE_LOCATIONS = [
  'characters', 'props', 'environments', 'sets'
] as const;
export type ProjectUserStorageLocation = typeof PROJECT_USER_STORAGE_LOCATIONS[number];
export type ProjectFolderMappings = Readonly<Record<ProjectStorageLocation, string>>;
export interface ProjectUserFolder {
  readonly name: string;
  readonly path: string;
}

export interface ProjectLastUsedDocument {
  readonly assetId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly updatedAt: string;
}

export const DEFAULT_PROJECT_FOLDER_MAPPINGS: ProjectFolderMappings = {
  aiRenders: 'AiRenders',
  aiHistory: 'AiRenders/History',
  aiInput: 'AiRenders/Input',
  characters: 'Characters',
  props: 'Props',
  environments: 'Environments',
  sets: 'Sets',
  trash: 'Trash',
  cache: '.lighttable/cache',
  thumbnails: '.lighttable/thumbnails',
  indexes: '.lighttable/indexes',
  temp: '.lighttable/temp'
};

export interface LightTableProjectManifest {
  readonly format: typeof LIGHTTABLE_PROJECT_FORMAT;
  readonly version: typeof LIGHTTABLE_PROJECT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly folders: ProjectFolderMappings;
  readonly userFolders: readonly ProjectUserFolder[];
  readonly lastUsedDocument: ProjectLastUsedDocument | null;
}

const normalizedRelativeFolder = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) return null;
  const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (normalized.startsWith('/') || normalized.endsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\0-\x1f]/.test(part))) return null;
  return parts.join('/');
};

export const normalizeProjectUserFolders = (value: unknown): readonly ProjectUserFolder[] | null => {
  if (!Array.isArray(value) || value.length > 64) return null;
  const folders: ProjectUserFolder[] = [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const candidate = entry as Record<string, unknown>;
    if (Object.keys(candidate).length !== 2 || typeof candidate.name !== 'string') return null;
    const name = candidate.name.trim();
    const relativePath = normalizedRelativeFolder(candidate.path);
    if (!name || name.length > 128 || !relativePath) return null;
    const identity = relativePath.toLocaleLowerCase('en-US');
    if (paths.has(identity)) return null;
    paths.add(identity);
    folders.push({ name, path: relativePath });
  }
  return folders;
};

export const normalizeProjectFolderMappings = (value: unknown): ProjectFolderMappings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== PROJECT_STORAGE_LOCATIONS.length
    || Object.keys(candidate).some((key) => !PROJECT_STORAGE_LOCATIONS.includes(key as ProjectStorageLocation))) {
    return null;
  }
  const entries = PROJECT_STORAGE_LOCATIONS.map((location) => {
    const normalized = normalizedRelativeFolder(candidate[location]);
    return normalized ? [location, normalized] as const : null;
  });
  return entries.every((entry) => entry !== null)
    ? Object.fromEntries(entries as readonly (readonly [ProjectStorageLocation, string])[]) as ProjectFolderMappings
    : null;
};

export const parseLightTableProjectManifest = (value: unknown): LightTableProjectManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The project manifest is not an object.');
  }
  const candidate = value as Record<string, unknown>;
  const manifestKeys = ['format', 'version', 'id', 'name', 'createdAt', 'folders', 'userFolders', 'lastUsedDocument'];
  const requiredManifestKeys = manifestKeys;
  if (requiredManifestKeys.some((key) => !(key in candidate))
    || Object.keys(candidate).some((key) => !manifestKeys.includes(key))) {
    throw new Error('The project manifest contains unsupported fields.');
  }
  if (candidate.format !== LIGHTTABLE_PROJECT_FORMAT || candidate.version !== LIGHTTABLE_PROJECT_VERSION) {
    throw new Error('This is not a supported LightTable project.');
  }
  if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(candidate.id)) {
    throw new Error('The project ID is invalid.');
  }
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 255) {
    throw new Error('The project name is invalid.');
  }
  if (typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) {
    throw new Error('The project creation date is invalid.');
  }
  const folders = normalizeProjectFolderMappings(candidate.folders);
  if (!folders) throw new Error('The project folder mappings are invalid.');
  const userFolders = normalizeProjectUserFolders(candidate.userFolders);
  if (!userFolders) throw new Error('The project user folders are invalid.');
  let lastUsedDocument: ProjectLastUsedDocument | null = null;
  if (candidate.lastUsedDocument !== null) {
    if (!candidate.lastUsedDocument || typeof candidate.lastUsedDocument !== 'object'
      || Array.isArray(candidate.lastUsedDocument)) throw new Error('The last used project document is invalid.');
    const last = candidate.lastUsedDocument as Record<string, unknown>;
    if (Object.keys(last).length !== 4 || typeof last.assetId !== 'string'
      || !/^[a-f0-9]{24}$/.test(last.assetId) || typeof last.name !== 'string'
      || !last.name.trim() || last.name.length > 255 || typeof last.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(last.updatedAt))) throw new Error('The last used project document is invalid.');
    const relativePath = normalizedRelativeFolder(last.relativePath);
    if (!relativePath) throw new Error('The last used project document path is invalid.');
    lastUsedDocument = {
      assetId: last.assetId,
      relativePath,
      name: last.name.trim(),
      updatedAt: last.updatedAt
    };
  }
  return {
    format: LIGHTTABLE_PROJECT_FORMAT,
    version: LIGHTTABLE_PROJECT_VERSION,
    id: candidate.id,
    name: candidate.name.trim(),
    createdAt: candidate.createdAt,
    folders,
    userFolders,
    lastUsedDocument
  };
};

export const createLightTableProjectManifest = (input: {
  readonly id: string;
  readonly name: string;
  readonly createdAt?: string;
  readonly folders?: ProjectFolderMappings;
  readonly userFolders?: readonly ProjectUserFolder[];
  readonly lastUsedDocument?: ProjectLastUsedDocument | null;
}): LightTableProjectManifest => parseLightTableProjectManifest({
  format: LIGHTTABLE_PROJECT_FORMAT,
  version: LIGHTTABLE_PROJECT_VERSION,
  id: input.id,
  name: input.name,
  createdAt: input.createdAt ?? new Date().toISOString(),
  folders: input.folders ?? DEFAULT_PROJECT_FOLDER_MAPPINGS,
  userFolders: input.userFolders ?? [],
  lastUsedDocument: input.lastUsedDocument ?? null
});

export const projectStorageRelativePath = (
  manifest: LightTableProjectManifest,
  location: ProjectStorageLocation
): string => manifest.folders[location];
