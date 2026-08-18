import type { GenAiAssetId, GenAiAssetPayload } from '@lighttable/genai-core';
import { createHash } from 'node:crypto';
import type { ProjectAssetRemoteLink } from './projectAssetRemoteLinks';

export interface PublishedProviderReference {
  readonly url?: string;
  readonly mediaType: string;
  readonly expiresAt?: number;
  readonly providerAssetId?: string;
}

export interface PrepareProjectAssetReferencesPorts {
  readonly resolve: (assetIds: readonly string[]) => Promise<readonly ProjectAssetRemoteLink[]>;
  readonly read: (assetId: GenAiAssetId) => Promise<GenAiAssetPayload | null>;
  readonly publish: (input: GenAiAssetPayload) => Promise<PublishedProviderReference>;
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
  const assets = new Map<GenAiAssetId, GenAiAssetPayload>();
  for (const assetId of requested) {
    const asset = await ports.read(assetId);
    if (!asset) throw new Error('A selected visual reference no longer exists in this project.');
    if (!/^(image|video|audio)\//u.test(asset.mediaType)) throw new Error(`${asset.name} is not a supported media reference.`);
    assets.set(assetId, asset);
  }
  let links = await ports.resolve(requested);
  for (const assetId of requested) {
    const asset = assets.get(assetId)!;
    const sourceRevision = {
      byteLength: asset.bytes.byteLength,
      sha256: createHash('sha256').update(asset.bytes).digest('hex')
    };
    const reusable = links.find((link) => link.assetId === assetId
      && link.sourceRevision?.byteLength === sourceRevision.byteLength
      && link.sourceRevision?.sha256 === sourceRevision.sha256);
    if (reusable) continue;
    let publication: PublishedProviderReference;
    try {
      publication = await ports.publish(asset);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      throw new Error(`Could not publish the local reference "${asset.name}". ${detail}`, { cause: reason });
    }
    await ports.record({
      assetId,
      providerId,
      ...(publication.url ? { url: publication.url } : {}),
      ...(publication.providerAssetId ? { providerAssetId: publication.providerAssetId } : {}),
      mediaType: publication.mediaType,
      sourceRevision,
      expiresAt: publication.expiresAt === undefined
        ? undefined
        : new Date(publication.expiresAt).toISOString()
    });
  }
  links = await ports.resolve(requested);
  const valid = links.filter((link) => {
    const asset = assets.get(link.assetId as GenAiAssetId);
    if (!asset || !link.sourceRevision) return false;
    return link.sourceRevision.byteLength === asset.bytes.byteLength
      && link.sourceRevision.sha256 === createHash('sha256').update(asset.bytes).digest('hex');
  });
  if (new Set(valid.map((link) => link.assetId)).size !== requested.length) {
    throw new Error('One or more visual references could not be published securely.');
  }
  const byId = new Map(valid.map((link) => [link.assetId, link]));
  return requested.map((assetId) => byId.get(assetId)!).filter(Boolean);
};
