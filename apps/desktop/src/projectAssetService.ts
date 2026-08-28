import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { open, readFile, readdir, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from './projectService';
import { readBoundedJsonFile } from './boundedJsonFile';

const MAX_PROJECT_ASSET_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_ASSET_INDEX_ENTRIES = 100_000;
const MAX_PROJECT_SCAN_DIRECTORIES = 100_000;

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

export interface ProjectAssetDirectory {
  readonly path: string;
  readonly label: string;
}

const saveQueues = new Map<string, Promise<unknown>>();

/**
 * Serializes every read-modify-write of one project's derived asset index.
 * Imports can arrive concurrently (for example an inpaint base image and mask),
 * so atomic file replacement alone is insufficient: two writers could both read
 * the old index and the last writer would silently drop the other's entry.
 */
const enqueueAssetIndexMutation = async <T>(manifestPath: string, operation: () => Promise<T>): Promise<T> => {
  const key = path.resolve(manifestPath).toLocaleLowerCase('en-US');
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  saveQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  }
};
const PROJECT_ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.psd', '.psb', '.pdf', '.svg', '.mp4', '.webm'
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

const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
export const validateProjectAssetFileName = (value: string, currentName: string): string => {
  const requested = value.trim();
  if (!requested || requested.length > 255 || /[<>:"/\\|?*\u0000-\u001f]/u.test(requested)
    || /[. ]$/u.test(requested) || WINDOWS_RESERVED_FILE_NAME.test(requested)) {
    throw new Error('Enter a valid file name.');
  }
  const currentExtension = path.extname(currentName);
  const requestedExtension = path.extname(requested);
  const baseName = requestedExtension ? requested.slice(0, -requestedExtension.length) : requested;
  if (!baseName) throw new Error('Enter a valid file name.');
  if (requestedExtension && requestedExtension.toLocaleLowerCase('en-US') !== currentExtension.toLocaleLowerCase('en-US')) {
    throw new Error(`Keep the ${currentExtension} file extension.`);
  }
  return requestedExtension ? requested : `${requested}${currentExtension}`;
};

const resolveIndexedAssetPath = async (manifestPath: string, requestedId: string) => {
  if (!/^[a-f0-9]{24}$/.test(requestedId)) throw new Error('Invalid project asset identifier.');
  const { rootPath, index } = await readProjectAssetIndex(manifestPath);
  const entry = index.assets.find(({ id }) => id === requestedId);
  if (!entry) throw new Error('The project asset is no longer available.');
  const filePath = path.resolve(rootPath, ...entry.path.split('/'));
  const root = path.resolve(rootPath);
  if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid project asset location.');
  return { rootPath, entry, filePath };
};

export const renameProjectAsset = async (request: {
  readonly manifestPath: string; readonly assetId: string; readonly name: string;
}): Promise<{ readonly previousId: string; readonly next: ProjectAssetIndexEntry }> => {
  const current = await resolveIndexedAssetPath(request.manifestPath, request.assetId);
  const name = validateProjectAssetFileName(request.name, current.entry.name);
  const destination = path.join(path.dirname(current.filePath), name);
  if (destination.toLocaleLowerCase('en-US') !== current.filePath.toLocaleLowerCase('en-US') && await pathExists(destination)) {
    throw new Error(`A file named "${name}" already exists.`);
  }
  await rename(current.filePath, destination);
  const index = await rebuildProjectAssetIndex({ manifestPath: request.manifestPath });
  const relativePath = normalizedProjectRelativePath(current.rootPath, destination);
  const next = relativePath ? index.assets.find(({ id }) => id === assetId(relativePath)) : undefined;
  if (!next) throw new Error('The file was renamed but could not be reindexed.');
  return { previousId: current.entry.id, next };
};

export const resolveProjectAssetPath = async (manifestPath: string, requestedId: string): Promise<string> =>
  (await resolveIndexedAssetPath(manifestPath, requestedId)).filePath;

const emptyIndex = (): ProjectAssetIndex => ({
  format: LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT,
  version: LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION,
  updatedAt: new Date(0).toISOString(),
  assets: []
});

const validIndexEntry = (value: unknown): value is ProjectAssetIndexEntry => Boolean(
  value && typeof value === 'object'
  && typeof (value as ProjectAssetIndexEntry).id === 'string'
  && (value as ProjectAssetIndexEntry).id.length <= 128
  && typeof (value as ProjectAssetIndexEntry).path === 'string'
  && (value as ProjectAssetIndexEntry).path.length <= 32_768
  && typeof (value as ProjectAssetIndexEntry).name === 'string'
  && (value as ProjectAssetIndexEntry).name.length <= 1024
  && Number.isSafeInteger((value as ProjectAssetIndexEntry).bytes)
  && (value as ProjectAssetIndexEntry).bytes >= 0
  && typeof (value as ProjectAssetIndexEntry).modifiedAt === 'string'
  && ((value as ProjectAssetIndexEntry).thumbnail === undefined
    || (typeof (value as ProjectAssetIndexEntry).thumbnail === 'string'
      && (value as ProjectAssetIndexEntry).thumbnail!.length <= 32_768))
  && ((value as ProjectAssetIndexEntry).thumbnailStatus === 'ready'
    || (value as ProjectAssetIndexEntry).thumbnailStatus === 'unavailable')
);

const loadIndex = async (indexPath: string): Promise<ProjectAssetIndex> => {
  try {
    const candidate = await readBoundedJsonFile(
      indexPath, MAX_PROJECT_ASSET_INDEX_BYTES, 'Project asset index'
    ) as Partial<ProjectAssetIndex>;
    if (
      candidate.format !== LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT
      || candidate.version !== LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION
      || !Array.isArray(candidate.assets)
      || candidate.assets.length > MAX_PROJECT_ASSET_INDEX_ENTRIES
      || !candidate.assets.every(validIndexEntry)
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

const portableRelativeDirectory = (rootPath: string, directoryPath: string): string | null => {
  const relative = path.relative(rootPath, directoryPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
};

/** Lists real, user-visible project directories. This never depends on an AI provider. */
export const readProjectAssetDirectories = async (manifestPath: string): Promise<readonly ProjectAssetDirectory[]> => {
  const { manifest, summary } = await openProjectManifest(manifestPath);
  const rootPath = summary.rootPath;
  const hiddenRoots = new Set([
    manifest.folders.aiReferences,
    manifest.folders.trash,
    manifest.folders.cache,
    manifest.folders.thumbnails,
    manifest.folders.indexes,
    manifest.folders.temp
  ].map((entry) => entry.toLocaleLowerCase('en-US')));
  const configuredLabels = new Map<string, string>([
    [manifest.folders.aiHistory, 'History'],
    [manifest.folders.characters, 'Characters'],
    [manifest.folders.environments, 'Environments'],
    [manifest.folders.props, 'Props'],
    [manifest.folders.sets, 'Sets'],
    ...manifest.userFolders.map((folder) => [folder.path, folder.name] as const)
  ].map(([entryPath, label]) => [entryPath.toLocaleLowerCase('en-US'), label]));
  const directories: ProjectAssetDirectory[] = [];
  const visit = async (directoryPath: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directoryPath, { withFileTypes: true }); }
    catch (reason) {
      if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') return;
      throw reason;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === '.lighttable') continue;
      const candidate = path.join(directoryPath, entry.name);
      const relativePath = portableRelativeDirectory(rootPath, candidate);
      if (!relativePath) continue;
      const identity = relativePath.toLocaleLowerCase('en-US');
      if ([...hiddenRoots].some((hidden) => identity === hidden || identity.startsWith(`${hidden}/`))) continue;
      const isAiContainer = identity === manifest.folders.ai.toLocaleLowerCase('en-US');
      if (!isAiContainer) {
        directories.push({
          path: relativePath,
          label: configuredLabels.get(identity) ?? relativePath
        });
      }
      await visit(candidate);
    }
  };
  await visit(rootPath);
  for (const [identity, label] of configuredLabels) {
    if (directories.some((directory) => directory.path.toLocaleLowerCase('en-US') === identity)) continue;
    const configuredPath = [manifest.folders.aiHistory, manifest.folders.characters, manifest.folders.environments,
      manifest.folders.props, manifest.folders.sets, ...manifest.userFolders.map((folder) => folder.path)]
      .find((entry) => entry.toLocaleLowerCase('en-US') === identity);
    if (configuredPath) directories.push({ path: configuredPath, label });
  }
  return directories.sort((left, right) => left.label === 'History' ? -1
    : right.label === 'History' ? 1 : left.label.localeCompare(right.label));
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
  const previewStats = await stat(previewPath);
  if (!previewStats.isFile() || previewStats.size < 1 || previewStats.size > 16 * 1024 * 1024) {
    throw new Error('Project asset preview exceeds the 16 MiB transfer limit.');
  }
  const bytes = new Uint8Array(await readFile(previewPath));
  if (bytes.byteLength !== previewStats.size) {
    throw new Error('Project asset preview changed while it was being loaded.');
  }
  return bytes;
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
  const assetStats = await stat(assetPath);
  if (!assetStats.isFile() || assetStats.size < 1 || assetStats.size !== entry.bytes
    || assetStats.size > 256 * 1024 * 1024) {
    throw new Error('Project asset changed or exceeds the 256 MiB transfer limit.');
  }
  const bytes = new Uint8Array(await readFile(assetPath));
  if (bytes.byteLength !== assetStats.size) {
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
const MAX_EMBEDDED_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 16 * 1024 * 1024;
const MAX_THUMBNAIL_SOURCE_EDGE = 16_384;
const MAX_THUMBNAIL_SOURCE_PIXELS = 64 * 1024 * 1024;

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
    let firstChunk = true;
    while (position < MAX_EMBEDDED_PREVIEW_BYTES) {
      const header = await readExactly(handle, 8, position);
      const dataLength = header.readUInt32BE(0);
      const chunkLength = 8 + dataLength + 4;
      if (position + chunkLength > MAX_EMBEDDED_PREVIEW_BYTES) {
        throw new Error('The saved document preview exceeds the thumbnail limit.');
      }
      const body = await readExactly(handle, dataLength + 4, position + 8);
      const chunkType = header.toString('ascii', 4, 8);
      if (firstChunk) {
        firstChunk = false;
        if (chunkType !== 'IHDR' || dataLength !== 13) {
          throw new Error('The saved document preview has an invalid PNG header.');
        }
        const width = body.readUInt32BE(0);
        const height = body.readUInt32BE(4);
        if (
          width < 1 || height < 1
          || width > MAX_THUMBNAIL_SOURCE_EDGE || height > MAX_THUMBNAIL_SOURCE_EDGE
          || width * height > MAX_THUMBNAIL_SOURCE_PIXELS
        ) {
          throw new Error('The saved document preview is too large to thumbnail safely.');
        }
      }
      parts.push(header, body);
      position += chunkLength;
      if (chunkType === 'IEND') return Buffer.concat(parts, position);
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
    if (thumbnailBytes.byteLength < 1 || thumbnailBytes.byteLength > MAX_THUMBNAIL_BYTES) {
      throw new Error('The generated project thumbnail exceeds the 16 MiB storage boundary.');
    }
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
  if (assets.length > MAX_PROJECT_ASSET_INDEX_ENTRIES) {
    throw new Error('The project contains too many indexed assets.');
  }
  const next: ProjectAssetIndex = {
    format: LIGHTTABLE_PROJECT_ASSET_INDEX_FORMAT,
    version: LIGHTTABLE_PROJECT_ASSET_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    assets: [...assets].sort((left, right) => left.path.localeCompare(right.path))
  };
  const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (bytes.byteLength > MAX_PROJECT_ASSET_INDEX_BYTES) {
    throw new Error('The project asset index exceeds the storage boundary.');
  }
  await atomicWriteFile({
    targetPath: indexPath,
    bytes
  });
};

const recordSavedProjectAssetUnqueued = async (request: {
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

export const recordSavedProjectAsset = (request: {
  readonly manifestPath: string;
  readonly filePath: string;
  readonly thumbnailPng?: (filePath: string) => Promise<Uint8Array>;
}): Promise<boolean> => enqueueAssetIndexMutation(
  request.manifestPath,
  () => recordSavedProjectAssetUnqueued(request)
);

export const scheduleSavedProjectAsset = (request: {
  readonly manifestPath: string;
  readonly filePath: string;
}): void => {
  void recordSavedProjectAsset(request).catch((reason) => {
    console.warn('[LightTable project] Saved the document, but thumbnail indexing failed.', reason);
  });
};

const scanAssetFiles = async (
  rootPath: string,
  trashPath: string,
  signal?: AbortSignal
): Promise<string[]> => {
  const assets: string[] = [];
  const directories = [rootPath];
  for (let cursor = 0; cursor < directories.length; cursor += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Project scan canceled.', 'AbortError');
    if (directories.length > MAX_PROJECT_SCAN_DIRECTORIES) {
      throw new Error('The project directory tree exceeds the indexing boundary.');
    }
    const directoryPath = directories[cursor]!;
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT') continue;
      throw reason;
    }
    for (const entry of entries) {
      const candidate = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (candidate !== trashPath && entry.name !== '.lighttable') directories.push(candidate);
        continue;
      }
      if (entry.isFile() && entry.name !== 'project.ltproject'
        && PROJECT_ASSET_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US'))) {
        if (assets.length >= MAX_PROJECT_ASSET_INDEX_ENTRIES) {
          throw new Error('The project contains too many indexable assets.');
        }
        assets.push(candidate);
      }
    }
  }
  return assets;
};

const rebuildProjectAssetIndexUnqueued = async (request: {
  readonly manifestPath: string;
  readonly thumbnailPng?: (filePath: string) => Promise<Uint8Array>;
  readonly signal?: AbortSignal;
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
  const files = await scanAssetFiles(summary.rootPath, trashPath, request.signal);
  const assets: ProjectAssetIndexEntry[] = [];
  const thumbnailPng = request.thumbnailPng ?? createThumbnailPng;

  // A small bounded pool keeps initial scans responsive without flooding native decoders.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new DOMException('Project scan canceled.', 'AbortError');
      }
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
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, files.length)) }, worker));
  if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Project scan canceled.', 'AbortError');

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

export const rebuildProjectAssetIndex = (request: {
  readonly manifestPath: string;
  readonly thumbnailPng?: (filePath: string) => Promise<Uint8Array>;
  readonly signal?: AbortSignal;
}): Promise<ProjectAssetIndex> => enqueueAssetIndexMutation(
  request.manifestPath,
  () => rebuildProjectAssetIndexUnqueued(request)
);

class ProjectAssetCatalogController {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private manifestPath: string | null = null;
  private scanAbort: AbortController | null = null;
  private readonly listeners = new Set<(manifestPath: string) => void>();

  subscribe(listener: (manifestPath: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(manifestPath: string): void {
    this.close();
    const scanAbort = new AbortController();
    this.scanAbort = scanAbort;
    this.manifestPath = path.resolve(manifestPath);
    void openProjectManifest(this.manifestPath).then(({ manifest, summary }) => {
      if (scanAbort.signal.aborted || this.manifestPath !== path.resolve(manifestPath)) return;
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
    this.scanAbort?.abort(new DOMException('Project catalog closed.', 'AbortError'));
    this.scanAbort = null;
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
    const signal = this.scanAbort?.signal;
    if (!manifestPath || !signal || signal.aborted) return;
    try {
      if (this.manifestPath !== manifestPath) return;
      await rebuildProjectAssetIndex({ manifestPath, signal });
      if (this.manifestPath === manifestPath) {
        for (const listener of this.listeners) listener(manifestPath);
      }
    } catch (error) {
      if (signal.aborted) return;
      console.warn(`[LightTable project] Could not complete ${reason}.`, error);
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
