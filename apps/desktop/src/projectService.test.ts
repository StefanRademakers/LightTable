import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  PROJECT_STORAGE_LOCATIONS
} from '@lighttable/app/project-manifest';
import {
  createProjectOnDisk,
  openProjectManifest,
  resolveProjectStoragePath,
  setProjectLastUsedDocument,
  validateProjectName
} from './projectService';

const temporaryRoots: string[] = [];
const temporaryRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-project-'));
  temporaryRoots.push(root);
  return root;
};
const projectRoot = async (name: string) => {
  const root = path.join(await temporaryRoot(), name);
  await mkdir(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop project service', () => {
  it('creates and reopens the complete deterministic project layout', async () => {
    const rootPath = await projectRoot('Campaign');
    const summary = await createProjectOnDisk({
      rootPath, id: 'project-12345678', createdAt: '2026-08-11T12:00:00Z'
    });
    const opened = await openProjectManifest(summary.manifestPath);
    expect(opened.summary).toEqual(summary);
    for (const location of PROJECT_STORAGE_LOCATIONS) {
      await expect(statDirectory(resolveProjectStoragePath(summary.rootPath, opened.manifest, location))).resolves.toBe(true);
    }
    expect(await readFile(path.join(summary.rootPath, '.lighttable', '.gitignore'), 'utf8'))
      .toBe('*\n!.gitignore\n');
  });

  it('adds project files to an existing folder without overwriting its contents', async () => {
    const rootPath = await projectRoot('Campaign');
    const existingFile = path.join(rootPath, 'brief.txt');
    await writeFile(existingFile, 'keep me', 'utf8');
    await createProjectOnDisk({ rootPath });
    expect(await readFile(existingFile, 'utf8')).toBe('keep me');
    await expect(createProjectOnDisk({ rootPath })).rejects.toThrow('already a LightTable project');
  });

  it('overwrites the canonical last-used document immediately', async () => {
    const summary = await createProjectOnDisk({ rootPath: await projectRoot('Campaign') });
    const first = {
      assetId: '0123456789abcdef01234567', relativePath: 'Sets/first.psd',
      name: 'first.psd', updatedAt: '2026-08-17T18:00:00.000Z'
    };
    const second = {
      assetId: 'fedcba9876543210fedcba98', relativePath: 'Sets/second.psd',
      name: 'second.psd', updatedAt: '2026-08-17T18:01:00.000Z'
    };
    await setProjectLastUsedDocument(summary.manifestPath, first);
    await setProjectLastUsedDocument(summary.manifestPath, second);
    const opened = await openProjectManifest(summary.manifestPath);
    expect(opened.manifest.lastUsedDocument).toEqual(second);
    expect(opened.summary.lastUsedDocument).toEqual(second);
  });

  it('creates new projects using requested user folder mappings', async () => {
    const rootPath = await projectRoot('Custom Structure');
    const summary = await createProjectOnDisk({
      rootPath,
      folders: {
        ...DEFAULT_PROJECT_FOLDER_MAPPINGS,
        characters: 'Assets/People',
        props: 'Assets/Objects'
      },
      userFolders: [
        { name: 'Moodboards', path: 'Production/Moodboards' },
        { name: 'Client exports', path: 'Delivery/Client' }
      ]
    });
    const opened = await openProjectManifest(summary.manifestPath);
    expect(opened.manifest.folders.characters).toBe('Assets/People');
    expect(opened.manifest.folders.props).toBe('Assets/Objects');
    await expect(statDirectory(path.join(summary.rootPath, 'Assets', 'People'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Assets', 'Objects'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Production', 'Moodboards'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Delivery', 'Client'))).resolves.toBe(true);
  });

  it('skips disabled template folders without changing their manifest mappings', async () => {
    const rootPath = await projectRoot('Lean Structure');
    const summary = await createProjectOnDisk({
      rootPath, createFolders: ['characters', 'sets']
    });
    const opened = await openProjectManifest(summary.manifestPath);
    expect(opened.manifest.folders.props).toBe('Props');
    await expect(statDirectory(path.join(summary.rootPath, 'Characters'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Sets'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Props'))).rejects.toThrow();
    await expect(statDirectory(path.join(summary.rootPath, 'Environments'))).rejects.toThrow();
    await expect(statDirectory(path.join(summary.rootPath, 'AI', 'References'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'AI', 'History'))).resolves.toBe(true);
    await expect(statDirectory(path.join(summary.rootPath, 'Trash'))).resolves.toBe(true);
  });

  it.each(['CON', 'bad/name', 'bad.', ''])('rejects unsafe project name %s', (name) => {
    expect(() => validateProjectName(name)).toThrow();
  });

  it('rejects a forged mapping that escapes the project root', async () => {
    const opened = await createProjectOnDisk({ rootPath: await projectRoot('Safe') });
    const manifest = (await openProjectManifest(opened.manifestPath)).manifest;
    expect(() => resolveProjectStoragePath(opened.rootPath, {
      ...manifest,
      folders: { ...manifest.folders, cache: '../outside' }
    }, 'cache')).toThrow('escapes');
  });
});

const statDirectory = async (candidate: string): Promise<boolean> =>
  (await import('node:fs/promises')).stat(candidate).then((entry) => entry.isDirectory());
