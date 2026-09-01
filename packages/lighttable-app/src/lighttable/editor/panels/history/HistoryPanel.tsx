import React, { useState } from 'react';
import { lightTableIcon } from '../../../../assets/icons';
import { ButtonBase } from '../../../../ui/ButtonBase';
import { Menu, PanelFooter } from '@lighttable/ui';
import type { DocumentCommandHistorySnapshot } from '../../../application/commands/documentCommandHistory';
import {
  PanelStackButtonRow,
  handlePanelCollectionNavigation
} from '../../ui/PanelStackPrimitives';
import './historyPanel.css';

export interface HistoryPanelProps {
  readonly history: DocumentCommandHistorySnapshot;
  readonly documentName?: string;
  readonly onNavigate: (position: number) => void;
  readonly onDeleteFrom: (position: number) => void;
  readonly onClear: () => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  history,
  documentName,
  onNavigate,
  onDeleteFrom,
  onClear
}) => {
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const current = history.states.find((state) => state.current) ?? history.states[0];
  return <aside className="lighttable-panel lighttable-history-panel" aria-label="History">
    <div className="lighttable-history-panel__states" role="listbox" aria-label="Document history"
      data-tree-keyboard-collection
      data-editor-native-tab-navigation="tab-only">
      {history.states.map((state) => <PanelStackButtonRow key={`${state.id}:${state.position}`}
        className={`lighttable-history-panel__state${state.future ? ' is-future' : ''}`}
        selected={state.current} active={state.current}
        role="option" aria-selected={state.current} disabled={history.busy}
        onKeyDown={(event) => handlePanelCollectionNavigation(event, '[role="option"]')}
        onClick={() => onNavigate(state.position)}>
        <span className="lighttable-history-panel__state-marker" aria-hidden="true">
          {state.current ? '▸' : ''}
        </span>
        <span>{state.position === 0 ? documentName || state.label : state.label}</span>
      </PanelStackButtonRow>)}
    </div>
    <PanelFooter className="lighttable-history-panel__footer" aria-label="History controls">
      <ButtonBase type="button"
        aria-label="Delete current history state"
        title="Delete current history state and later states"
        disabled={history.busy || !current || current.position === 0}
        onClick={() => current && onDeleteFrom(current.position)}><img
          src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" /></ButtonBase>
      <ButtonBase type="button"
        aria-label="History menu" title="History menu"
        onClick={(event) => setMenu({ x: event.clientX, y: event.clientY })}><img
          src={lightTableIcon('more_menu.png')} alt="" aria-hidden="true" /></ButtonBase>
    </PanelFooter>
    <Menu data-editor-native-tab-navigation open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0}
      width={170} onClose={() => setMenu(null)} options={[{
        value: 'clear', label: 'Clear History', disabled: history.busy || history.states.length <= 1,
        onClick: onClear
      }]} />
  </aside>;
};
