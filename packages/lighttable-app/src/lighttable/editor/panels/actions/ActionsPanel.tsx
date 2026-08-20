import React, { useState } from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandDefinition
} from '@lighttable/command-contract';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from '../../../application/actions/semanticActionPlayback';
import type { SemanticActionLibrarySnapshot } from '../../../application/actions/semanticActionLibrary';
import { SegmentedControl } from '../../../../ui/SegmentedControl';
import { ActionRecorderView } from './ActionRecorderView';
import { CommandCatalogView, type CommandCatalogViewProps } from './CommandCatalogView';
import './actionsPanel.css';

export interface ActionsPanelProps extends Omit<CommandCatalogViewProps, 'definitions'> {
  readonly recording: ActionRecordingSnapshot;
  readonly playback: ActionPlaybackSnapshot;
  readonly library: SemanticActionLibrarySnapshot;
  readonly onStartRecording: () => void;
  readonly onStopRecording: () => void;
  readonly onClearRecording: () => void;
  readonly onPlay: () => void;
  readonly onPlayStep: (sequence: number) => void;
  readonly onStopPlayback: () => void;
  readonly onSaveAction: (name: string) => void;
  readonly onLoadAction: (id: string) => void;
  readonly onDeleteAction: (id: string) => void;
  readonly definitions?: readonly LightTableCommandDefinition[];
}

export const ActionsPanel: React.FC<ActionsPanelProps> = ({
  capabilities,
  onExecute,
  recording,
  playback,
  library,
  onStartRecording,
  onStopRecording,
  onClearRecording,
  onPlay,
  onPlayStep,
  onStopPlayback,
  onSaveAction,
  onLoadAction,
  onDeleteAction,
  definitions = LIGHTTABLE_COMMAND_DEFINITIONS
}) => {
  const [tab, setTab] = useState<'actions' | 'commands'>('actions');
  return <aside className="lighttable-panel lighttable-actions-panel" aria-label="Actions">
    <header className="lighttable-actions-panel__header">
      <strong>Actions</strong>
      <SegmentedControl className="lighttable-actions-panel__tabs" ariaLabel="Actions panel views"
        value={tab} onChange={setTab} options={[
          { value: 'actions', label: 'Actions' },
          { value: 'commands', label: 'Commands' }
        ]} />
    </header>
    {tab === 'actions'
      ? <ActionRecorderView recording={recording} playback={playback} library={library}
          definitions={definitions}
          onStart={onStartRecording} onStop={onStopRecording} onClear={onClearRecording}
          onPlay={onPlay} onPlayStep={onPlayStep} onStopPlayback={onStopPlayback}
          onSave={onSaveAction} onLoad={onLoadAction} onDelete={onDeleteAction} />
      : <CommandCatalogView capabilities={capabilities} onExecute={onExecute} definitions={definitions} />}
  </aside>;
};
