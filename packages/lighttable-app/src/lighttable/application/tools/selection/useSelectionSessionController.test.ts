import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type ImageDocument
} from '../../../editor/document/documentTypes';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { SelectionShape } from '../../../editor/selection/selectionTypes';
import {
  createSelectionSessionController,
  type SelectionHistoryEntry,
  type SelectionSessionDependencies
} from './useSelectionSessionController';

const document = createImageDocument('Selection', 100, 80, 'selection');

const setup = () => {
  let activeDocument: ImageDocument | null = document;
  let selection: SelectionOperation[] = [];
  let pointerId: number | null = null;
  let draft: SelectionShape | null = null;
  const history: SelectionHistoryEntry[] = [];
  const renderer = {
    replaceSelection: vi.fn(async () => true),
    setSelection: vi.fn(async () => true),
    clearSelection: vi.fn()
  };
  const dependencies: SelectionSessionDependencies = {
    getDocument: () => activeDocument,
    getRenderer: () => renderer,
    getSelection: () => selection,
    publishSelection: (next, nextPointerId) => {
      selection = next;
      pointerId = nextPointerId;
    },
    publishDraft: (next) => {
      draft = next;
    },
    pushHistoryEntry: (entry) => history.push(entry),
    setError: vi.fn()
  };
  const controller = createSelectionSessionController(() => dependencies);
  return {
    controller,
    renderer,
    history,
    get selection() { return selection; },
    get pointerId() { return pointerId; },
    get draft() { return draft; },
    switchDocument: (next: ImageDocument | null) => {
      activeDocument = next;
    }
  };
};

describe('selection session controller', () => {
  it('publishes one pointer gesture and one selection-only history entry', async () => {
    const state = setup();
    expect(state.controller.begin(7, 'select-rectangle', { x: 10, y: 10 })).toBe(true);
    expect(state.pointerId).toBe(7);
    expect(state.controller.move(7, { x: 40, y: 50 })).toBe(true);
    expect(state.controller.finish(7, { shiftKey: false, altKey: false })).toBe(true);
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledOnce();
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].documentMutation).toBe(false);
    expect(state.pointerId).toBeNull();
    expect(state.draft).toBeNull();
  });

  it('does not publish an async result after switching documents', async () => {
    let resolveSelection!: (applied: boolean) => void;
    const state = setup();
    state.renderer.setSelection.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveSelection = resolve; })
    );
    state.controller.begin(3, 'select-rectangle', { x: 1, y: 1 });
    state.controller.move(3, { x: 20, y: 20 });
    state.controller.finish(3, { shiftKey: false, altKey: false });
    state.switchDocument(createImageDocument('Other', 100, 80, 'other'));
    resolveSelection(true);
    await Promise.resolve();
    expect(state.selection).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });

  it('restores command-driven selection through history', async () => {
    const state = setup();
    state.controller.selectAll();
    await Promise.resolve();
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    await state.history[0].undo();
    expect(state.selection).toHaveLength(0);
    await state.history[0].redo();
    expect(state.selection).toHaveLength(1);
  });
});
