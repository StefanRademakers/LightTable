import type { GenAiAssetId, GenAiAssetPayload } from '@lighttable/genai-core';
import type { PublishedAgentReference } from '../agentTunnelAdapters';
import type { ProjectAssetRemoteLink } from './projectAssetRemoteLinks';

export interface PrepareProjectAssetReferencesPorts {
  readonly resolve: (assetIds: readonly string[]) => Promise<readonly ProjectAssetRemoteLink[]>;
  readonly read: (assetId: GenAiAssetId) => Promise<GenAiAssetPayload | null>;
  readonly publish: (input: GenAiAssetPayload) => Promise<PublishedAgentReference>;
  readonly record: (link: Omit<ProjectAssetRemoteLink, 'updatedAt'>) => Promise<void>;
}

/**
 * Makes every selected local project image reachable to a remote provider.
 * The renderer only supplies opaque asset IDs; filesystem paths and bytes stay
 * inside the desktop-owned ports.
 */
export const prepareProjectAssetReferences = async (
  assetIds: readonly GenAiAssetId[],
  providerId: string,
  ports: PrepareProjectAssetReferencesPorts
): Promise<readonly ProjectAssetRemoteLink[]> => {
  const requested = [...new Set(assetIds)];
  let links = await ports.resolve(requested);
  const available = new Set(links.map((link) => link.assetId));
  for (const assetId of requested) {
    if (available.has(assetId)) continue;
    const asset = await ports.read(assetId);
    if (!asset) throw new Error('A selected visual reference no longer exists in this project.');
    if (!asset.mediaType.startsWith('image/')) {
      throw new Error(`${asset.name} is not a supported image reference.`);
    }
    const publication = await ports.publish(asset);
    await ports.record({
      assetId,
      providerId,
      url: publication.url,
      mediaType: publication.mediaType,
      expiresAt: new Date(publication.expiresAt).toISOString()
    });
  }
  links = await ports.resolve(requested);
  if (new Set(links.map((link) => link.assetId)).size !== requested.length) {
    throw new Error('One or more visual references could not be published securely.');
  }
  return links;
};
