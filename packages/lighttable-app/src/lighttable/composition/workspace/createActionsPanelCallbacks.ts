import type { LightTableCommandService } from '../../application/commands/lightTableCommandService';

const unavailable = () => ({ ok: false as const, error: 'Actions are unavailable.' });

/**
 * Keeps low-frequency Actions panel projection wiring out of the editor root.
 * Every callback still delegates to the single application command/workflow
 * owner; this helper owns no recording, document or playback state.
 */
export const createActionsPanelCallbacks = (service?: LightTableCommandService) => ({
  onStartRecording: () => { service?.startActionRecording(); },
  onStopRecording: () => { service?.stopActionRecording(); },
  onClearRecording: () => { service?.clearActionRecording(); },
  onPlay: () => { void service?.playActionRecording(); },
  onPlayStep: (sequence: number) => { void service?.playActionStep(sequence); },
  onPlayFromStep: (sequence: number) => { void service?.playActionFromStep(sequence); },
  onStopPlayback: () => { service?.stopActionPlayback(); },
  onCreateActionSet: (name: string) => { void service?.createActionSet(name); },
  onRenameActionSet: (id: string, name: string) => { void service?.renameActionSet(id, name); },
  onSelectActionSet: (id: string) => { void service?.selectActionSet(id); },
  onDeleteActionSet: (id: string) => { void service?.deleteActionSet(id); },
  onSaveAction: (name: string) => { void service?.saveActionRecording(name); },
  onLoadAction: (id: string) => { void service?.loadSavedAction(id); },
  onDeleteAction: (id: string) => { void service?.deleteSavedAction(id); },
  onCreateVariable: (sequence: number, path: string, name: string) => (
    service?.createActionVariable(sequence, path, name) ?? unavailable()
  ),
  onUpdateVariable: (name: string, value: unknown) => (
    service?.updateActionVariable(name, value) ?? unavailable()
  ),
  onDeleteVariable: (name: string) => service?.deleteActionVariable(name) ?? unavailable(),
  onBindVariable: (sequence: number, path: string, name: string) => (
    service?.bindActionParameterToVariable(sequence, path, name) ?? unavailable()
  ),
  onBindResult: (sequence: number, path: string, producer: number, resultPath: string) => (
    service?.bindActionParameterToResult(sequence, path, producer, resultPath) ?? unavailable()
  ),
  onRestoreLiteral: (sequence: number, path: string) => (
    service?.restoreActionParameterLiteral(sequence, path) ?? unavailable()
  )
});
