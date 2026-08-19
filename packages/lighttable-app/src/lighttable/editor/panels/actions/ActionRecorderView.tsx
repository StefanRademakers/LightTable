import React from 'react';
import { ButtonBase } from '../../../../ui/ButtonBase';
import type { ActionRecordingSnapshot } from '../../../application/actions/semanticActionRecorder';

export interface ActionRecorderViewProps {
  readonly recording: ActionRecordingSnapshot;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onClear: () => void;
}

const formatted = (value: unknown): string => JSON.stringify(value, null, 2);

export const ActionRecorderView: React.FC<ActionRecorderViewProps> = ({
  recording,
  onStart,
  onStop,
  onClear
}) => <section className="lighttable-action-recorder" aria-labelledby="action-recorder-title">
  <header>
    <div>
      <strong id="action-recorder-title">Recorder</strong>
      <span className={`lighttable-action-recorder__status is-${recording.status}`}>
        {recording.status}
      </span>
    </div>
    <div className="lighttable-action-recorder__controls">
      {recording.status === 'recording'
        ? <ButtonBase type="button" onClick={onStop}>Stop</ButtonBase>
        : <ButtonBase type="button" onClick={onStart}>Record</ButtonBase>}
      <ButtonBase type="button" onClick={onClear} disabled={recording.steps.length === 0}>Clear</ButtonBase>
    </div>
  </header>
  {recording.limitReached
    ? <p className="lighttable-action-recorder__warning" role="alert">Recorder limit reached; recording has paused.</p>
    : null}
  {recording.steps.length === 0
    ? <p className="lighttable-action-recorder__empty">Record a UI or command execution to inspect it here.</p>
    : <ol className="lighttable-action-recorder__steps">
      {recording.steps.map((step) => <li key={`${step.sequence}-${step.requestId}`}>
        <details>
          <summary>
            <span><b>{step.sequence}</b> <code>{step.command}</code></span>
            <span className={`is-${step.outcome}`}>{step.outcome} · {step.durationMs} ms</span>
          </summary>
          <dl>
            <div><dt>Document</dt><dd><code>{step.documentId ?? 'workspace'}</code></dd></div>
            <div><dt>Replayable</dt><dd>{step.replayable ? 'yes' : 'no'}</dd></div>
          </dl>
          {step.note ? <p>{step.note}</p> : null}
          <h4>Parameters</h4>
          <pre>{formatted(step.parameters)}</pre>
          <h4>Result</h4>
          <pre>{formatted(step.result)}</pre>
        </details>
      </li>)}
    </ol>}
</section>;
