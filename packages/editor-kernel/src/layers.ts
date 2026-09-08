export type LayerCapability =
  | 'editable-pixels'
  | 'merge-down'
  | 'rasterize'
  | 'transform'
  | 'vector-edit';

export interface LayerCapabilities {
  readonly admitted: ReadonlySet<LayerCapability>;
  readonly blocked: ReadonlyMap<LayerCapability, string>;
}

export interface LayerCapabilityResolver<Layer = unknown> {
  resolve(layer: Layer): LayerCapabilities;
}
