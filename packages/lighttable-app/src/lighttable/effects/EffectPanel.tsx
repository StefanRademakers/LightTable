import React from 'react';
import { lightTableIcon } from '../../assets/icons';
import { PanelSection } from '../../ui/PanelSection';
import { SwitchControl } from '../../ui/SwitchControl';

interface EffectPanelProps {
  label: string;
  expanded: boolean;
  enabled: boolean;
  resetModifierActive: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEnabledChange: (enabled: boolean) => void;
  onReset: () => void;
  onRemove?: () => void;
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
  onRemove,
  children
}) => (
  <PanelSection
    label={label}
    expanded={expanded}
    onExpandedChange={onExpandedChange}
    className={`lighttable-effect${enabled ? '' : ' lighttable-group--disabled'}`}
    title={resetModifierActive ? `Reset ${label}` : label}
    onTogglePointerDown={(event) => {
          if (event.button === 0 && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            onReset();
          }
        }}
    onToggleClick={(event) => {
          if (event.button === 0 && (event.shiftKey || resetModifierActive)) {
            event.preventDefault();
            return;
          }
          onExpandedChange(!expanded);
        }}
    actions={<>
        <button type="button" className="lighttable-group__reset" onClick={onReset} aria-label={`Reset ${label}`} title={`Reset ${label}`}>
          <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
        </button>
        {onRemove ? (
          <button
            type="button"
            className="lighttable-group__remove"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
          >
            <img src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" />
          </button>
        ) : null}
        <SwitchControl
          checked={enabled}
          onCheckedChange={onEnabledChange}
          label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
        />
      </>}
  >
    {children}
  </PanelSection>
);
