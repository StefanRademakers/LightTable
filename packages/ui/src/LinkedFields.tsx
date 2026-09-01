import type { ReactNode } from 'react';

export interface LinkedFieldsProps {
  firstLabel: ReactNode;
  secondLabel: ReactNode;
  firstField: ReactNode;
  secondField: ReactNode;
  linked: boolean;
  onLinkedChange: (linked: boolean) => void;
  tabIndex?: number;
  linkLabel?: string;
  linkIcon?: ReactNode;
}

/** Two aligned fields with one proportion/constrain control between them. */
export function LinkedFields({
  firstLabel,
  secondLabel,
  firstField,
  secondField,
  linked,
  onLinkedChange,
  tabIndex = -1,
  linkLabel = linked ? 'Unlink values' : 'Link values',
  linkIcon
}: LinkedFieldsProps) {
  return <div className="ui-linked-fields" data-ui-component="linked-fields" data-suite-control="linked-fields">
    <span className="ui-linked-fields__label">{firstLabel}</span>
    <span className="ui-linked-fields__field">{firstField}</span>
    <span className="ui-linked-fields__label">{secondLabel}</span>
    <span className="ui-linked-fields__field">{secondField}</span>
    <button type="button" className="ui-linked-fields__link" tabIndex={tabIndex}
      aria-label={linkLabel} title={linkLabel} aria-pressed={linked}
      onClick={() => onLinkedChange(!linked)}>
      <span className="ui-linked-fields__link-icon" aria-hidden="true">
        {linkIcon ?? <span className="ui-linked-fields__chain" />}
      </span>
    </button>
  </div>;
}
