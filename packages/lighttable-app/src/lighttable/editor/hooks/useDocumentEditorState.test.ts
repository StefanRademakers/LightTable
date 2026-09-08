import { describe, expect, it } from 'vitest';
import { createEditorSession, documentEditorStateFrom, editorApplicationStateFrom } from '../session/editorSession';
import { latestEditorSessionForUpdate } from './useDocumentEditorState';

describe('latestEditorSessionForUpdate', () => {
  it('retains a just-published document selection when application state updates before React renders', () => {
    const rendered = createEditorSession();
    const committedDocument = {
      ...documentEditorStateFrom(rendered),
      selectionRevision: 7,
      selection: [{
        mode: 'replace' as const,
        shape: { kind: 'rectangle' as const, points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] },
      }],
    };
    const application = { ...editorApplicationStateFrom(rendered), pointerId: 42 };

    const latest = latestEditorSessionForUpdate(rendered, committedDocument, application);

    expect(latest.selectionRevision).toBe(7);
    expect(latest.selection).toEqual(committedDocument.selection);
    expect(latest.pointerId).toBe(42);
  });
});
