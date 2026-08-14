/**
 * Canonical Layers-tree geometry shared by rendering, hit testing and tests.
 * Keep these values aligned with the --lt-layer-* tokens in lighttable.css.
 */
export const LAYER_TREE_GEOMETRY = Object.freeze({
  rowMinHeight: 28,
  rowGap: 2,
  rowPaddingInline: 5,
  rowPaddingBlock: 0,
  indent: 16,
  disclosureWidth: 14,
  thumbnailSlot: 42,
  thumbnailContentMax: 40,
  statusWidth: 46
});

export const layerRowInset = (depth: number): number =>
  LAYER_TREE_GEOMETRY.rowPaddingInline
  + Math.max(0, Math.floor(depth)) * LAYER_TREE_GEOMETRY.indent;
