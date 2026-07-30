import React from 'react';
import { lightTableIcon } from '../../assets/icons';

interface EffectPanelProps {
  label: string;
  expanded: boolean;
  enabled: boolean;
  resetModifierActive: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEnabledChange: (enabled: boolean) => void;
  onReset: () => void;
  children: React.ReactNode;
}

export const EffectPanel: React.FC<EffectPanelProps> = ({
  label,
  expanded,
  enabled,
  resetModifierActive,
  onExpandedChange,
  onEnabledChange,
  onReset,
  children
}) => (
  <section className={`lighttable-group lighttable-effect${enabled ? '' : ' lighttable-group--disabled'}`}>
    <div className="lighttable-group__header">
      <button
        type="button"
        className="lighttable-group__toggle"
        onPointerDown={(event) => {
          if (event.button === 0 && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            onReset();
          }
        }}
        onClick={(event) => {
          if (event.button === 0 && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            onReset();
            return;
          }
          onExpandedChange(!expanded);
        }}
        aria-expanded={expanded}
        title={resetModifierActive ? `Reset ${label}` : label}
      >
        <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
        <strong>{label}</strong>
      </button>
      <div className="lighttable-group__actions">
        <button type="button" className="lighttable-group__reset" onClick={onReset} aria-label={`Reset ${label}`} title={`Reset ${label}`}>
          <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lighttable-group__visibility"
          onClick={() => onEnabledChange(!enabled)}
          aria-label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
          title={`${enabled ? 'Disable' : 'Enable'} ${label}`}
        >
          <img src={lightTableIcon(enabled ? 'visible.png' : 'visible_off.png')} alt="" aria-hidden="true" />
        </button>
      </div>
    </div>
    {expanded ? <div className="lighttable-group__controls">{children}</div> : null}
  </section>
);
