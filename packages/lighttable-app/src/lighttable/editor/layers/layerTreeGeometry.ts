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

/**
 * Visibility stays in the fixed first column. This spacer indents only the
 * tree content that follows it, while accounting for the flex gap on each side.
 */
export const layerDepthSpacerWidth = (depth: number): number => {
  const normalizedDepth = Math.max(0, Math.floor(depth));
  return normalizedDepth === 0
    ? 0
    : normalizedDepth * LAYER_TREE_GEOMETRY.indent - LAYER_TREE_GEOMETRY.prefixGap;
};

/** Child projections are not bordered rows, so include the owning row's 1px border. */
export const layerChildRowInset = (ownerDepth: number): number =>
  layerRowInset(ownerDepth + 1) + 1;
