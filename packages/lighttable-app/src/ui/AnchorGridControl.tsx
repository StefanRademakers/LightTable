import type { CanvasAnchor } from '../lighttable/application/documentGeometry/documentGeometryModel';

export interface AnchorGridControlProps {
  readonly x: CanvasAnchor;
  readonly y: CanvasAnchor;
  readonly onChange: (x: CanvasAnchor, y: CanvasAnchor) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}

const POSITIONS: readonly CanvasAnchor[] = [0, 0.5, 1];

/** Canonical 3 x 3 origin/anchor picker shared by geometry and layout workflows. */
export const AnchorGridControl = ({
  x, y, onChange, disabled = false, ariaLabel = 'Anchor position'
}: AnchorGridControlProps) => (
  <div className="anchor-grid-control" role="radiogroup" aria-label={ariaLabel}
    data-suite-control="anchor-grid-control">
    {POSITIONS.flatMap((row) => POSITIONS.map((column) => {
      const selected = column === x && row === y;
      return <button key={`${column}-${row}`} type="button" role="radio" aria-checked={selected}
        aria-label={`${row === 0 ? 'Top' : row === 0.5 ? 'Center' : 'Bottom'} ${column === 0 ? 'left' : column === 0.5 ? 'center' : 'right'}`}
        className={selected ? 'is-selected' : undefined} disabled={disabled}
        onClick={() => onChange(column, row)}><span /></button>;
    }))}
  </div>
);
