import { IconButton, MaskIcon, PanelSection } from '@lighttable/ui';
import React from 'react';
import { lightTableIcon } from '../../assets/icons';

import { SwitchControl } from '@lighttable/ui';

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
  contentClassName?: string;
  keepMounted?: boolean;
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
  children,
  contentClassName,
  keepMounted
}) => (
  <PanelSection
    label={label}
    expanded={expanded}
    onExpandedChange={onExpandedChange}
    className={`lighttable-effect${enabled ? '' : ' lighttable-group--disabled'}`}
    contentClassName={contentClassName}
    keepMounted={keepMounted}
    title={resetModifierActive ? `Reset ${label}` : label}
    onToggleClick={(event) => {
      if (event.shiftKey || resetModifierActive) {
        event.preventDefault();
        onReset();
      }
    }}
    actions={<>
        <IconButton variant="quiet" type="button" onClick={onReset} aria-label={`Reset ${label}`} title={`Reset ${label}`} icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
        {onRemove ? (
          <IconButton variant="quiet" type="button" onClick={onRemove} aria-label={`Remove ${label}`} title={`Remove ${label}`} icon={<MaskIcon src={lightTableIcon('layer_trash.png')} />} />
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
