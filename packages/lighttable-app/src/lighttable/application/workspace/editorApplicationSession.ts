import {
  createEditorApplicationState,
  editorApplicationStateFrom,
  type EditorApplicationState,
  type EditorSession
} from '../../editor/session/editorSession';

export type EditorApplicationListener = () => void;

const clone = (state: EditorApplicationState): EditorApplicationState =>
  structuredClone(state);

/**
 * Framework-neutral owner of editor UI/tool state.
 *
 * This session exists once per application workspace. Document activation does
 * not replace it, so tools and their options remain spatially and behaviorally
 * stable while the active data/view binding changes.
 */
export class EditorApplicationSession {
  private snapshot = clone(createEditorApplicationState());
  private readonly listeners = new Set<EditorApplicationListener>();

  getSnapshot = (): EditorApplicationState => this.snapshot;

  subscribe = (listener: EditorApplicationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(updater: (current: EditorApplicationState) => EditorApplicationState): void {
    const next = clone(updater(clone(this.snapshot)));
    if (Object.is(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  publishCombinedSession(session: EditorSession): void {
    const next = editorApplicationStateFrom(session);
    const keys = Object.keys(next) as Array<keyof EditorApplicationState>;
    if (keys.every((key) => Object.is(next[key], this.snapshot[key]))) return;
    this.update(() => next);
  }
}
