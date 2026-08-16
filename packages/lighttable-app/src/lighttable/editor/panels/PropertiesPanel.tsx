import React from 'react';
import type { PropertiesInspectorView } from '../../application/properties/propertiesInspectorTarget';

export interface PropertiesPanelProps {
  readonly view: PropertiesInspectorView;
  readonly editors: Partial<Record<Exclude<PropertiesInspectorView, 'empty'>, React.ReactNode>>;
}

/** Routes one explicit Layers-tree target to an independently owned editor. */
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  view,
  editors
}) => {
  if (view !== 'empty' && editors[view]) return editors[view];
  return (
    <aside className="lighttable-panel" aria-label="Properties">
      <div className="lighttable-panel__empty">
        Select editable layer content, processing, text, or an effect.
      </div>
    </aside>
  );
};
