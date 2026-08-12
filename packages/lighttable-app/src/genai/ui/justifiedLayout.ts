export interface JustifiedLayoutInput {
  readonly key: string;
  readonly aspectRatio: number;
}

export interface JustifiedLayoutItem extends JustifiedLayoutInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const usableAspectRatio = (aspectRatio: number): number =>
  Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

/** Pure media-row layout. The fixed footer is accounted for only vertically. */
export const buildJustifiedLayout = (
  items: readonly JustifiedLayoutInput[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
  footerHeight: number
): { readonly height: number; readonly items: readonly JustifiedLayoutItem[] } => {
  if (!items.length || containerWidth <= 0) return { height: 0, items: [] };
  const rows: JustifiedLayoutInput[][] = [];
  let row: JustifiedLayoutInput[] = [];
  let estimatedWidth = 0;
  for (const item of items) {
    const nextWidth = usableAspectRatio(item.aspectRatio) * targetRowHeight;
    estimatedWidth += (row.length ? gap : 0) + nextWidth;
    row.push(item);
    if (estimatedWidth >= containerWidth) {
      rows.push(row); row = []; estimatedWidth = 0;
    }
  }
  if (row.length) rows.push(row);

  const output: JustifiedLayoutItem[] = [];
  let y = 0;
  rows.forEach((itemsInRow, rowIndex) => {
    const gaps = gap * Math.max(0, itemsInRow.length - 1);
    const ratioTotal = itemsInRow.reduce((sum, item) => sum + usableAspectRatio(item.aspectRatio), 0);
    const naturalWidth = ratioTotal * targetRowHeight + gaps;
    const justify = rowIndex < rows.length - 1 || naturalWidth > containerWidth;
    const height = justify ? Math.max(1, (containerWidth - gaps) / ratioTotal) : targetRowHeight;
    let x = 0;
    itemsInRow.forEach((item, itemIndex) => {
      const width = justify && itemIndex === itemsInRow.length - 1
        ? Math.max(1, containerWidth - x)
        : Math.max(1, height * usableAspectRatio(item.aspectRatio));
      output.push({ ...item, x, y, width, height });
      x += width + gap;
    });
    y += height + footerHeight + gap;
  });
  return { height: Math.max(0, y - gap), items: output };
};
