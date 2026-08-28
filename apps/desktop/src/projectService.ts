import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createLightTableProjectManifest,
  LIGHTTABLE_PROJECT_MANIFEST_NAME,
  parseLightTableProjectManifest,
  PROJECT_STORAGE_LOCATIONS,
  PROJECT_USER_STORAGE_LOCATIONS,
  type LightTableProjectManifest,
  type ProjectLastUsedDocument,
  type ProjectFolderMappings,
  type ProjectUserFolder,
  type ProjectStorageLocation,
  type ProjectUserStorageLocation
} from '@lighttable/app/project-manifest';
import { atomicWriteFile } from './atomicFileWriter';
import { readBoundedJsonFile } from './boundedJsonFile';

export interface DesktopProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly lastUsedDocument: ProjectLastUsedDocument | null;
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_PROJECT_MANIFEST_BYTES = 1024 * 1024;

const readProjectManifestJson = (manifestPath: string): Promise<unknown> =>
  readBoundedJsonFile(manifestPath, MAX_PROJECT_MANIFEST_BYTES, 'LightTable project manifest');

export const validateProjectName = (value: string): string => {
  const name = value.trim();
  if (!name || name.length > 255) throw new Error('Enter a project name between 1 and 255 characters.');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    throw new Error('The project name contains characters that cannot be used in a folder name.');
  }
  return name;
};

const containedPath = (rootPath: string, relativePath: string): string => {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The project folder mapping escapes the project root.');
  }
  return resolved;
};

export const resolveProjectStoragePath = (
  rootPath: string,
  manifest: LightTableProjectManifest,
  location: ProjectStorageLocation
): string => containedPath(rootPath, manifest.folders[location]);

export const openProjectManifest = async (manifestPath: string): Promise<{
  readonly manifest: LightTableProjectManifest;
  readonly summary: DesktopProjectSummary;
}> => {
  const resolvedManifestPath = path.resolve(manifestPath);
  if (path.basename(resolvedManifestPath).toLocaleLowerCase('en-US') !== LIGHTTABLE_PROJECT_MANIFEST_NAME) {
    throw new Error(`Select a ${LIGHTTABLE_PROJECT_MANIFEST_NAME} file.`);
  }
  const manifest = parseLightTableProjectManifest(await readProjectManifestJson(resolvedManifestPath));
  const rootPath = path.dirname(resolvedManifestPath);
  for (const location of PROJECT_STORAGE_LOCATIONS) resolveProjectStoragePath(rootPath, manifest, location);
  return {
    manifest,
    summary: {
      id: manifest.id,
      name: manifest.name,
      rootPath,
      manifestPath: resolvedManifestPath,
      lastUsedDocument: manifest.lastUsedDocument
    }
  };
};

export const setProjectLastUsedDocument = async (
  manifestPath: string,
  lastUsedDocument: ProjectLastUsedDocument
): Promise<DesktopProjectSummary> => {
  const { manifest } = await openProjectManifest(manifestPath);
  const next: LightTableProjectManifest = { ...manifest, lastUsedDocument };
  const bytes = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
  await atomicWriteFile({
    targetPath: path.resolve(manifestPath),
    bytes,
    validate: async (temporaryPath) => {
      parseLightTableProjectManifest(await readProjectManifestJson(temporaryPath));
    }
  });
  return (await openProjectManifest(manifestPath)).summary;
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await stat(candidate);
    return true;
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') return false;
    throw reason;
  }
};

export const createProjectOnDisk = async (request: {
  readonly name: string;
  readonly parentPath: string;
  readonly id?: string;
  readonly createdAt?: string;
  readonly folders?: ProjectFolderMappings;
  readonly createFolders?: readonly ProjectUserStorageLocation[];
  readonly userFolders?: readonly ProjectUserFolder[];
}): Promise<DesktopProjectSummary> => {
  const name = validateProjectName(request.name);
  const parentPath = path.resolve(request.parentPath);
  if (!(await stat(parentPath)).isDirectory()) throw new Error('The project location is not a folder.');
  const targetPath = path.join(parentPath, name);
  if (await pathExists(targetPath)) throw new Error(`A file or folder named "${name}" already exists.`);

  const stagingPath = path.join(parentPath, `.${name}.lighttable-create-${randomUUID()}`);
  const manifest = createLightTableProjectManifest({
    id: request.id ?? randomUUID(),
    name,
    createdAt: request.createdAt,
    folders: request.folders,
    userFolders: request.userFolders
  });
  if (request.createFolders
    && (request.createFolders.some((location) => !PROJECT_USER_STORAGE_LOCATIONS.includes(location))
      || new Set(request.createFolders).size !== request.createFolders.length)) {
    throw new Error('The project creation folder selection is invalid.');
  }

  try {
    await mkdir(stagingPath);
    const enabledUserFolders = new Set(request.createFolders ?? PROJECT_USER_STORAGE_LOCATIONS);
    const directories = new Set(PROJECT_STORAGE_LOCATIONS
      .filter((location) => !PROJECT_USER_STORAGE_LOCATIONS.includes(location as ProjectUserStorageLocation)
        || enabledUserFolders.has(location as ProjectUserStorageLocation))
      .map(
      (location) => resolveProjectStoragePath(stagingPath, manifest, location)
    ));
    manifest.userFolders.forEach((folder) => directories.add(containedPath(stagingPath, folder.path)));
    await Promise.all([...directories].map((directory) => mkdir(directory, { recursive: true })));
    await writeFile(path.join(stagingPath, '.lighttable', '.gitignore'), '*\n!.gitignore\n', 'utf8');
    await writeFile(
      path.join(stagingPath, LIGHTTABLE_PROJECT_MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    await rename(stagingPath, targetPath);
  } catch (reason) {
    await rm(stagingPath, { recursive: true, force: true });
    throw reason;
  }

  return (await openProjectManifest(path.join(targetPath, LIGHTTABLE_PROJECT_MANIFEST_NAME))).summary;
};
