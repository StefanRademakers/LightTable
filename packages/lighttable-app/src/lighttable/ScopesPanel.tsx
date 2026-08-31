import { ScopesPanel as ScopeViews, type ScopesPanelProps as ScopeViewsProps } from '@lighttable/ui';
import React from 'react';
import { skinToneReferenceEnd, vectorscopeTargetPositions, type ScopeSettings } from './scopes';

interface ScopesPanelProps extends Omit<ScopeViewsProps, 'range' | 'targets' | 'skinEnd' | 'graticule' | 'skinTone' | 'onRangeChange'> {
  settings: ScopeSettings;
  onSettingsChange: (settings: ScopeSettings) => void;
}

const targets = vectorscopeTargetPositions();
const skinEnd = skinToneReferenceEnd();

/** Editor data/commands stay here; the package owns scope presentation. */
export const ScopesPanel: React.FC<ScopesPanelProps> = ({ settings, onSettingsChange, ...props }) => (
  <ScopeViews {...props} range={settings.vectorscopeRange}
    targets={targets} skinEnd={skinEnd}
    graticule={settings.vectorscopeGraticule} skinTone={settings.vectorscopeSkinTone}
    onRangeChange={vectorscopeRange => onSettingsChange({ ...settings, vectorscopeRange })} />
);
