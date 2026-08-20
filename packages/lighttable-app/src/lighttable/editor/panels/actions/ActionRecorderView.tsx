import React, { useEffect, useMemo, useState } from 'react';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandDefinition
} from '@lighttable/command-contract';
import { ButtonBase } from '../../../../ui/ButtonBase';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from '../../../application/actions/semanticActionPlayback';
import type { SemanticActionLibrarySnapshot } from '../../../application/actions/semanticActionLibrary';

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
  readonly onStopPlayback: () => void;
  readonly onSave: (name: string) => void;
  readonly onLoad: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

const formatted = (value: unknown): string => JSON.stringify(value, (_key, candidate) => {
  const binding = candidate?.$lighttableResult;
  return binding && Number.isInteger(binding.step) && typeof binding.path === 'string'
    ? `$step${binding.step}.${binding.path}`
    : candidate;
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
  onStopPlayback,
  onSave,
  onLoad,
  onDelete
}) => {
  const [name, setName] = useState(recording.name);
  useEffect(() => setName(recording.name), [recording.id, recording.name]);
  const labels = useMemo(() => new Map<string, string>(
    definitions.map(({ id, label }) => [id, label])
  ), [definitions]);
  const replayableCount = recording.steps.filter(({ replayable }) => replayable).length;
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
      <label>Action name
        <input aria-label="Action name" value={name} maxLength={255}
          onChange={(event) => setName(event.currentTarget.value)} disabled={busy} />
      </label>
      <ButtonBase type="button" onClick={() => onSave(name)} disabled={busy
        || recording.status !== 'stopped' || recording.steps.length === 0
        || recording.steps.some(({ replayable }) => !replayable) || !name.trim()}>Save</ButtonBase>
      <label>Saved
        <select aria-label="Saved Actions" value={library.selectedId ?? ''}
          onChange={(event) => event.currentTarget.value && onLoad(event.currentTarget.value)}>
          <option value="">No saved Actions</option>
          {library.actions.map((action) => <option key={action.id} value={action.id}>
            {action.name} ({action.recording.steps.length})
          </option>)}
        </select>
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
                <span>{step.durationMs} ms recorded</span>
              </div>
              <dl>
                <div><dt>Document</dt><dd><code>{step.documentId ?? 'workspace'}</code></dd></div>
                <div><dt>Origin</dt><dd>{step.origin}</dd></div>
                <div><dt>Replayable</dt><dd>{step.replayable ? 'yes' : 'no'}</dd></div>
              </dl>
              {step.note ? <p>{step.note}</p> : null}
              {playbackResult?.message ? <p className="lighttable-action-recorder__warning">{playbackResult.message}</p> : null}
              <h4>Parameters</h4>
              <pre>{formatted(step.parameters)}</pre>
              <h4>Recorded result</h4>
              <pre>{formatted(step.result)}</pre>
            </details>
          </li>;
        })}
      </ol>}
  </section>;
};
