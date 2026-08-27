/**
 * Canonical Layers-tree geometry shared by rendering, hit testing and tests.
 * Keep these values aligned with the --lt-layer-* tokens in lighttable.css.
 */
export const LAYER_TREE_GEOMETRY = Object.freeze({
  rowMinHeight: 28,
  rowGap: 2,
  rowPaddingInline: 2,
  rowPaddingBlock: 0,
  prefixColumn: 18,
  prefixGap: 4,
  indent: 22,
  disclosureWidth: 18,
  thumbnailSlot: 42,
  thumbnailContentMax: 40,
  statusWidth: 46
});

export const layerRowInset = (depth: number): number =>
  LAYER_TREE_GEOMETRY.rowPaddingInline
  + Math.max(0, Math.floor(depth)) * LAYER_TREE_GEOMETRY.indent;

/** Child projections are not bordered rows, so include the owning row's 1px border. */
export const layerChildRowInset = (ownerDepth: number): number =>
  layerRowInset(ownerDepth + 1) + 1;
