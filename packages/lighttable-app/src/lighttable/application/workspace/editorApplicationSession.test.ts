import { describe, expect, it, vi } from 'vitest';
import { createDocumentEditorState, mergeEditorSession } from '../../editor/session/editorSession';
import { EditorApplicationSession } from './editorApplicationSession';

describe('EditorApplicationSession', () => {
  it('keeps tool and option state independent from document interaction state', () => {
    const application = new EditorApplicationSession();
    const firstDocument = createDocumentEditorState();
    const secondDocument = { ...createDocumentEditorState(), activeChannel: 'mask' as const };

    application.update((current) => ({
      ...current,
      activeTool: 'brush',
      brush: { ...current.brush, size: 125 }
    }));

    expect(mergeEditorSession(application.getSnapshot(), firstDocument)).toMatchObject({
      activeTool: 'brush',
      activeChannel: 'pixels',
      brush: { size: 125 }
    });
    expect(mergeEditorSession(application.getSnapshot(), secondDocument)).toMatchObject({
      activeTool: 'brush',
      activeChannel: 'mask',
      brush: { size: 125 }
    });
  });

  it('publishes application UI changes without accepting document selection', () => {
    const application = new EditorApplicationSession();
    const listener = vi.fn();
    application.subscribe(listener);
    const combined = mergeEditorSession(application.getSnapshot(), {
      ...createDocumentEditorState(),
      activeChannel: 'mask'
    });

    application.publishCombinedSession({
      ...combined,
      activeTool: 'zoom',
      selection: [{
        mode: 'replace',
        shape: { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
      }]
    });

    expect(application.getSnapshot().activeTool).toBe('zoom');
    expect(application.getSnapshot()).not.toHaveProperty('selection');
    expect(application.getSnapshot()).not.toHaveProperty('activeChannel');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not publish application UI when only document interaction changes', () => {
    const application = new EditorApplicationSession();
    const listener = vi.fn();
    application.subscribe(listener);
    const combined = mergeEditorSession(
      application.getSnapshot(),
      createDocumentEditorState()
    );

    application.publishCombinedSession({
      ...combined,
      activeChannel: 'mask',
      selection: [{
        mode: 'replace',
        shape: { kind: 'rectangle', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }
      }]
    });

    expect(listener).not.toHaveBeenCalled();
    expect(application.getSnapshot().activeTool).toBe('view');
  });
});
