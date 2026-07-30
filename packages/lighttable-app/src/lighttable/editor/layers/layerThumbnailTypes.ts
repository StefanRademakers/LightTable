export interface LayerThumbnailPreview {
  url: string;
  width: number;
  height: number;
}

export interface LayerThumbnailSet {
  pixels?: LayerThumbnailPreview;
  mask?: LayerThumbnailPreview;
}
