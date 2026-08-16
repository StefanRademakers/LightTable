import React from 'react';
import type { PropertiesInspectorView } from '../../application/properties/propertiesInspectorTarget';

export interface PropertiesPanelProps {
  readonly view: PropertiesInspectorView;
  readonly grade: React.ReactNode;
  readonly lensFx: React.ReactNode;
  readonly effects: React.ReactNode;
  readonly text: React.ReactNode;
}

/** Routes one explicit Layers-tree target to an independently owned editor. */
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  view,
  grade,
  lensFx,
  effects,
  text
}) => {
  if (view === 'grade') return grade;
  if (view === 'lens-fx') return lensFx;
  if (view === 'effects') return effects;
  if (view === 'text') return text;
  return (
    <aside className="lighttable-panel" aria-label="Properties">
      <div className="lighttable-panel__empty">
        Select editable layer content, processing, text, or an effect.
      </div>
    </aside>
  );
};
