export interface DocumentPixelRegion {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}

export interface DocumentRegionPreviewPlan {
  readonly region: DocumentPixelRegion;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly uvOrigin: readonly [number, number];
  readonly uvScale: readonly [number, number];
}

/** Validates an exact top-left document-pixel region and plans bounded GPU output. */
export const planDocumentRegionPreview = (
  documentWidth: number,
  documentHeight: number,
  region: DocumentPixelRegion,
  maxEdge: number
): DocumentRegionPreviewPlan | null => {
  const values = [documentWidth, documentHeight, region.x, region.y,
    region.width, region.height, maxEdge];
  if (!values.every(Number.isFinite) || documentWidth < 1 || documentHeight < 1
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > documentWidth || region.y + region.height > documentHeight
    || maxEdge < 1) return null;
  const scale = Math.min(1, maxEdge / Math.max(region.width, region.height));
  return {
    region: { ...region },
    outputWidth: Math.max(1, Math.round(region.width * scale)),
    outputHeight: Math.max(1, Math.round(region.height * scale)),
    uvOrigin: [region.x / documentWidth, region.y / documentHeight],
    uvScale: [region.width / documentWidth, region.height / documentHeight]
  };
};
