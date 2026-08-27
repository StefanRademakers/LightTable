import type { LightTableCommandService } from '../../application/commands/lightTableCommandService';
import { atomicActionEligibility } from '../../application/actions/atomicActionEligibility';

const unavailable = () => ({ ok: false as const, error: 'Actions are unavailable.' });

/**
 * Keeps low-frequency Actions panel projection wiring out of the editor root.
 * Every callback still delegates to the single application command/workflow
 * owner; this helper owns no recording, document or playback state.
 */
export const createActionsPanelCallbacks = (service?: LightTableCommandService) => {
  const edit = (operation: (service: LightTableCommandService) => ReturnType<LightTableCommandService['deleteActionStep']>) => {
    if (!service) return unavailable();
    const result = operation(service);
    if (result.ok) void service.saveActionRecording(service.actionRecordingSnapshot().name);
    return result;
  };
  return ({
  onStartRecording: (name?: string, insertAfterSequence?: number) => {
    service?.startActionRecording(name, insertAfterSequence);
  },
  onStopRecording: () => {
    const stopped = service?.stopActionRecording();
    if (stopped?.id) void service?.saveActionRecording(stopped.name);
  },
  onClearRecording: () => { service?.clearActionRecording(); },
  onPlay: () => {
    if (!service) return;
    const recording = service.actionRecordingSnapshot();
    void (atomicActionEligibility(recording).eligible
      ? service.playActionRecordingAtomically() : service.playActionRecording());
  },
  onPlayStep: (sequence: number) => { void service?.playActionStep(sequence); },
  onPlayFromStep: (sequence: number) => { void service?.playActionFromStep(sequence); },
  onStopPlayback: () => { service?.stopActionPlayback(); },
  onCreateActionSet: (name: string) => { void service?.createActionSet(name); },
  onCreateAction: async (setId: string, name: string) => (
    (await service?.createSavedAction(setId, name))?.id ?? null
  ),
  onRenameActionSet: (id: string, name: string) => { void service?.renameActionSet(id, name); },
  onSelectActionSet: (id: string) => { void service?.selectActionSet(id); },
  onDeleteActionSet: (id: string) => { void service?.deleteActionSet(id); },
  onMoveActionSet: (id: string, direction: -1 | 1) => { void service?.moveActionSet(id, direction); },
  onLoadAction: (id: string) => { void service?.loadSavedAction(id); },
  onDeleteAction: (id: string) => { void service?.deleteSavedAction(id); },
  onRenameAction: (id: string, name: string) => { void service?.renameSavedAction(id, name); },
  onDuplicateAction: (id: string) => { void service?.duplicateSavedAction(id); },
  onMoveAction: (id: string, direction: -1 | 1) => { void service?.moveSavedAction(id, direction); },
  onSetActionEnabled: (id: string, enabled: boolean) => { void service?.setSavedActionEnabled(id, enabled); },
  onSetActionSetEnabled: (id: string, enabled: boolean) => { void service?.setActionSetEnabled(id, enabled); },
  onCreateVariable: (sequence: number, path: string, name: string) => (
    edit((owner) => owner.createActionVariable(sequence, path, name))
  ),
  onUpdateVariable: (name: string, value: unknown) => (
    edit((owner) => owner.updateActionVariable(name, value))
  ),
  onDeleteVariable: (name: string) => edit((owner) => owner.deleteActionVariable(name)),
  onBindVariable: (sequence: number, path: string, name: string) => (
    edit((owner) => owner.bindActionParameterToVariable(sequence, path, name))
  ),
  onBindResult: (sequence: number, path: string, producer: number, resultPath: string) => (
    edit((owner) => owner.bindActionParameterToResult(sequence, path, producer, resultPath))
  ),
  onRestoreLiteral: (sequence: number, path: string) => (
    edit((owner) => owner.restoreActionParameterLiteral(sequence, path))
  ),
  onReplaceStepParameters: (sequence: number, parameters: Readonly<Record<string, unknown>>) => (
    edit((owner) => owner.replaceActionStepParameters(sequence, parameters))
  ),
  onUpdateStepRationale: (sequence: number, rationale: string) => (
    edit((owner) => owner.updateActionStepRationale(sequence, rationale))
  ),
  onSetStepEnabled: (sequence: number, enabled: boolean) => edit(
    (owner) => owner.setActionStepEnabled(sequence, enabled)
  ),
  onSetStepInteractive: (sequence: number, interactive: boolean) => edit(
    (owner) => owner.setActionStepInteractive(sequence, interactive)
  ),
  onDeleteStep: (sequence: number) => edit((owner) => owner.deleteActionStep(sequence)),
  onDuplicateStep: (sequence: number) => edit((owner) => owner.duplicateActionStep(sequence)),
  onMoveStep: (sequence: number, direction: -1 | 1) => edit(
    (owner) => owner.moveActionStep(sequence, direction)
  ),
  onContinueInteractivePlayback: (parameters: Readonly<Record<string, unknown>>) => {
    service?.continueInteractiveActionPlayback(parameters);
  },
  onCancelInteractivePlayback: () => { service?.cancelInteractiveActionPlayback(); }
  });
};
