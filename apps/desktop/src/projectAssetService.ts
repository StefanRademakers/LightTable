import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { open, readFile, readdir, stat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from './projectService';

export const LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT = 'lighttable-project-assets';
export const LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION = 1;

export interface ProjectAssetIndexEntry {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly modifiedAt: string;
  readonly thumbnail?: string;
  readonly thumbnailStatus: 'ready' | 'unavailable';
}

export interface ProjectAssetIndex {
  readonly format: typeof LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT;
  readonly version: typeof LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION;
  readonly updatedAt: string;
  readonly assets: readonly ProjectAssetIndexEntry[];
}

const saveQueues = new Map<string, Promise<void>>();
const PROJECT_ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.psd', '.psb', '.pdf'
]);

const normalizedProjectRelativePath = (rootPath: string, filePath: string): string | null => {
  const relative = path.relative(rootPath, path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const portable = relative.split(path.sep).join('/');
  return portable === '.lighttable' || portable.startsWith('.lighttable/') ? null : portable;
};

const assetId = (relativePath: string): string => createHash('sha256')
  .update(relativePath.toLocaleLowerCase('en-US'))
  .digest('hex')
  .slice(0, 24);

const emptyIndex = (): ProjectAssetIndex => ({
  format: LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT,
  version: LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION,
  updatedAt: new Date(0).toISOString(),
  assets: []
});

const loadIndex = async (indexPath: string): Promise<ProjectAssetIndex> => {
  try {
    const candidate = JSON.parse(await readFile(indexPath, 'utf8')) as Partial<ProjectAssetIndex>;
    if (
      candidate.format !== LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT
      || candidate.version !== LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION
      || !Array.isArray(candidate.assets)
    ) return emptyIndex();
    return candidate as ProjectAssetIndex;
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') {
      return emptyIndex();
    }
    throw reason;
  }
};

export const readProjectAssetIndex = async (manifestPath: string): Promise<{
  readonly rootPath: string;
  readonly index: ProjectAssetIndex;
}> => {
  const { manifest, summary } = await openProjectManifest(manifestPath);
  const indexPath = path.join(
    resolveProjectStoragePath(summary.rootPath, manifest, 'indexes'),
    'assets-v1.json'
  );
  return { rootPath: summary.rootPath, index: await loadIndex(indexPath) };
};

export const readProjectAssetPreview = async (
  manifestPath: string,
  requestedId: string
): Promise<Uint8Array | null> => {
  if (!/^[a-f0-9]{24}$/.test(requestedId)) throw new Error('Invalid project asset identifier.');
  const { rootPath, index } = await readProjectAssetIndex(manifestPath);
  const entry = index.assets.find(({ id }) => id === requestedId);
  if (!entry?.thumbnail) return null;
  const previewPath = path.resolve(rootPath, ...entry.thumbnail.split('/'));
  const previewRoot = path.resolve(rootPath, '.lighttable');
  if (previewPath !== previewRoot && !previewPath.startsWith(`${previewRoot}${path.sep}`)) {
    throw new Error('Invalid project asset preview location.');
  }
  return new Uint8Array(await readFile(previewPath));
};

export const readProjectAsset = async (
  manifestPath: string,
  requestedId: string
): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null> => {
  if (!/^[a-f0-9]{24}$/.test(requestedId)) throw new Error('Invalid project asset identifier.');
  const { rootPath, index } = await readProjectAssetIndex(manifestPath);
  const entry = index.assets.find(({ id }) => id === requestedId);
  if (!entry) return null;
  if (entry.bytes > 256 * 1024 * 1024) throw new Error('Project asset exceeds the 256 MiB transfer limit.');
  const assetPath = path.resolve(rootPath, ...entry.path.split('/'));
  const projectRoot = path.resolve(rootPath);
  if (assetPath === projectRoot || !assetPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error('Invalid project asset location.');
  }
  const bytes = new Uint8Array(await readFile(assetPath));
  if (bytes.byteLength !== entry.bytes || bytes.byteLength > 256 * 1024 * 1024) {
    throw new Error('Project asset changed while it was being loaded.');
  }
  return { name: entry.name, bytes };
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

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PREVIEW_BYTES = 256 * 1024 * 1024;

const readExactly = async (
  handle: FileHandle,
  length: number,
  position: number
): Promise<Buffer> => {
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error('The saved document preview is truncated.');
    offset += bytesRead;
  }
  return output;
};

const readEmbeddedPngPreview = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, 'r');
  try {
    const signature = await readExactly(handle, PNG_SIGNATURE.length, 0);
    if (!signature.equals(PNG_SIGNATURE)) throw new Error('The saved document has no PNG preview.');
    const parts: Buffer[] = [signature];
    let position = PNG_SIGNATURE.length;
    while (position < MAX_PREVIEW_BYTES) {
      const header = await readExactly(handle, 8, position);
      const dataLength = header.readUInt32BE(0);
      const chunkLength = 8 + dataLength + 4;
      if (position + chunkLength > MAX_PREVIEW_BYTES) {
        throw new Error('The saved document preview exceeds the thumbnail limit.');
      }
      const body = await readExactly(handle, dataLength + 4, position + 8);
      parts.push(header, body);
      position += chunkLength;
      if (header.toString('ascii', 4, 8) === 'IEND') return Buffer.concat(parts, position);
    }
    throw new Error('The saved document preview has no PNG end marker.');
  } finally {
    await handle.close();
  }
};

const createThumbnailPng = async (filePath: string): Promise<Uint8Array> => {
  const { nativeImage } = await import('electron');
  const extension = path.extname(filePath).toLocaleLowerCase('en-US');
  const image = extension === '.png'
    ? nativeImage.createFromBuffer(await readEmbeddedPngPreview(filePath))
    : await nativeImage.createThumbnailFromPath(filePath, { width: 256, height: 256 });
  if (image.isEmpty()) throw new Error('The saved document did not produce a thumbnail.');
  const size = image.getSize();
  const thumbnail = size.width >= size.height
    ? image.resize({ width: 256, quality: 'good' })
    : image.resize({ height: 256, quality: 'good' });
  return thumbnail.toPNG();
};

interface ProjectAssetContext {
  readonly rootPath: string;
  readonly thumbnailDirectory: string;
}

const buildAssetEntry = async (
  context: ProjectAssetContext,
  filePath: string,
  thumbnailPng: (filePath: string) => Promise<Uint8Array>,
  previous?: ProjectAssetIndexEntry
): Promise<ProjectAssetIndexEntry | null> => {
  const relativePath = normalizedProjectRelativePath(context.rootPath, filePath);
  if (!relativePath || !PROJECT_ASSET_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase('en-US'))) return null;
  const file = await stat(filePath);
  if (!file.isFile()) return null;
  const id = assetId(relativePath);
  const thumbnailPath = path.join(context.thumbnailDirectory, `${id}.png`);
  const modifiedAt = file.mtime.toISOString();
  if (
    previous?.bytes === file.size
    && previous.modifiedAt === modifiedAt
    && (
      previous.thumbnailStatus === 'unavailable'
      || Boolean(previous.thumbnail && await pathExists(path.join(context.rootPath, ...previous.thumbnail.split('/'))))
    )
  ) return previous;

  let thumbnail: string | undefined;
  try {
    const thumbnailBytes = await thumbnailPng(filePath);
    await atomicWriteFile({ targetPath: thumbnailPath, bytes: thumbnailBytes });
    thumbnail = path.relative(context.rootPath, thumbnailPath).split(path.sep).join('/');
  } catch (reason) {
    console.warn(`[LightTable project] No thumbnail generated for ${relativePath}.`, reason);
    try { await unlink(thumbnailPath); } catch { /* A missing derived thumbnail is already clean. */ }
  }
  return {
    id,
    path: relativePath,
    name: path.basename(filePath),
    bytes: file.size,
    modifiedAt,
    ...(thumbnail ? { thumbnail } : {}),
    thumbnailStatus: thumbnail ? 'ready' : 'unavailable'
  };
};

const writeIndex = async (indexPath: string, assets: readonly ProjectAssetIndexEntry[]): Promise<void> => {
  const next: ProjectAssetIndex = {
    format: LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT,
    version: LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    assets: [...assets].sort((left, right) => left.path.localeCompare(right.path))
  };
  await atomicWriteFile({
    targetPath: indexPath,
    bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8')
  });
};

export const recordSavedProjectAsset = async (request: {
  readonly manifestPath: string;
  readonly filePath: string;
  readonly thumbnailPng?: (filePath: string) => Promise<Uint8Array>;
}): Promise<boolean> => {
  const { manifest, summary } = await openProjectManifest(request.manifestPath);
  const relativePath = normalizedProjectRelativePath(summary.rootPath, request.filePath);
  if (!relativePath) return false;

  const thumbnailDirectory = resolveProjectStoragePath(summary.rootPath, manifest, 'thumbnails');
  const indexDirectory = resolveProjectStoragePath(summary.rootPath, manifest, 'indexes');
  const indexPath = path.join(indexDirectory, 'assets-v1.json');
  const previous = await loadIndex(indexPath);
  const id = assetId(relativePath);
  const entry = await buildAssetEntry(
    { rootPath: summary.rootPath, thumbnailDirectory },
    request.filePath,
    request.thumbnailPng ?? createThumbnailPng,
    previous.assets.find((candidate) => candidate.id === id)
  );
  if (!entry) return false;
  const assets = previous.assets
    .filter((candidate) => candidate.id !== id)
    .concat(entry);
  await writeIndex(indexPath, assets);
  return true;
};

export const scheduleSavedProjectAsset = (request: {
  readonly manifestPath: string;
  readonly filePath: string;
}): void => {
  const key = path.resolve(request.manifestPath).toLocaleLowerCase('en-US');
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await recordSavedProjectAsset(request);
    });
  saveQueues.set(key, next);
  void next.catch((reason) => {
    console.warn('[LightTable project] Saved the document, but thumbnail indexing failed.', reason);
  }).finally(() => {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  });
};

const scanAssetFiles = async (
  rootPath: string,
  trashPath: string,
  directoryPath = rootPath
): Promise<string[]> => {
  const assets: string[] = [];
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') return assets;
    throw reason;
  }
  for (const entry of entries) {
    const candidate = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (candidate === trashPath || entry.name === '.lighttable') continue;
      assets.push(...await scanAssetFiles(rootPath, trashPath, candidate));
      continue;
    }
    if (
      entry.isFile()
      && entry.name !== 'project.ltproject'
      && PROJECT_ASSET_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US'))
    ) assets.push(candidate);
  }
  return assets;
};

export const rebuildProjectAssetIndex = async (request: {
  readonly manifestPath: string;
  readonly thumbnailPng?: (filePath: string) => Promise<Uint8Array>;
}): Promise<ProjectAssetIndex> => {
  const { manifest, summary } = await openProjectManifest(request.manifestPath);
  const thumbnailDirectory = resolveProjectStoragePath(summary.rootPath, manifest, 'thumbnails');
  const indexPath = path.join(
    resolveProjectStoragePath(summary.rootPath, manifest, 'indexes'),
    'assets-v1.json'
  );
  const trashPath = resolveProjectStoragePath(summary.rootPath, manifest, 'trash');
  const previous = await loadIndex(indexPath);
  const previousById = new Map(previous.assets.map((entry) => [entry.id, entry]));
  const files = await scanAssetFiles(summary.rootPath, trashPath);
  const assets: ProjectAssetIndexEntry[] = [];
  const thumbnailPng = request.thumbnailPng ?? createThumbnailPng;

  // A small bounded pool keeps initial scans responsive without flooding native decoders.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const filePath = files[cursor++];
      if (!filePath) continue;
      const relativePath = normalizedProjectRelativePath(summary.rootPath, filePath);
      if (!relativePath) continue;
      const entry = await buildAssetEntry(
        { rootPath: summary.rootPath, thumbnailDirectory },
        filePath,
        thumbnailPng,
        previousById.get(assetId(relativePath))
      );
      if (entry) assets.push(entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, files.length)) }, worker));

  const retainedThumbnails = new Set(assets.map((entry) => entry.thumbnail).filter(Boolean));
  await Promise.all(previous.assets.map(async (entry) => {
    if (!entry.thumbnail || retainedThumbnails.has(entry.thumbnail)) return;
    try {
      await unlink(path.join(summary.rootPath, ...entry.thumbnail.split('/')));
    } catch { /* Derived files are rebuildable and may already be gone. */ }
  }));
  await writeIndex(indexPath, assets);
  return loadIndex(indexPath);
};

class ProjectAssetCatalogController {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private manifestPath: string | null = null;
  private readonly listeners = new Set<(manifestPath: string) => void>();

  subscribe(listener: (manifestPath: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(manifestPath: string): void {
    this.close();
    this.manifestPath = path.resolve(manifestPath);
    void openProjectManifest(this.manifestPath).then(({ manifest, summary }) => {
      if (this.manifestPath !== path.resolve(manifestPath)) return;
      const trashPath = resolveProjectStoragePath(summary.rootPath, manifest, 'trash');
      this.watcher = watch(summary.rootPath, { recursive: true }, (_event, fileName) => {
        if (!fileName) return this.schedule();
        const relative = String(fileName).split(path.sep).join('/');
        const absolute = path.resolve(summary.rootPath, String(fileName));
        if (relative === '.lighttable' || relative.startsWith('.lighttable/')) return;
        if (absolute === trashPath || absolute.startsWith(`${trashPath}${path.sep}`)) return;
        this.schedule();
      });
      this.watcher.on('error', (reason) => {
        console.warn('[LightTable project] Asset watcher failed.', reason);
      });
      void this.rebuild('initial project scan');
    }).catch((reason) => {
      console.warn('[LightTable project] Asset watcher could not start.', reason);
    });
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    this.manifestPath = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild('filesystem change');
    }, 500);
  }

  private async rebuild(reason: string): Promise<void> {
    const manifestPath = this.manifestPath;
    if (!manifestPath) return;
    const key = path.resolve(manifestPath).toLocaleLowerCase('en-US');
    const previous = saveQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (this.manifestPath !== manifestPath) return;
      await rebuildProjectAssetIndex({ manifestPath });
      if (this.manifestPath === manifestPath) {
        for (const listener of this.listeners) listener(manifestPath);
      }
    });
    saveQueues.set(key, next);
    try {
      await next;
    } catch (error) {
      console.warn(`[LightTable project] Could not complete ${reason}.`, error);
    } finally {
      if (saveQueues.get(key) === next) saveQueues.delete(key);
    }
  }
}

const projectAssetCatalog = new ProjectAssetCatalogController();

export const activateProjectAssetCatalog = (manifestPath: string): void => {
  projectAssetCatalog.activate(manifestPath);
};

export const deactivateProjectAssetCatalog = (): void => {
  projectAssetCatalog.close();
};

export const subscribeProjectAssetCatalog = (
  listener: (manifestPath: string) => void
): (() => void) => projectAssetCatalog.subscribe(listener);
