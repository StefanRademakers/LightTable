import type { DocumentGuide, ImageDocument } from './documentTypes';

const changedDocument = (document: ImageDocument, guides: DocumentGuide[]): ImageDocument => {
  const now = Date.now();
  return { ...document, guides, revision: document.revision + 1, modifiedAt: now };
};

export const addDocumentGuide = (
  document: ImageDocument,
  guide: Omit<DocumentGuide, 'id'> & { id?: string }
): ImageDocument => {
  if (!Number.isFinite(guide.position)) return document;
  return changedDocument(document, [...document.guides, {
    ...guide,
    id: guide.id ?? `guide-${crypto.randomUUID()}`
  }]);
};

export const updateDocumentGuide = (
  document: ImageDocument,
  guideId: string,
  change: Pick<DocumentGuide, 'orientation' | 'position'>
): ImageDocument => {
  if (!Number.isFinite(change.position)) return document;
  let changed = false;
  const guides = document.guides.map((guide) => {
    if (guide.id !== guideId
      || (guide.orientation === change.orientation && guide.position === change.position)) return guide;
    changed = true;
    return { ...guide, ...change };
  });
  return changed ? changedDocument(document, guides) : document;
};

export const removeDocumentGuide = (document: ImageDocument, guideId: string): ImageDocument => {
  const guides = document.guides.filter(({ id }) => id !== guideId);
  return guides.length === document.guides.length ? document : changedDocument(document, guides);
};

export const clearDocumentGuides = (document: ImageDocument): ImageDocument => document.guides.length
  ? changedDocument(document, [])
  : document;

export const replaceDocumentGuides = (
  document: ImageDocument,
  guides: readonly DocumentGuide[]
): ImageDocument => {
  const normalized = guides
    .filter(({ position }) => Number.isFinite(position))
    .map((guide) => ({ ...guide }));
  const unchanged = normalized.length === document.guides.length
    && normalized.every((guide, index) => {
      const current = document.guides[index];
      return current?.id === guide.id
        && current.orientation === guide.orientation
        && current.position === guide.position
        && current.color === guide.color;
    });
  return unchanged ? document : changedDocument(document, normalized);
};
