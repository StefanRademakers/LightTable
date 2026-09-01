export type AnchorGridPosition = 0 | 0.5 | 1;

export interface AnchorGridProps {
  x: AnchorGridPosition;
  y: AnchorGridPosition;
  onChange: (x: AnchorGridPosition, y: AnchorGridPosition) => void;
  disabled?: boolean;
  ariaLabel?: string;
  tabIndex?: number;
}

const POSITIONS: readonly AnchorGridPosition[] = [0, 0.5, 1];

/** Compact 3 × 3 origin/anchor picker. */
export function AnchorGrid({
  x, y, onChange, disabled = false, ariaLabel = 'Anchor position', tabIndex = -1
}: AnchorGridProps) {
  return <div className="ui-anchor-grid" role="radiogroup" aria-label={ariaLabel}
    data-ui-component="anchor-grid" data-suite-control="anchor-grid">
    {POSITIONS.flatMap((row) => POSITIONS.map((column) => {
      const selected = column === x && row === y;
      return <button key={`${column}-${row}`} type="button" role="radio" tabIndex={tabIndex}
        aria-checked={selected} disabled={disabled}
        aria-label={`${row === 0 ? 'Top' : row === 0.5 ? 'Center' : 'Bottom'} ${column === 0 ? 'left' : column === 0.5 ? 'center' : 'right'}`}
        data-selected={selected || undefined} onClick={() => onChange(column, row)}><span /></button>;
    }))}
  </div>;
}
