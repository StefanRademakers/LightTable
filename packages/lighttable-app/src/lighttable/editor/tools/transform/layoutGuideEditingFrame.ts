import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import type { DocumentGuide } from '../../document/documentTypes';

const frame = (
  resourceKey: string,
  width: number,
  height: number,
  edges: VectorSelectionFrame['edges']
): VectorSelectionFrame | null => edges.length ? ({
  resourceKey,
  bounds: { x: 0, y: 0, width, height },
  pivot: { x: width / 2, y: height / 2 },
  edges,
  handles: []
}) : null;

export const buildDocumentGuideFrame = (
  guides: readonly DocumentGuide[],
  width: number,
  height: number
): VectorSelectionFrame | null => frame(
  `document-guides:${width}:${height}:${guides.map(({ id, orientation, position }) => `${id}:${orientation}:${position}`).join('|')}`,
  width,
  height,
  guides.map((guide) => guide.orientation === 'vertical'
    ? { start: { x: guide.position, y: 0 }, end: { x: guide.position, y: height } }
    : { start: { x: 0, y: guide.position }, end: { x: width, y: guide.position } })
);

export const buildDocumentGridFrame = (
  width: number,
  height: number,
  spacing: number,
  originX: number,
  originY: number,
  zoom: number
): VectorSelectionFrame | null => {
  const requested = Math.max(1e-6, spacing);
  // Do not encode sub-pixel line soup. Coarsening is only presentation; snap
  // candidates continue to use the exact configured spacing.
  const stride = Math.max(1, Math.ceil(4 / Math.max(1e-6, requested * zoom)));
  const visibleSpacing = requested * stride;
  const firstX = originX + Math.ceil((0 - originX) / visibleSpacing) * visibleSpacing;
  const firstY = originY + Math.ceil((0 - originY) / visibleSpacing) * visibleSpacing;
  const edges: VectorSelectionFrame['edges'][number][] = [];
  for (let x = firstX; x <= width && edges.length < 4096; x += visibleSpacing) {
    edges.push({ start: { x, y: 0 }, end: { x, y: height } });
  }
  for (let y = firstY; y <= height && edges.length < 4096; y += visibleSpacing) {
    edges.push({ start: { x: 0, y }, end: { x: width, y } });
  }
  return frame(`document-grid:${width}:${height}:${requested}:${originX}:${originY}:${stride}`, width, height, edges);
};
