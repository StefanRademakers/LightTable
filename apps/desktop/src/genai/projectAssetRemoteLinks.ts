import path from 'node:path';
import { atomicWriteFile } from '../atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from '../projectService';
import { readBoundedJsonFile } from '../boundedJsonFile';

const FORMAT = 'lighttable-genai-remote-links';
const VERSION = 2;
const MAX_REMOTE_LINK_INDEX_BYTES = 16 * 1024 * 1024;

export interface ProjectAssetSourceRevision {
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ProjectAssetRemoteLink {
  readonly assetId: string;
  readonly providerId: string;
  readonly providerJobId?: string;
  readonly url?: string;
  readonly providerAssetId?: string;
  readonly mediaType: string;
  readonly sourceRevision?: ProjectAssetSourceRevision;
  readonly expiresAt?: string;
  readonly updatedAt: string;
}

interface RemoteLinkIndex {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly links: readonly ProjectAssetRemoteLink[];
}

const indexPathFor = async (manifestPath: string): Promise<string> => {
  const { manifest, summary } = await openProjectManifest(manifestPath);
  return path.join(resolveProjectStoragePath(summary.rootPath, manifest, 'indexes'), 'genai-remote-links-v1.json');
};

const load = async (manifestPath: string): Promise<RemoteLinkIndex> => {
  try {
    const candidate = await readBoundedJsonFile(
      await indexPathFor(manifestPath), MAX_REMOTE_LINK_INDEX_BYTES, 'GenAI remote-link index'
    ) as Partial<RemoteLinkIndex>;
    if (candidate.format === FORMAT && candidate.version === VERSION && Array.isArray(candidate.links)) {
      return candidate as RemoteLinkIndex;
    }
  } catch (reason) {
    if (!(reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT')) throw reason;
  }
  return { format: FORMAT, version: VERSION, links: [] };
};

export const resolveProjectAssetRemoteLinks = async (
  manifestPath: string,
  assetIds: readonly string[],
  providerId: string
): Promise<readonly ProjectAssetRemoteLink[]> => {
  const requested = new Set(assetIds);
  return (await load(manifestPath)).links.filter((link) =>
    requested.has(link.assetId) && link.providerId === providerId
    && (Boolean(link.providerAssetId) || Boolean(link.url && /^https:\/\//iu.test(link.url)))
    && (!link.expiresAt || Date.parse(link.expiresAt) > Date.now() + 30_000)
  );
};

export const recordProjectAssetRemoteLink = async (
  manifestPath: string,
  link: Omit<ProjectAssetRemoteLink, 'updatedAt'>
): Promise<void> => {
  if (!link.providerAssetId && !link.url) throw new Error('A provider publication requires a provider asset ID or HTTPS URL.');
  if (link.url && !/^https:\/\//iu.test(link.url)) throw new Error('A provider asset link must use HTTPS.');
  const current = await load(manifestPath);
  const next: RemoteLinkIndex = {
    format: FORMAT,
    version: VERSION,
    links: current.links
      .filter((candidate) => !(candidate.assetId === link.assetId && candidate.providerId === link.providerId))
      .concat({ ...link, updatedAt: new Date().toISOString() })
  };
  const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (bytes.byteLength > MAX_REMOTE_LINK_INDEX_BYTES) throw new Error('GenAI remote-link index exceeds the 16 MiB project limit.');
  await atomicWriteFile({
    targetPath: await indexPathFor(manifestPath),
    bytes
  });
};

export const replaceProjectAssetRemoteLinkId = async (
  manifestPath: string, previousId: string, nextId: string
): Promise<void> => {
  const current = await load(manifestPath);
  const next: RemoteLinkIndex = {
    ...current,
    links: current.links.map((link) => link.assetId === previousId ? { ...link, assetId: nextId } : link)
  };
  const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (bytes.byteLength > MAX_REMOTE_LINK_INDEX_BYTES) throw new Error('GenAI remote-link index exceeds the 16 MiB project limit.');
  await atomicWriteFile({
    targetPath: await indexPathFor(manifestPath),
    bytes
  });
};
