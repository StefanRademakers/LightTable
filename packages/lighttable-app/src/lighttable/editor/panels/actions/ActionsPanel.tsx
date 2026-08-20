import React, { useState } from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandDefinition
} from '@lighttable/command-contract';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';
import type { ActionRecordingEditResult } from '../../../application/actions/semanticActionRecorder';
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
  readonly onPlayFromStep: (sequence: number) => void;
  readonly onStopPlayback: () => void;
  readonly onCreateActionSet: (name: string) => void;
  readonly onRenameActionSet: (id: string, name: string) => void;
  readonly onSelectActionSet: (id: string) => void;
  readonly onDeleteActionSet: (id: string) => void;
  readonly onSaveAction: (name: string) => void;
  readonly onLoadAction: (id: string) => void;
  readonly onDeleteAction: (id: string) => void;
  readonly onCreateVariable?: (sequence: number, parameterPath: string, name: string) => ActionRecordingEditResult;
  readonly onUpdateVariable?: (name: string, defaultValue: unknown) => ActionRecordingEditResult;
  readonly onDeleteVariable?: (name: string) => ActionRecordingEditResult;
  readonly onBindVariable?: (sequence: number, parameterPath: string, name: string) => ActionRecordingEditResult;
  readonly onBindResult?: (sequence: number, parameterPath: string,
    producerStep: number, resultPath: string) => ActionRecordingEditResult;
  readonly onRestoreLiteral?: (sequence: number, parameterPath: string) => ActionRecordingEditResult;
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
  onPlayFromStep,
  onStopPlayback,
  onCreateActionSet,
  onRenameActionSet,
  onSelectActionSet,
  onDeleteActionSet,
  onSaveAction,
  onLoadAction,
  onDeleteAction,
  onCreateVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onUpdateVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onDeleteVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onBindVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onBindResult = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onRestoreLiteral = () => ({ ok: false, error: 'Action editing is unavailable.' }),
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
          onPlay={onPlay} onPlayStep={onPlayStep} onPlayFromStep={onPlayFromStep}
          onStopPlayback={onStopPlayback}
          onCreateSet={onCreateActionSet} onRenameSet={onRenameActionSet}
          onSelectSet={onSelectActionSet} onDeleteSet={onDeleteActionSet}
          onSave={onSaveAction} onLoad={onLoadAction} onDelete={onDeleteAction}
          onCreateVariable={onCreateVariable} onUpdateVariable={onUpdateVariable}
          onDeleteVariable={onDeleteVariable} onBindVariable={onBindVariable}
          onBindResult={onBindResult} onRestoreLiteral={onRestoreLiteral} />
      : <CommandCatalogView capabilities={capabilities} onExecute={onExecute} definitions={definitions} />}
  </aside>;
};
