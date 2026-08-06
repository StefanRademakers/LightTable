import type { ImageDocument } from './documentTypes';
import { createRasterLayer, setLayerTransform } from './documentCommands';
import { findRasterLayer, walkLayerTree } from './layerTree';

export interface PlacedRasterLayerOptions {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

/** Creates a tight native raster whose transform owns document-space placement. */
export const createPlacedRasterLayer = (
  document: ImageDocument,
  options: PlacedRasterLayerOptions
): ImageDocument => {
  if (!options.name.trim() || !Number.isInteger(options.width) || !Number.isInteger(options.height)
    || options.width < 1 || options.height < 1 || options.width > 32_768 || options.height > 32_768
    || options.width * options.height > 268_435_456 || !Number.isFinite(options.x)
    || !Number.isFinite(options.y)) return document;
  const names = new Set(walkLayerTree(document.layers).map(({ node }) => node.name));
  let name = options.name.trim();
  for (let suffix = 2; names.has(name); suffix += 1) name = `${options.name.trim()} ${suffix}`;
  const created = createRasterLayer(document, name);
  const layerId = created.activeLayerId;
  const raster = layerId ? findRasterLayer(created, layerId) : null;
  if (!raster || !layerId) return document;
  raster.width = options.width;
  raster.height = options.height;
  return setLayerTransform(created, layerId, {
    a: 1, b: 0, c: 0, d: 1, tx: options.x, ty: options.y
  });
};
