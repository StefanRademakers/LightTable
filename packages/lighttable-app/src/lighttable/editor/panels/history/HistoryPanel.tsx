import React from 'react';
import { ButtonBase } from '../../../../ui/ButtonBase';
import { SquareIconButton } from '../../../../ui/SquareIconButton';
import type { DocumentCommandHistorySnapshot } from '../../../application/commands/documentCommandHistory';
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
  const current = history.states.find((state) => state.current) ?? history.states[0];
  return <aside className="lighttable-panel lighttable-history-panel" aria-label="History">
    <div className="lighttable-history-panel__states" role="listbox" aria-label="Document history">
      {history.states.map((state) => <ButtonBase key={`${state.id}:${state.position}`}
        className={[
          'lighttable-history-panel__state',
          state.current ? 'is-current' : '',
          state.future ? 'is-future' : ''
        ].filter(Boolean).join(' ')}
        role="option" aria-selected={state.current} disabled={history.busy}
        onClick={() => onNavigate(state.position)}>
        <span className="lighttable-history-panel__state-marker" aria-hidden="true">
          {state.current ? '▸' : ''}
        </span>
        <span>{state.position === 0 ? documentName || state.label : state.label}</span>
      </ButtonBase>)}
    </div>
    <footer className="lighttable-history-panel__footer">
      <SquareIconButton size="compact" icon="⌫" aria-label="Delete current history state"
        title="Delete current history state and later states"
        disabled={history.busy || !current || current.position === 0}
        onClick={() => current && onDeleteFrom(current.position)} />
      <SquareIconButton size="compact" icon="×" aria-label="Clear history"
        title="Clear History" disabled={history.busy || history.states.length <= 1}
        onClick={onClear} />
    </footer>
  </aside>;
};
