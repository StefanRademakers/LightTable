import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION } from '@lighttable/command-contract';
import type {
  LightTableCommandRequest,
  LightTableCommandResult
} from '../commands/lightTableCommandContract';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';

export interface ActionPlaybackStepResult {
  readonly sequence: number;
  readonly command: string;
  readonly status: LightTableCommandResult['status'];
  readonly message: string | null;
  readonly durationMs: number;
}

export interface ActionPlaybackSnapshot {
  readonly status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
  readonly currentSequence: number | null;
  readonly results: readonly ActionPlaybackStepResult[];
}

type ExecuteCommand = (request: LightTableCommandRequest) => Promise<LightTableCommandResult>;
const initialSnapshot = (): ActionPlaybackSnapshot => ({
  status: 'idle', currentSequence: null, results: []
});

export class SemanticActionPlaybackController {
  private snapshotValue = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private stopRequested = false;

  constructor(private readonly execute: ExecuteCommand) {}

  snapshot = (): ActionPlaybackSnapshot => this.snapshotValue;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async play(recording: ActionRecordingSnapshot): Promise<ActionPlaybackSnapshot> {
    return this.run(recording, recording.steps.filter(({ replayable }) => replayable));
  }

  async playStep(recording: ActionRecordingSnapshot, sequence: number): Promise<ActionPlaybackSnapshot> {
    const step = recording.steps.find((candidate) => candidate.sequence === sequence && candidate.replayable);
    return this.run(recording, step ? [step] : []);
  }

  stop(): void {
    if (this.snapshotValue.status === 'running') this.stopRequested = true;
  }

  clear(): void {
    if (this.snapshotValue.status !== 'running') this.publish(initialSnapshot());
  }

  private async run(recording: ActionRecordingSnapshot,
    steps: readonly RecordedActionStep[]): Promise<ActionPlaybackSnapshot> {
    if (this.snapshotValue.status === 'running') return this.snapshotValue;
    this.stopRequested = false;
    this.publish({ status: 'running', currentSequence: null, results: [] });
    for (const step of steps) {
      if (this.stopRequested) {
        this.publish({ ...this.snapshotValue, status: 'stopped', currentSequence: null });
        return this.snapshotValue;
      }
      this.publish({ ...this.snapshotValue, currentSequence: step.sequence });
      const startedAt = Date.now();
      const result = await this.execute({
        protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
        requestId: `action-play-${recording.id ?? 'unsaved'}-${step.sequence}-${startedAt}`,
        command: step.command,
        ...(step.documentId ? { documentId: step.documentId } : {}),
        parameters: step.parameters
      });
      const entry: ActionPlaybackStepResult = {
        sequence: step.sequence,
        command: step.command,
        status: result.status,
        message: result.status === 'rejected' ? result.message : null,
        durationMs: Math.max(0, Date.now() - startedAt)
      };
      const results = [...this.snapshotValue.results, entry];
      if (result.status === 'rejected') {
        this.publish({ status: 'failed', currentSequence: step.sequence, results });
        return this.snapshotValue;
      }
      this.publish({ ...this.snapshotValue, results });
    }
    this.publish({ ...this.snapshotValue, status: 'completed', currentSequence: null });
    return this.snapshotValue;
  }

  private publish(snapshot: ActionPlaybackSnapshot): void {
    this.snapshotValue = snapshot;
    for (const listener of this.listeners) listener();
  }
}
