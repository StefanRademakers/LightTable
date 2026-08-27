import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  LIGHTTABLE_COMMAND_SCHEMAS,
  type LightTableCommandDefinition,
  type LightTableCommandId
} from '@lighttable/command-contract';
import { lightTableIcon } from '../../../../assets/icons';
import { ButtonBase } from '../../../../ui/ButtonBase';
import { ContextMenu, type ContextMenuOption } from '../../../../ui/ContextMenu';
import { SquareIconButton } from '../../../../ui/SquareIconButton';
import { TextInputDialog } from '../../../../ui/TextInputDialog';
import {
  PanelStackDisclosure,
  PanelStackFooter,
  PanelStackRow
} from '../../ui/PanelStackPrimitives';
import type {
  ActionRecordingEditResult,
  ActionRecordingSnapshot
} from '../../../application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from '../../../application/actions/semanticActionPlayback';
import type { SemanticActionLibrarySnapshot } from '../../../application/actions/semanticActionLibrary';
import { ActionBindingEditor, ActionVariableRow } from './ActionBindingEditor';
import { ActionStepParameterEditor } from './ActionStepParameterEditor';
import { ActionStepRationaleEditor } from './ActionStepRationaleEditor';
import { CommandParameterEditor } from './CommandParameterEditor';

export interface ActionRecorderViewProps {
  readonly recording: ActionRecordingSnapshot;
  readonly playback: ActionPlaybackSnapshot;
  readonly library: SemanticActionLibrarySnapshot;
  readonly definitions?: readonly LightTableCommandDefinition[];
  readonly onStart: (name?: string, insertAfterSequence?: number) => void;
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
  readonly onMoveSet: (id: string, direction: -1 | 1) => void;
  readonly onLoad: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onSetActionEnabled: (id: string, enabled: boolean) => void;
  readonly onSetActionSetEnabled: (id: string, enabled: boolean) => void;
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
  readonly onSetStepEnabled: (sequence: number, enabled: boolean) => ActionRecordingEditResult;
  readonly onSetStepInteractive: (sequence: number, interactive: boolean) => ActionRecordingEditResult;
  readonly onDeleteStep: (sequence: number) => ActionRecordingEditResult;
  readonly onDuplicateStep: (sequence: number) => ActionRecordingEditResult;
  readonly onMoveStep: (sequence: number, direction: -1 | 1) => ActionRecordingEditResult;
  readonly onContinueInteractivePlayback: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly onCancelInteractivePlayback: () => void;
}

type Selection = { readonly kind: 'set' | 'action' | 'step'; readonly id: string; readonly sequence?: number };
type NameDialog = { readonly kind: 'new-set' | 'new-action' | 'rename-set' | 'rename-action';
  readonly id?: string; readonly title: string; readonly value: string };

const activateTreeRow = (event: React.KeyboardEvent<HTMLElement>): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget.click();
};

const PromptDialog: React.FC<{
  readonly playback: ActionPlaybackSnapshot;
  readonly onContinue: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly onCancel: () => void;
}> = ({ playback, onContinue, onCancel }) => {
  const prompt = playback.prompt;
  const schema = prompt ? LIGHTTABLE_COMMAND_SCHEMAS[prompt.command as LightTableCommandId]?.input : undefined;
  if (!prompt) return null;
  return createPortal(<div className="modal-backdrop lighttable-dialog-backdrop lighttable-action-prompt" role="presentation">
    <section className="lighttable-action-prompt__dialog" role="dialog" aria-modal="true"
      aria-label={`Action step ${prompt.sequence}`}>
      <header><strong>{prompt.command}</strong><span>Step {prompt.sequence}</span></header>
      {schema ? <CommandParameterEditor schema={schema} initialParameters={prompt.parameters}
        disabled={false} running={false} runLabel="Continue"
        onRun={onContinue} /> : <p>This command has no editable parameters.</p>}
      <ButtonBase type="button" onClick={onCancel}>Cancel</ButtonBase>
    </section>
  </div>, document.body);
};

export const ActionRecorderView: React.FC<ActionRecorderViewProps> = (props) => {
  const { recording, playback, library, definitions = LIGHTTABLE_COMMAND_DEFINITIONS } = props;
  const labels = useMemo(() => new Map<string, string>(
    definitions.map(({ id, label }) => [id, label])
  ), [definitions]);
  const [expandedSets, setExpandedSets] = useState<ReadonlySet<string>>(
    () => new Set(library.sets.map(({ id }) => id))
  );
  const [expandedActions, setExpandedActions] = useState<ReadonlySet<string>>(
    () => new Set(recording.id ? [recording.id] : [])
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number;
    readonly selection: Selection } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const busy = playback.status === 'running';
  const warning = editError ?? library.error
    ?? (recording.limitReached ? 'Recording limit reached. Stop and save this Action before continuing.' : null)
    ?? playback.results.at(-1)?.message;
  const selectedStep = selection?.kind === 'step'
    ? recording.steps.find((step) => step.sequence === selection.sequence) ?? null : null;

  useEffect(() => {
    if (library.selectedId && recording.id === library.selectedId) {
      setExpandedActions((current) => new Set([...current, library.selectedId!]));
    }
  }, [library.selectedId, recording.id]);
  useEffect(() => {
    if (recording.id && !library.actions.some((action) => action.id === recording.id)) {
      setExpandedActions((current) => new Set([...current, recording.id!]));
      setSelection({ kind: 'action', id: recording.id });
    }
  }, [library.actions, recording.id]);

  const edit = (result: ActionRecordingEditResult): void => setEditError(result.ok ? null : result.error);
  const toggle = (values: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(values);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  const chooseAction = (id: string): void => {
    setSelection({ kind: 'action', id });
    if (recording.id !== id) props.onLoad(id);
  };
  const actionRecording = (id: string, fallback: ActionRecordingSnapshot): ActionRecordingSnapshot => (
    recording.id === id ? recording : fallback
  );
  const openMenu = (event: React.MouseEvent, next: Selection): void => {
    event.preventDefault();
    if (next.kind !== 'set' && recording.id !== next.id) props.onLoad(next.id);
    setSelection(next);
    setMenu({ x: event.clientX, y: event.clientY, selection: next });
  };
  const beginRename = (next: Selection): void => {
    if (next.kind === 'set') {
      const set = library.sets.find(({ id }) => id === next.id);
      if (set) setDialog({ kind: 'rename-set', id: set.id, title: 'Rename Action Set', value: set.name });
    } else if (next.kind === 'action') {
      const action = library.actions.find(({ id }) => id === next.id);
      if (action) setDialog({ kind: 'rename-action', id: action.id, title: 'Rename Action', value: action.name });
    }
    setMenu(null);
  };
  const submitDialog = (value: string): void => {
    if (!dialog || !value.trim()) return;
    if (dialog.kind === 'new-set') props.onCreateSet(value);
    if (dialog.kind === 'new-action') { props.onClear(); props.onStart(value); }
    if (dialog.kind === 'rename-set' && dialog.id) props.onRenameSet(dialog.id, value);
    if (dialog.kind === 'rename-action' && dialog.id) props.onRename(dialog.id, value);
    setDialog(null);
  };
  const contextMenuOptions: ContextMenuOption<string>[] = menu ? [
    ...(menu.selection.kind !== 'step' ? [{ value: 'rename', label: 'Rename',
      onClick: () => beginRename(menu.selection) }] : []),
    ...(menu.selection.kind === 'action' ? [{ value: 'duplicate-action', label: 'Duplicate',
      onClick: () => props.onDuplicate(menu.selection.id) }] : []),
    ...(menu.selection.kind === 'step' && menu.selection.sequence ? [
      { value: 'play-step', label: 'Play Step',
        onClick: () => props.onPlayStep(menu.selection.sequence!) },
      { value: 'play-from', label: 'Play From Here',
        onClick: () => props.onPlayFromStep(menu.selection.sequence!) },
      { value: 'duplicate-step', label: 'Duplicate',
        onClick: () => edit(props.onDuplicateStep(menu.selection.sequence!)) }
    ] : []),
    { value: 'move-up', label: 'Move Up', separatorBefore: true, onClick: () => {
      if (menu.selection.kind === 'set') props.onMoveSet(menu.selection.id, -1);
      if (menu.selection.kind === 'action') props.onMove(menu.selection.id, -1);
      if (menu.selection.kind === 'step' && menu.selection.sequence) {
        edit(props.onMoveStep(menu.selection.sequence, -1));
      }
    } },
    { value: 'move-down', label: 'Move Down', onClick: () => {
      if (menu.selection.kind === 'set') props.onMoveSet(menu.selection.id, 1);
      if (menu.selection.kind === 'action') props.onMove(menu.selection.id, 1);
      if (menu.selection.kind === 'step' && menu.selection.sequence) {
        edit(props.onMoveStep(menu.selection.sequence, 1));
      }
    } },
    { value: 'delete', label: 'Delete', separatorBefore: true, onClick: () => {
      if (menu.selection.kind === 'set') props.onDeleteSet(menu.selection.id);
      if (menu.selection.kind === 'action') props.onDelete(menu.selection.id);
      if (menu.selection.kind === 'step' && menu.selection.sequence) {
        edit(props.onDeleteStep(menu.selection.sequence));
      }
    } }
  ] : [];

  return <section className="lighttable-action-recorder" aria-label="Actions"
    onClick={() => setMenu(null)}>
    <div className="lighttable-action-tree" role="tree" aria-label="Action Sets"
      data-editor-native-tab-navigation="tab-only">
      {library.sets.map((set) => {
        const setOpen = expandedSets.has(set.id);
        const savedActions = library.actions.filter((action) => action.setId === set.id);
        const actions = recording.id && set.id === library.selectedSetId
          && !library.actions.some((action) => action.id === recording.id)
          ? [...savedActions, { id: recording.id, setId: set.id, name: recording.name,
              createdAt: recording.startedAt ?? 0, updatedAt: recording.stoppedAt ?? Date.now(), recording }]
          : savedActions;
        return <div className="lighttable-action-tree__set" key={set.id}>
          <PanelStackRow role="treeitem" aria-level={1} aria-expanded={setOpen} tabIndex={0}
            selected={selection?.kind === 'set' && selection.id === set.id}
            active={selection?.kind === 'set' && selection.id === set.id}
            className="lighttable-action-tree__row is-set"
            onClick={(event) => {
              event.stopPropagation();
              setSelection({ kind: 'set', id: set.id });
              props.onSelectSet(set.id);
            }}
            onDoubleClick={() => beginRename({ kind: 'set', id: set.id })}
            onKeyDown={activateTreeRow}
            onContextMenu={(event) => openMenu(event, { kind: 'set', id: set.id })}>
            <ButtonBase type="button" className="lighttable-layer__visibility"
              aria-label={`${actions.length > 0 && actions.every((action) => action.recording.steps
                .every((step) => step.enabled !== false)) ? 'Disable' : 'Enable'} ${set.name}`}
              disabled={busy || actions.length === 0
                || actions.some((action) => !library.actions.some((saved) => saved.id === action.id))}
              onClick={(event) => {
                event.stopPropagation();
                props.onSetActionSetEnabled(set.id, !actions.every((action) => action.recording.steps
                  .every((step) => step.enabled !== false)));
              }}><img src={lightTableIcon(actions.length > 0 && actions.every((action) => action.recording.steps
                .every((step) => step.enabled !== false)) ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
            <PanelStackDisclosure expanded={setOpen}
              label={setOpen ? `Collapse ${set.name}` : `Expand ${set.name}`}
              onClick={(event) => {
                event.stopPropagation();
                setExpandedSets((value) => toggle(value, set.id));
              }} />
            <span className="lighttable-layer__thumbnail-slot"><span
              className="lighttable-layer__thumbnail lighttable-action-tree__thumbnail"><img
                className="lighttable-layer__type-icon" src={lightTableIcon('layer_group.png')}
                alt="" aria-hidden="true" /></span></span><strong>{set.name}</strong>
          </PanelStackRow>
          {setOpen ? <div role="group">
            {actions.map((action) => {
              const actionOpen = expandedActions.has(action.id);
              const shown = actionRecording(action.id, action.recording);
              return <div key={action.id}>
                <PanelStackRow role="treeitem" aria-level={2} aria-expanded={actionOpen} tabIndex={0}
                  selected={selection?.kind === 'action' && selection.id === action.id}
                  active={selection?.kind === 'action' && selection.id === action.id}
                  className="lighttable-action-tree__row is-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    chooseAction(action.id);
                  }}
                  onDoubleClick={() => beginRename({ kind: 'action', id: action.id })}
                  onKeyDown={activateTreeRow}
                  onContextMenu={(event) => openMenu(event, { kind: 'action', id: action.id })}>
                  <ButtonBase type="button" className="lighttable-layer__visibility"
                    aria-label={`${shown.steps.length > 0
                      && shown.steps.every((step) => step.enabled !== false) ? 'Disable' : 'Enable'} ${action.name}`}
                    disabled={busy || shown.steps.length === 0
                      || !library.actions.some((saved) => saved.id === action.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSetActionEnabled(action.id,
                        !shown.steps.every((step) => step.enabled !== false));
                    }}><img src={lightTableIcon(shown.steps.length > 0
                      && shown.steps.every((step) => step.enabled !== false)
                      ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
                  <PanelStackDisclosure expanded={actionOpen}
                    label={actionOpen ? `Collapse ${action.name}` : `Expand ${action.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      chooseAction(action.id);
                      setExpandedActions((value) => toggle(value, action.id));
                    }} />
                  <span className="lighttable-layer__thumbnail-slot"><span
                    className="lighttable-layer__thumbnail lighttable-action-tree__thumbnail"><img
                      className="lighttable-layer__type-icon" src={lightTableIcon('play.png')}
                      alt="" aria-hidden="true" /></span></span><span>{action.name}</span>
                </PanelStackRow>
                {actionOpen ? <div role="group">
                  {shown.steps.map((step) => {
                    const selected = selection?.kind === 'step' && selection.id === action.id
                      && selection.sequence === step.sequence;
                    return <PanelStackRow className={`lighttable-action-tree__row is-step${playback.currentSequence === step.sequence
                        && recording.id === action.id ? ' is-current' : ''}`}
                      selected={selected}
                      active={selected}
                      role="treeitem" key={`${step.sequence}-${step.requestId}`}
                      data-command={step.command}
                      aria-level={3} tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        chooseAction(action.id);
                        setSelection({ kind: 'step', id: action.id, sequence: step.sequence });
                      }}
                      onDoubleClick={() => props.onPlayStep(step.sequence)}
                      onKeyDown={activateTreeRow}
                      onContextMenu={(event) => openMenu(event,
                        { kind: 'step', id: action.id, sequence: step.sequence })}>
                      <ButtonBase type="button" className="lighttable-layer__visibility"
                        aria-label={`${step.enabled !== false ? 'Disable' : 'Enable'} ${labels.get(step.command) ?? step.command}`}
                        disabled={busy || shown.status === 'recording' || recording.id !== action.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          edit(props.onSetStepEnabled(step.sequence, step.enabled === false));
                        }}><img src={lightTableIcon(step.enabled !== false ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
                      <SquareIconButton type="button" size="compact" appearance="quiet" icon="▣"
                        className={`lighttable-action-tree__modal${step.interactive ? ' is-on' : ''}`}
                        aria-label={`Toggle dialog for ${labels.get(step.command) ?? step.command}`}
                        aria-pressed={step.interactive === true} disabled={busy || shown.status === 'recording'
                          || recording.id !== action.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          edit(props.onSetStepInteractive(step.sequence, !step.interactive));
                        }} />
                      <span>{labels.get(step.command) ?? step.command}</span>
                    </PanelStackRow>;
                  })}
                </div> : null}
              </div>;
            })}
          </div> : null}
        </div>;
      })}
    </div>

    {selectedStep ? <details className="lighttable-action-inspector">
      <summary>{labels.get(selectedStep.command) ?? selectedStep.command} options</summary>
      <div className="lighttable-action-recorder__step-controls">
        <ButtonBase type="button" onClick={() => props.onPlayStep(selectedStep.sequence)}
          disabled={busy}>Play step</ButtonBase>
        <ButtonBase type="button" onClick={() => props.onPlayFromStep(selectedStep.sequence)}
          disabled={busy}>Play from here</ButtonBase>
      </div>
      <ActionStepRationaleEditor rationale={selectedStep.rationale}
        disabled={busy || recording.status !== 'stopped'}
        onApply={(value) => props.onUpdateStepRationale(selectedStep.sequence, value)} />
      <ActionStepParameterEditor step={selectedStep}
        priorSteps={recording.steps.filter((step) => step.sequence < selectedStep.sequence)}
        variables={recording.variables} disabled={busy || recording.status !== 'stopped'}
        onApply={(value) => props.onReplaceStepParameters(selectedStep.sequence, value)} />
      <ActionBindingEditor step={selectedStep}
        priorSteps={recording.steps.filter((step) => step.sequence < selectedStep.sequence)}
        variables={recording.variables} disabled={busy || recording.status !== 'stopped'}
        onCreateVariable={(path, name) => props.onCreateVariable(selectedStep.sequence, path, name)}
        onBindVariable={(path, name) => props.onBindVariable(selectedStep.sequence, path, name)}
        onBindResult={(path, producer, resultPath) => props.onBindResult(
          selectedStep.sequence, path, producer, resultPath
        )}
        onRestoreLiteral={(path) => props.onRestoreLiteral(selectedStep.sequence, path)} />
    </details> : null}

    {recording.variables.length ? <details className="lighttable-action-recorder__variables">
      <summary>Variables</summary>
      {recording.variables.map((variable) => <ActionVariableRow key={variable.name}
        variable={variable} disabled={busy || recording.status !== 'stopped'}
        onUpdate={(value) => props.onUpdateVariable(variable.name, value)}
        onDelete={() => props.onDeleteVariable(variable.name)} />)}
    </details> : null}

    {warning
      ? <p className="lighttable-action-recorder__warning" role="alert">
          {warning}
        </p> : null}
    {playback.status !== 'idle' ? <p role="status"
      className={`lighttable-action-recorder__playback is-${playback.status}`}>
      Playback: {playback.status}{playback.currentSequence ? ` · step ${playback.currentSequence}` : ''}
      {playback.taskProgress === null ? '' : ` · ${Math.round(playback.taskProgress * 100)}%`}
    </p> : null}

    <PanelStackFooter className="lighttable-action-recorder__footer" ariaLabel="Action controls">
      <ButtonBase type="button" aria-label="Stop"
        onClick={busy ? props.onStopPlayback : props.onStop}
        disabled={!busy && recording.status !== 'recording'}><span className="lighttable-action-recorder__stop" /></ButtonBase>
      <ButtonBase type="button" aria-label="Record" className="lighttable-action-recorder__record"
        onClick={() => props.onStart(undefined, selectedStep?.sequence)}
        disabled={busy || recording.status === 'recording'}><span>●</span></ButtonBase>
      <ButtonBase type="button" aria-label="Play" onClick={props.onPlay}
        disabled={busy || recording.status === 'recording'
          || !recording.steps.some((step) => step.replayable && step.enabled !== false)}><img
          src={lightTableIcon('play.png')} alt="" aria-hidden="true" /></ButtonBase>
      <span className="lighttable-action-recorder__footer-spacer" />
      <ButtonBase type="button" aria-label="New Action Set"
        onClick={() => setDialog({ kind: 'new-set', title: 'New Action Set', value: 'New Set' })}><img
          src={lightTableIcon('add_group.png')} alt="" aria-hidden="true" /></ButtonBase>
      <ButtonBase type="button" aria-label="New Action"
        onClick={() => setDialog({ kind: 'new-action', title: 'New Action', value: 'New Action' })}><img
          src={lightTableIcon('add_layer.png')} alt="" aria-hidden="true" /></ButtonBase>
      <ButtonBase type="button" aria-label="Delete selected" disabled={!selection}
        onClick={() => {
          if (selection?.kind === 'set') props.onDeleteSet(selection.id);
          if (selection?.kind === 'action') props.onDelete(selection.id);
          if (selection?.kind === 'step' && selection.sequence) edit(props.onDeleteStep(selection.sequence));
        }}><img src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" /></ButtonBase>
    </PanelStackFooter>

    <ContextMenu open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0}
      onClose={() => setMenu(null)} options={contextMenuOptions} width={180} />

    <TextInputDialog open={dialog !== null} title={dialog?.title ?? ''}
      initialValue={dialog?.value ?? ''} selectAllOnOpen compact
      backdropClassName="lighttable-dialog-backdrop"
      onCancel={() => setDialog(null)} onConfirm={submitDialog} />
    <PromptDialog playback={playback} onContinue={props.onContinueInteractivePlayback}
      onCancel={props.onCancelInteractivePlayback} />
  </section>;
};
