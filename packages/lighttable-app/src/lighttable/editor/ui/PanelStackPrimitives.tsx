import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PropsWithChildren
} from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { ButtonBase } from '../../../ui/ButtonBase';

interface PanelStackRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly selected?: boolean;
  readonly active?: boolean;
}

const stackRowClassName = (className: string | undefined, selected: boolean, active: boolean) => [
  'lighttable-panel-stack-row',
  selected ? 'lighttable-panel-stack-row--selected' : '',
  active ? 'lighttable-panel-stack-row--active' : '',
  className ?? ''
].filter(Boolean).join(' ');

export const PanelStackRow = forwardRef<HTMLDivElement, PanelStackRowProps>(function PanelStackRow({
  selected = false,
  active = false,
  className,
  ...props
}, ref) {
  return <div ref={ref} {...props} className={stackRowClassName(className, selected, active)} />;
});

interface PanelStackButtonRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly selected?: boolean;
  readonly active?: boolean;
}

export const PanelStackButtonRow = forwardRef<HTMLButtonElement, PanelStackButtonRowProps>(
  function PanelStackButtonRow({ selected = false, active = false, className, type = 'button', ...props }, ref) {
    return <ButtonBase ref={ref} type={type} {...props}
      className={stackRowClassName(className, selected, active)} />;
  }
);

export const PanelStackDisclosure: React.FC<{
  readonly expanded: boolean;
  readonly label: string;
  readonly className?: string;
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
}> = ({ expanded, label, className, onClick }) => (
  <ButtonBase type="button"
    className={[
      'lighttable-panel-stack-disclosure',
      expanded ? '' : 'lighttable-panel-stack-disclosure--collapsed',
      className ?? ''
    ].filter(Boolean).join(' ')}
    onClick={onClick} aria-label={label} title={label}>
    <img src={lightTableIcon('chevron_layer.png')} alt="" aria-hidden="true" />
  </ButtonBase>
);

export const PanelStackFooter: React.FC<PropsWithChildren<{
  readonly className?: string;
  readonly ariaLabel?: string;
}>> = ({ className, ariaLabel, children }) => (
  <footer className={['lighttable-panel-stack-footer', className ?? ''].filter(Boolean).join(' ')}
    aria-label={ariaLabel}>
    {children}
  </footer>
);
