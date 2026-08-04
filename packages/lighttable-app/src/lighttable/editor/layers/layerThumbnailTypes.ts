export interface LayerThumbnailPreview {
  url: string;
  width: number;
  height: number;
}

export interface LayerThumbnailSet {
  pixels?: LayerThumbnailPreview;
  mask?: LayerThumbnailPreview;
}

export interface LayerThumbnailDimensions {
  width: number;
  height: number;
}

/** Fits the document aspect into a bounded layer-panel thumbnail slot. */
export const layerThumbnailDimensions = (
  documentWidth: number,
  documentHeight: number,
  maximumSize = 40
): LayerThumbnailDimensions => {
  const width = Math.max(1, Number.isFinite(documentWidth) ? documentWidth : 1);
  const height = Math.max(1, Number.isFinite(documentHeight) ? documentHeight : 1);
  const limit = Math.max(1, Math.round(Number.isFinite(maximumSize) ? maximumSize : 40));
  const scale = Math.min(limit / width, limit / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};
