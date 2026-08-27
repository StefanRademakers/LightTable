import {
  buildLayeredDocumentFile,
  parseLayeredDocumentFile,
  type DocumentAssetBlob
} from '../../editor/persistence/layeredDocumentFormat';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { AdjustmentStack } from '../../processing/adjustmentStack';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const duplicateDocumentDefaultName = (sourceName: string): string => {
  const base = sourceName
    .replace(/\.lighttable\.png$/i, '')
    .replace(/\.[^.]+$/, '')
    .trim() || 'Untitled';
  return `${base} copy`;
};

export const normalizeDuplicateDocumentName = (
  requestedName: string,
  sourceName: string
): string => {
  const normalized = requestedName.trim() || duplicateDocumentDefaultName(sourceName);
  if (normalized.length > 255) throw new Error('The duplicate name cannot exceed 255 characters.');
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new Error('The duplicate name cannot contain control characters.');
  }
  return normalized;
};

const createRuntimeId = (prefix = 'copy') =>
  `${prefix}-${crypto.randomUUID()}`;

const collectRuntimeIds = (value: unknown, ids: Map<string, string>): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRuntimeIds(entry, ids));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && /(?:^id$|Id$)/.test(key) && entry) {
      if (!ids.has(entry)) ids.set(entry, createRuntimeId(key.replace(/Id$/, '').toLowerCase()));
    } else {
      collectRuntimeIds(entry, ids);
    }
  }
};

const IDENTITY_FIELD = /(?:^id$|Id$|Ids$)/;

const remapRuntimeIds = <T>(value: T, ids: ReadonlyMap<string, string>, field = ''): T => {
  if (typeof value === 'string') {
    return (IDENTITY_FIELD.test(field) ? ids.get(value) ?? value : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => (
    typeof entry === 'string' && IDENTITY_FIELD.test(field)
      ? ids.get(entry) ?? entry
      : remapRuntimeIds(entry, ids)
  )) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, remapRuntimeIds(entry, ids, key)])) as T;
};

export interface DuplicatedDocumentSemantics {
  readonly document: ImageDocument;
  readonly adjustmentStack: AdjustmentStack;
  readonly idMap: ReadonlyMap<string, string>;
}

export const duplicateDocumentSemantics = (
  document: ImageDocument,
  adjustmentStack: AdjustmentStack,
  name: string
): DuplicatedDocumentSemantics => {
  const source = { document, adjustmentStack };
  const idMap = new Map<string, string>();
  collectRuntimeIds(source, idMap);
  const duplicate = remapRuntimeIds(structuredClone(source), idMap);
  const now = Date.now();
  duplicate.document = {
    ...duplicate.document,
    name,
    revision: 0,
    createdAt: now,
    modifiedAt: now
  };
  return { ...duplicate, idMap };
};

const remapAsset = (
  asset: DocumentAssetBlob,
  ids: ReadonlyMap<string, string>
): DocumentAssetBlob => {
  if ('layerId' in asset) return { ...asset, layerId: (ids.get(asset.layerId) ?? asset.layerId) as typeof asset.layerId };
  if ('patternId' in asset) return { ...asset, patternId: (ids.get(asset.patternId) ?? asset.patternId) as typeof asset.patternId };
  if ('lutId' in asset) return { ...asset, lutId: (ids.get(asset.lutId) ?? asset.lutId) as typeof asset.lutId };
  if ('sourceId' in asset) return { ...asset, sourceId: (ids.get(asset.sourceId) ?? asset.sourceId) as typeof asset.sourceId };
  return asset;
};

/**
 * Creates a self-contained native artifact for an independent unsaved tab.
 * Rebuildable previews/caches and source history are deliberately absent from
 * the native boundary; authored binary assets are retained by Blob slicing.
 */
export const duplicateLayeredDocumentArtifact = async (
  source: File,
  requestedName: string
): Promise<File> => {
  const parsed = await parseLayeredDocumentFile(source);
  if (!parsed) throw new Error('The active document could not be captured as a native LightTable document.');
  const name = normalizeDuplicateDocumentName(requestedName, source.name);
  const duplicate = duplicateDocumentSemantics(parsed.document, parsed.adjustmentStack, name);
  const assets: DocumentAssetBlob[] = [
    ...parsed.assets,
    ...parsed.patternAssets,
    ...parsed.colorLookupAssets,
    ...parsed.preservedSourceAssets,
    ...parsed.fontAssets
  ].map((asset) => remapAsset(asset, duplicate.idMap));
  return buildLayeredDocumentFile(
    parsed.preview,
    duplicate.document,
    duplicate.adjustmentStack,
    assets,
    name,
    { previewKind: parsed.previewKind }
  );
};
