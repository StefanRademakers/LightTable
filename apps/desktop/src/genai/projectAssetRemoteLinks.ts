import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../atomicFileWriter';
import { openProjectManifest, resolveProjectStoragePath } from '../projectService';

const FORMAT = 'lighttable-genai-remote-links';
const VERSION = 1;

export interface ProjectAssetRemoteLink {
  readonly assetId: string;
  readonly providerId: string;
  readonly providerJobId?: string;
  readonly url: string;
  readonly mediaType: string;
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
    const candidate = JSON.parse(await readFile(await indexPathFor(manifestPath), 'utf8')) as Partial<RemoteLinkIndex>;
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
    requested.has(link.assetId) && link.providerId === providerId && /^https:\/\//iu.test(link.url)
  );
};

export const recordProjectAssetRemoteLink = async (
  manifestPath: string,
  link: Omit<ProjectAssetRemoteLink, 'updatedAt'>
): Promise<void> => {
  if (!/^https:\/\//iu.test(link.url)) throw new Error('A provider asset link must use HTTPS.');
  const current = await load(manifestPath);
  const next: RemoteLinkIndex = {
    format: FORMAT,
    version: VERSION,
    links: current.links
      .filter((candidate) => !(candidate.assetId === link.assetId && candidate.providerId === link.providerId))
      .concat({ ...link, updatedAt: new Date().toISOString() })
  };
  await atomicWriteFile({
    targetPath: await indexPathFor(manifestPath),
    bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8')
  });
};
