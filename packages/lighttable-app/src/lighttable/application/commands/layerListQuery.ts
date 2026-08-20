import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { projectLayerQuery, type LayerQuerySummary } from './layerQueryProjection';

const DEFAULT_LIMIT = 128;
const MAX_LIMIT = 256;

export interface LayerListQueryPage {
  readonly status: 'completed';
  readonly documentId: string;
  readonly canonicalRevision: number;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly layers: readonly LayerQuerySummary[];
}

export interface LayerListQueryRejection {
  readonly status: 'rejected';
  readonly code: 'invalid-request' | 'document-not-found' | 'stale-document-revision';
  readonly message: string;
  readonly currentRevision?: number;
}

export type LayerListQueryResult = LayerListQueryPage | LayerListQueryRejection;

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cursorFor = (documentId: string, revision: number, offset: number) =>
  `v1:${encodeURIComponent(documentId)}:${revision}:${offset}`;

const parseCursor = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 1024) return null;
  const match = /^v1:([^:]+):(\d+):(\d+)$/u.exec(value);
  if (!match) return null;
  try {
    const revision = Number(match[2]);
    const offset = Number(match[3]);
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(offset)) return null;
    return { documentId: decodeURIComponent(match[1]), revision, offset };
  } catch {
    return null;
  }
};

const collectWindow = (nodes: ImageDocument['layers'], offset: number, limit: number) => {
  const stack = [...nodes].reverse().map((node) => ({ node, parentId: null as LayerId | null, depth: 0 }));
  const selected: { node: (typeof nodes)[number]; parentId: LayerId | null; depth: number }[] = [];
  let total = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (total >= offset && selected.length < limit) selected.push(entry);
    total += 1;
    if (entry.node.type === 'group') {
      for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: entry.node.children[index]!, parentId: entry.node.id, depth: entry.depth + 1 });
      }
    }
  }
  return { selected, total };
};

/** Creates one compact page without embedding type-specific vector geometry. */
export const projectLayerListPage = (
  documentId: string,
  document: ImageDocument,
  canonicalRevision: number,
  value: unknown
): LayerListQueryResult => {
  if (!record(value)) {
    return { status: 'rejected', code: 'invalid-request',
      message: 'Layer list parameters must be an object.' };
  }
  const expected = value.expectedDocumentRevision;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || (expected as number) < 0)) {
    return { status: 'rejected', code: 'invalid-request',
      message: 'expectedDocumentRevision must be a non-negative safe integer.' };
  }
  if (expected !== undefined && expected !== canonicalRevision) {
    return { status: 'rejected', code: 'stale-document-revision',
      message: 'The expected document revision is stale.', currentRevision: canonicalRevision };
  }
  const requestedLimit = value.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(requestedLimit) || (requestedLimit as number) < 1
    || (requestedLimit as number) > MAX_LIMIT) {
    return { status: 'rejected', code: 'invalid-request',
      message: `Layer list limit must be 1-${MAX_LIMIT}.` };
  }
  const cursor = value.cursor === undefined ? { documentId, revision: canonicalRevision, offset: 0 }
    : parseCursor(value.cursor);
  if (!cursor || cursor.documentId !== documentId) {
    return { status: 'rejected', code: 'invalid-request',
      message: 'The layer cursor is invalid or belongs to another document.' };
  }
  if (cursor.revision !== canonicalRevision) {
    return { status: 'rejected', code: 'stale-document-revision',
      message: 'The layer cursor belongs to a stale document revision.',
      currentRevision: canonicalRevision };
  }
  const limit = requestedLimit as number;
  const { selected, total } = collectWindow(document.layers, cursor.offset, limit);
  if (cursor.offset > total) {
    return { status: 'rejected', code: 'invalid-request',
      message: 'The layer cursor offset exceeds the current layer tree.' };
  }
  const nextOffset = cursor.offset + selected.length;
  return {
    status: 'completed', documentId, canonicalRevision, total,
    offset: cursor.offset, limit, truncated: nextOffset < total,
    nextCursor: nextOffset < total
      ? cursorFor(documentId, canonicalRevision, nextOffset) : null,
    layers: selected.map(({ node, parentId, depth }) => projectLayerQuery(
      node, parentId, depth, { includeVectorElements: false }
    ))
  };
};
