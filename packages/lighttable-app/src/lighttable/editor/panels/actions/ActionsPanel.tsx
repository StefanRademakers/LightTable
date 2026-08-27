import React from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandDefinition
} from '@lighttable/command-contract';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';
import type { ActionRecordingEditResult } from '../../../application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from '../../../application/actions/semanticActionPlayback';
import type { SemanticActionLibrarySnapshot } from '../../../application/actions/semanticActionLibrary';
import { ActionRecorderView } from './ActionRecorderView';
import './actionsPanel.css';

export interface ActionsPanelProps {
  readonly recording: ActionRecordingSnapshot;
  readonly playback: ActionPlaybackSnapshot;
  readonly library: SemanticActionLibrarySnapshot;
  readonly onStartRecording: (name?: string, insertAfterSequence?: number) => void;
  readonly onStopRecording: () => void;
  readonly onClearRecording: () => void;
  readonly onPlay: () => void;
  readonly onPlayStep: (sequence: number) => void;
  readonly onPlayFromStep: (sequence: number) => void;
  readonly onStopPlayback: () => void;
  readonly onCreateActionSet: (name: string) => void;
  readonly onCreateAction: (setId: string, name: string) => Promise<string | null>;
  readonly onRenameActionSet: (id: string, name: string) => void;
  readonly onSelectActionSet: (id: string) => void;
  readonly onDeleteActionSet: (id: string) => void;
  readonly onMoveActionSet?: (id: string, direction: -1 | 1) => void;
  readonly onLoadAction: (id: string) => void;
  readonly onDeleteAction: (id: string) => void;
  readonly onRenameAction?: (id: string, name: string) => void;
  readonly onDuplicateAction?: (id: string) => void;
  readonly onMoveAction?: (id: string, direction: -1 | 1) => void;
  readonly onSetActionEnabled?: (id: string, enabled: boolean) => void;
  readonly onSetActionSetEnabled?: (id: string, enabled: boolean) => void;
  readonly onCreateVariable?: (sequence: number, parameterPath: string, name: string) => ActionRecordingEditResult;
  readonly onUpdateVariable?: (name: string, defaultValue: unknown) => ActionRecordingEditResult;
  readonly onDeleteVariable?: (name: string) => ActionRecordingEditResult;
  readonly onBindVariable?: (sequence: number, parameterPath: string, name: string) => ActionRecordingEditResult;
  readonly onBindResult?: (sequence: number, parameterPath: string,
    producerStep: number, resultPath: string) => ActionRecordingEditResult;
  readonly onRestoreLiteral?: (sequence: number, parameterPath: string) => ActionRecordingEditResult;
  readonly onReplaceStepParameters?: (sequence: number,
    parameters: Readonly<Record<string, unknown>>) => ActionRecordingEditResult;
  readonly onUpdateStepRationale?: (sequence: number, rationale: string) => ActionRecordingEditResult;
  readonly onSetStepEnabled?: (sequence: number, enabled: boolean) => ActionRecordingEditResult;
  readonly onSetStepInteractive?: (sequence: number, interactive: boolean) => ActionRecordingEditResult;
  readonly onDeleteStep?: (sequence: number) => ActionRecordingEditResult;
  readonly onDuplicateStep?: (sequence: number) => ActionRecordingEditResult;
  readonly onMoveStep?: (sequence: number, direction: -1 | 1) => ActionRecordingEditResult;
  readonly onContinueInteractivePlayback?: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly onCancelInteractivePlayback?: () => void;
  readonly definitions?: readonly LightTableCommandDefinition[];
}

export const ActionsPanel: React.FC<ActionsPanelProps> = ({
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
  onCreateAction,
  onRenameActionSet,
  onSelectActionSet,
  onDeleteActionSet,
  onMoveActionSet = () => undefined,
  onLoadAction,
  onDeleteAction,
  onRenameAction = () => undefined,
  onDuplicateAction = () => undefined,
  onMoveAction = () => undefined,
  onSetActionEnabled = () => undefined,
  onSetActionSetEnabled = () => undefined,
  onCreateVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onUpdateVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onDeleteVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onBindVariable = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onBindResult = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onRestoreLiteral = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onReplaceStepParameters = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onUpdateStepRationale = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onSetStepEnabled = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onSetStepInteractive = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onDeleteStep = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onDuplicateStep = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onMoveStep = () => ({ ok: false, error: 'Action editing is unavailable.' }),
  onContinueInteractivePlayback = () => undefined,
  onCancelInteractivePlayback = () => undefined,
  definitions = LIGHTTABLE_COMMAND_DEFINITIONS
}) => {
  return <aside className="lighttable-panel lighttable-actions-panel" aria-label="Actions">
    <ActionRecorderView recording={recording} playback={playback} library={library}
          definitions={definitions}
          onStart={onStartRecording} onStop={onStopRecording} onClear={onClearRecording}
          onPlay={onPlay}
          onPlayStep={onPlayStep} onPlayFromStep={onPlayFromStep}
          onStopPlayback={onStopPlayback}
          onCreateSet={onCreateActionSet} onRenameSet={onRenameActionSet}
          onCreateAction={onCreateAction}
          onSelectSet={onSelectActionSet} onDeleteSet={onDeleteActionSet} onMoveSet={onMoveActionSet}
          onLoad={onLoadAction} onDelete={onDeleteAction}
          onRename={onRenameAction} onDuplicate={onDuplicateAction} onMove={onMoveAction}
          onSetActionEnabled={onSetActionEnabled} onSetActionSetEnabled={onSetActionSetEnabled}
          onCreateVariable={onCreateVariable} onUpdateVariable={onUpdateVariable}
          onDeleteVariable={onDeleteVariable} onBindVariable={onBindVariable}
          onBindResult={onBindResult} onRestoreLiteral={onRestoreLiteral}
          onReplaceStepParameters={onReplaceStepParameters}
          onUpdateStepRationale={onUpdateStepRationale}
          onSetStepEnabled={onSetStepEnabled} onSetStepInteractive={onSetStepInteractive}
          onDeleteStep={onDeleteStep} onDuplicateStep={onDuplicateStep} onMoveStep={onMoveStep}
          onContinueInteractivePlayback={onContinueInteractivePlayback}
          onCancelInteractivePlayback={onCancelInteractivePlayback} />
  </aside>;
};
