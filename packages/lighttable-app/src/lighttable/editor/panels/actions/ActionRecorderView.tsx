import React, { useEffect, useMemo, useState } from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandDefinition
} from '@lighttable/command-contract';
import { ButtonBase } from '../../../../ui/ButtonBase';
import { FormSelect } from '../../../../ui/FormSelect';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';
import type { ActionRecordingEditResult } from '../../../application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from '../../../application/actions/semanticActionPlayback';
import {
  LIGHTTABLE_MAX_ACTION_SETS,
  type SemanticActionLibrarySnapshot
} from '../../../application/actions/semanticActionLibrary';
import { ActionBindingEditor, ActionVariableRow } from './ActionBindingEditor';
import { ActionStepParameterEditor } from './ActionStepParameterEditor';
import { ActionStepRationaleEditor } from './ActionStepRationaleEditor';

export interface ActionRecorderViewProps {
  readonly recording: ActionRecordingSnapshot;
  readonly playback: ActionPlaybackSnapshot;
  readonly library: SemanticActionLibrarySnapshot;
  readonly definitions?: readonly LightTableCommandDefinition[];
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onClear: () => void;
  readonly onPlay: () => void;
  readonly onPlayStep: (sequence: number) => void;
  readonly onPlayFromStep: (sequence: number) => void;
  readonly onStopPlayback: () => void;
  readonly onCreateSet: (name: string) => void;
  readonly onRenameSet: (id: string, name: string) => void;
  readonly onSelectSet: (id: string) => void;
  readonly onDeleteSet: (id: string) => void;
  readonly onSave: (name: string) => void;
  readonly onLoad: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateVariable: (sequence: number, path: string, name: string) => ActionRecordingEditResult;
  readonly onUpdateVariable: (name: string, value: unknown) => ActionRecordingEditResult;
  readonly onDeleteVariable: (name: string) => ActionRecordingEditResult;
  readonly onBindVariable: (sequence: number, path: string, name: string) => ActionRecordingEditResult;
  readonly onBindResult: (sequence: number, path: string, producer: number,
    resultPath: string) => ActionRecordingEditResult;
  readonly onRestoreLiteral: (sequence: number, path: string) => ActionRecordingEditResult;
  readonly onReplaceStepParameters: (sequence: number,
    parameters: Readonly<Record<string, unknown>>) => ActionRecordingEditResult;
  readonly onUpdateStepRationale: (sequence: number, rationale: string) => ActionRecordingEditResult;
}

const formatted = (value: unknown): string => JSON.stringify(value, (_key, candidate) => {
  const binding = candidate?.$lighttableResult;
  if (binding && Number.isInteger(binding.step) && typeof binding.path === 'string') {
    return `$step${binding.step}.${binding.path}`;
  }
  const variable = candidate?.$lighttableVariable;
  return variable && typeof variable.name === 'string' ? `$${variable.name}` : candidate;
}, 2);

export const ActionRecorderView: React.FC<ActionRecorderViewProps> = ({
  recording,
  playback,
  library,
  definitions = LIGHTTABLE_COMMAND_DEFINITIONS,
  onStart,
  onStop,
  onClear,
  onPlay,
  onPlayStep,
  onPlayFromStep,
  onStopPlayback,
  onCreateSet,
  onRenameSet,
  onSelectSet,
  onDeleteSet,
  onSave,
  onLoad,
  onDelete,
  onCreateVariable, onUpdateVariable, onDeleteVariable, onBindVariable, onBindResult,
  onRestoreLiteral,
  onReplaceStepParameters,
  onUpdateStepRationale
}) => {
  const [name, setName] = useState(recording.name);
  useEffect(() => setName(recording.name), [recording.id, recording.name]);
  const selectedSet = library.sets.find(({ id }) => id === library.selectedSetId) ?? library.sets[0];
  const [actionSetName, setActionSetName] = useState(selectedSet?.name ?? '');
  useEffect(() => setActionSetName(selectedSet?.name ?? ''), [selectedSet?.id, selectedSet?.name]);
  const labels = useMemo(() => new Map<string, string>(
    definitions.map(({ id, label }) => [id, label])
  ), [definitions]);
  const replayableCount = recording.steps.filter(({ replayable }) => replayable).length;
  const setActions = library.actions.filter(({ setId }) => setId === library.selectedSetId);
  const busy = playback.status === 'running';
  return <section className="lighttable-action-recorder" aria-labelledby="action-recorder-title">
    <header className="lighttable-action-recorder__action-header">
      <div>
        <strong id="action-recorder-title">{recording.name}</strong>
        <span>{recording.steps.length} steps</span>
      </div>
      <span className={`lighttable-action-recorder__status is-${recording.status}`}>
        {recording.status}
      </span>
    </header>
    <div className="lighttable-action-recorder__controls" aria-label="Action controls">
      {recording.status === 'recording'
        ? <ButtonBase type="button" onClick={onStop} disabled={busy}>Stop</ButtonBase>
        : <ButtonBase type="button" onClick={onStart} disabled={busy}>Record</ButtonBase>}
      {busy
        ? <ButtonBase type="button" onClick={onStopPlayback}>Stop playback</ButtonBase>
        : <ButtonBase type="button" onClick={onPlay}
            disabled={recording.status === 'recording' || replayableCount === 0}>Play</ButtonBase>}
      <ButtonBase type="button" onClick={onClear}
        disabled={busy || recording.steps.length === 0}>Clear</ButtonBase>
    </div>
    <div className="lighttable-action-recorder__library" aria-label="Saved Actions">
      <label>Set
        <FormSelect aria-label="Action Set" value={library.selectedSetId}
          onChange={(event) => onSelectSet(event.currentTarget.value)} disabled={busy}>
          {library.sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
        </FormSelect>
      </label>
      <span className="lighttable-action-recorder__set-actions">
        <ButtonBase type="button" onClick={() => onCreateSet(actionSetName)}
          disabled={busy || !actionSetName.trim()
            || library.sets.length >= LIGHTTABLE_MAX_ACTION_SETS}>New set</ButtonBase>
        <ButtonBase type="button" onClick={() => onRenameSet(library.selectedSetId, actionSetName)}
          disabled={busy || !actionSetName.trim()}>Rename</ButtonBase>
        <ButtonBase type="button" onClick={() => onDeleteSet(library.selectedSetId)}
          disabled={busy || library.sets.length <= 1}>Delete set</ButtonBase>
      </span>
      <label>Set name
        <input aria-label="Action Set name" value={actionSetName} maxLength={255}
          onChange={(event) => setActionSetName(event.currentTarget.value)} disabled={busy} />
      </label>
      <span />
      <label>Action name
        <input aria-label="Action name" value={name} maxLength={255}
          onChange={(event) => setName(event.currentTarget.value)} disabled={busy} />
      </label>
      <ButtonBase type="button" onClick={() => onSave(name)} disabled={busy
        || recording.status !== 'stopped' || recording.steps.length === 0
        || recording.steps.some(({ replayable }) => !replayable) || !name.trim()}>Save</ButtonBase>
      <label>Saved
        <FormSelect aria-label="Saved Actions" value={library.selectedId ?? ''}
          onChange={(event) => event.currentTarget.value && onLoad(event.currentTarget.value)}>
          <option value="">No saved Actions</option>
          {setActions.map((action) => <option key={action.id} value={action.id}>
            {action.name} ({action.recording.steps.length})
          </option>)}
        </FormSelect>
      </label>
      <ButtonBase type="button" onClick={() => library.selectedId && onLoad(library.selectedId)}
        disabled={busy || !library.selectedId}>Load</ButtonBase>
      <ButtonBase type="button" onClick={() => library.selectedId && onDelete(library.selectedId)}
        disabled={busy || !library.selectedId}>Delete</ButtonBase>
      {library.error ? <p className="lighttable-action-recorder__warning" role="alert">{library.error}</p> : null}
    </div>
    {playback.status !== 'idle'
      ? <p className={`lighttable-action-recorder__playback is-${playback.status}`} role="status">
          Playback: {playback.status}{playback.currentSequence ? ` at step ${playback.currentSequence}` : ''}
          {playback.taskProgress === null ? '' : ` · ${Math.round(playback.taskProgress * 100)}%`}
        </p>
      : null}
    {recording.limitReached
      ? <p className="lighttable-action-recorder__warning" role="alert">Recorder limit reached; recording has paused.</p>
      : null}
    {recording.variables.length > 0 ? <section className="lighttable-action-recorder__variables"
      aria-label="Action variables">
      <h3>Variables</h3>
      {recording.variables.map((variable) => <ActionVariableRow key={variable.name}
        variable={variable} disabled={busy || recording.status !== 'stopped'}
        onUpdate={(value) => onUpdateVariable(variable.name, value)}
        onDelete={() => onDeleteVariable(variable.name)} />)}
    </section> : null}
    {recording.steps.length === 0
      ? <p className="lighttable-action-recorder__empty">
          Press Record, then use LightTable normally. Recorded command steps will appear here.
        </p>
      : <ol className="lighttable-action-recorder__steps">
        {recording.steps.map((step) => {
          const playbackResult = playback.results.find(({ sequence }) => sequence === step.sequence);
          const displayStatus = playbackResult?.status
            ?? (playback.status !== 'idle' && playback.status !== 'running' && !step.replayable
              ? 'skipped'
              : step.outcome);
          return <li key={`${step.sequence}-${step.requestId}`}
            className={playback.currentSequence === step.sequence ? 'is-current' : undefined}>
            <details>
              <summary>
                <span className="lighttable-action-recorder__step-name">
                  <b>{step.sequence}</b>
                  <span><strong>{labels.get(step.command) ?? step.command}</strong><code>{step.command}</code></span>
                </span>
                <span className={`is-${displayStatus}`}>
                  {displayStatus}
                </span>
              </summary>
              <div className="lighttable-action-recorder__step-controls">
                <ButtonBase type="button" onClick={() => onPlayStep(step.sequence)}
                  disabled={busy || recording.status === 'recording' || !step.replayable}>Play step</ButtonBase>
                <ButtonBase type="button" onClick={() => onPlayFromStep(step.sequence)}
                  disabled={busy || recording.status === 'recording' || !step.replayable}>Play from here</ButtonBase>
                <span>{step.durationMs} ms recorded</span>
              </div>
              <dl>
                <div><dt>Document</dt><dd><code>{step.documentId ?? 'workspace'}</code></dd></div>
                <div><dt>Origin</dt><dd>{step.origin}</dd></div>
                <div><dt>Replayable</dt><dd>{step.replayable ? 'yes' : 'no'}</dd></div>
              </dl>
              {step.note ? <p>{step.note}</p> : null}
              {step.rationale ? <p className="lighttable-action-recorder__rationale">
                {step.rationale}
              </p> : null}
              {playbackResult?.message ? <p className="lighttable-action-recorder__warning">{playbackResult.message}</p> : null}
              <ActionStepRationaleEditor rationale={step.rationale}
                disabled={busy || recording.status !== 'stopped'}
                onApply={(rationale) => onUpdateStepRationale(step.sequence, rationale)} />
              <h4>Parameters</h4>
              <pre>{formatted(step.parameters)}</pre>
              <h4>Edit parameters</h4>
              <ActionStepParameterEditor step={step}
                priorSteps={recording.steps.filter((candidate) => candidate.sequence < step.sequence)}
                variables={recording.variables} disabled={busy || recording.status !== 'stopped'}
                onApply={(parameters) => onReplaceStepParameters(step.sequence, parameters)} />
              <h4>Bindings</h4>
              <ActionBindingEditor step={step}
                priorSteps={recording.steps.filter((candidate) => candidate.sequence < step.sequence)}
                variables={recording.variables} disabled={busy || recording.status !== 'stopped'}
                onCreateVariable={(path, variableName) => onCreateVariable(step.sequence, path, variableName)}
                onBindVariable={(path, variableName) => onBindVariable(step.sequence, path, variableName)}
                onBindResult={(path, producer, resultPath) => onBindResult(
                  step.sequence, path, producer, resultPath
                )}
                onRestoreLiteral={(path) => onRestoreLiteral(step.sequence, path)} />
              <h4>Recorded result</h4>
              <pre>{formatted(step.result)}</pre>
            </details>
          </li>;
        })}
      </ol>}
  </section>;
};
