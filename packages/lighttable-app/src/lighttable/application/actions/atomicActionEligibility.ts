import { ATOMIC_BATCH_COMMANDS } from '../commands/atomicCommandBatchContract';
import { isActionResultReference } from './actionResultBindings';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

export type AtomicActionEligibility = { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

const atomicCommands = new Set<string>(ATOMIC_BATCH_COMMANDS);

const bindingError = (value: unknown, sequence: number,
  availableSteps: ReadonlySet<number>): string | null => {
  if (isActionResultReference(value)) {
    const { step, path } = value.$lighttableResult;
    if (!availableSteps.has(step) || step >= sequence) {
      return `Step ${sequence} has an unavailable or forward result binding to step ${step}.`;
    }
    return /^[A-Za-z][A-Za-z0-9_-]*$/u.test(path) ? null
      : `Step ${sequence} result binding ${path} is nested and cannot run atomically.`;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const error = bindingError(entry, sequence, availableSteps);
      if (error) return error;
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      const error = bindingError(entry, sequence, availableSteps);
      if (error) return error;
    }
  }
  return null;
};

export const atomicActionEligibility = (recording: ActionRecordingSnapshot): AtomicActionEligibility => {
  if (recording.status !== 'stopped') {
    return { eligible: false, reason: 'Stop the Action before atomic playback.' };
  }
  if (recording.steps.length < 1) return { eligible: false, reason: 'The Action has no steps to play.' };
  if (recording.steps.length > 64) {
    return { eligible: false, reason: 'Atomic playback supports at most 64 steps.' };
  }
  const nonReplayable = recording.steps.find(({ replayable, outcome }) => !replayable || outcome !== 'completed');
  if (nonReplayable) return { eligible: false,
    reason: `Step ${nonReplayable.sequence} is diagnostic or asynchronous; use normal stepwise Play.` };
  const unsupported = recording.steps.find(({ command }) => !atomicCommands.has(command));
  if (unsupported) return { eligible: false,
    reason: `${unsupported.command} cannot publish through one atomic document transaction.` };
  const documentIds = new Set(recording.steps.map(({ documentId }) => documentId));
  if (documentIds.size !== 1 || documentIds.has(null)) return { eligible: false,
    reason: 'Atomic playback requires every step to target one recorded document.' };
  const name = recording.name.trim();
  if (!name || name.length > 128) return { eligible: false,
    reason: 'Atomic playback requires an Action name between 1 and 128 characters.' };
  const sequences = new Set(recording.steps.map(({ sequence }) => sequence));
  for (const step of recording.steps) {
    const error = bindingError(step.parameters, step.sequence, sequences);
    if (error) return { eligible: false, reason: error };
  }
  return { eligible: true };
};
