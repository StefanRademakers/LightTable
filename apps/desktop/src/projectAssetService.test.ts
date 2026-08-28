import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectOnDisk } from './projectService';
import {
  LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT,
  readProjectAsset,
  readProjectAssetDirectories,
  rebuildProjectAssetIndex,
  recordSavedProjectAsset,
  type ProjectAssetIndex
} from './projectAssetService';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'lighttable-project-assets-'));
  roots.push(parent);
  const rootPath = path.join(parent, 'Catalog Test');
  await mkdir(rootPath);
  const project = await createProjectOnDisk({ rootPath });
  const filePath = path.join(project.rootPath, 'Characters', 'hero-lighttable.png');
  await writeFile(filePath, new Uint8Array([1, 2, 3]));
  return { project, filePath };
};

const readIndex = async (rootPath: string): Promise<ProjectAssetIndex> => JSON.parse(
  await readFile(path.join(rootPath, '.lighttable', 'indexes', 'assets-v1.json'), 'utf8')
) as ProjectAssetIndex;

describe('project asset save indexing', () => {
  it('writes an aspect-preserving thumbnail artifact and upserts one asset entry', async () => {
    const { project, filePath } = await fixture();
    const firstThumbnail = new Uint8Array([137, 80, 78, 71, 1]);
    expect(await recordSavedProjectAsset({
      manifestPath: project.manifestPath,
      filePath,
      thumbnailPng: async () => firstThumbnail
    })).toBe(true);

    let index = await readIndex(project.rootPath);
    expect(index.format).toBe(LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT);
    expect(index.assets).toHaveLength(1);
    expect(index.assets[0]?.path).toBe('Characters/hero-lighttable.png');
    const thumbnail = index.assets[0]?.thumbnail;
    expect(thumbnail).toBeTruthy();
    const thumbnailPath = path.join(project.rootPath, ...thumbnail!.split('/'));
    expect(new Uint8Array(await readFile(thumbnailPath))).toEqual(firstThumbnail);

    await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5]));
    await recordSavedProjectAsset({
      manifestPath: project.manifestPath,
      filePath,
      thumbnailPng: async () => new Uint8Array([137, 80, 78, 71, 2])
    });
    index = await readIndex(project.rootPath);
    expect(index.assets).toHaveLength(1);
    expect(index.assets[0]?.bytes).toBe(5);
  });

  it('preserves concurrently imported base and mask assets in the shared index', async () => {
    const { project, filePath: basePath } = await fixture();
    const maskPath = path.join(project.rootPath, 'Characters', 'selection-mask.png');
    await writeFile(maskPath, new Uint8Array([4, 5, 6]));

    await Promise.all([
      recordSavedProjectAsset({
        manifestPath: project.manifestPath,
        filePath: basePath,
        thumbnailPng: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return new Uint8Array([137, 80, 78, 71, 1]);
        }
      }),
      recordSavedProjectAsset({
        manifestPath: project.manifestPath,
        filePath: maskPath,
        thumbnailPng: async () => new Uint8Array([137, 80, 78, 71, 2])
      })
    ]);

    const index = await readIndex(project.rootPath);
    expect(index.assets.map(({ path: assetPath }) => assetPath)).toEqual([
      'Characters/hero-lighttable.png',
      'Characters/selection-mask.png'
    ]);
    await expect(readProjectAsset(project.manifestPath, index.assets[0]!.id)).resolves.not.toBeNull();
    await expect(readProjectAsset(project.manifestPath, index.assets[1]!.id)).resolves.not.toBeNull();
  });

  it('does not index saves outside the active project', async () => {
    const { project } = await fixture();
    const externalFile = path.join(path.dirname(project.rootPath), 'external.png');
    await writeFile(externalFile, new Uint8Array([1]));
    expect(await recordSavedProjectAsset({
      manifestPath: project.manifestPath,
      filePath: externalFile,
      thumbnailPng: async () => new Uint8Array([1])
    })).toBe(false);
    await expect(stat(path.join(project.rootPath, '.lighttable', 'indexes', 'assets-v1.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('loads a full indexed asset by opaque ID without exposing its path to the renderer', async () => {
    const { project, filePath } = await fixture();
    await recordSavedProjectAsset({
      manifestPath: project.manifestPath,
      filePath,
      thumbnailPng: async () => new Uint8Array([137, 80, 78, 71])
    });
    const [entry] = (await readIndex(project.rootPath)).assets;
    await expect(readProjectAsset(project.manifestPath, entry!.id)).resolves.toEqual({
      name: 'hero-lighttable.png',
      bytes: new Uint8Array([1, 2, 3])
    });
    await expect(readProjectAsset(project.manifestPath, '../outside')).rejects.toThrow('identifier');
  });

  it('scans custom project folders and removes deleted assets without indexing Trash', async () => {
    const { project, filePath } = await fixture();
    const customDirectory = path.join(project.rootPath, 'My Custom References');
    await mkdir(customDirectory);
    const customFile = path.join(customDirectory, 'reference.jpg');
    await writeFile(customFile, new Uint8Array([4, 5, 6]));
    const trashedFile = path.join(project.rootPath, 'Trash', 'discarded.png');
    await writeFile(trashedFile, new Uint8Array([7, 8, 9]));

    let index = await rebuildProjectAssetIndex({
      manifestPath: project.manifestPath,
      thumbnailPng: async () => new Uint8Array([137, 80, 78, 71])
    });
    expect(index.assets.map((entry) => entry.path)).toEqual([
      'Characters/hero-lighttable.png',
      'My Custom References/reference.jpg'
    ]);

    await rm(filePath);
    index = await rebuildProjectAssetIndex({
      manifestPath: project.manifestPath,
      thumbnailPng: async () => new Uint8Array([137, 80, 78, 71])
    });
    expect(index.assets.map((entry) => entry.path)).toEqual(['My Custom References/reference.jpg']);
  });

  it('catalogs real project directories independently from indexed assets or providers', async () => {
    const { project } = await fixture();
    await mkdir(path.join(project.rootPath, 'ExtraFolder'));
    const directories = await readProjectAssetDirectories(project.manifestPath);
    expect(directories.map(({ label }) => label)).toEqual([
      'History',
      'Characters',
      'Environments',
      'ExtraFolder',
      'Props',
      'Sets'
    ]);
  });
});
