import { describe, expect, it } from 'vitest';
import { createEditorSession } from '../../editor/session/editorSession';
import { DocumentInteractionResetPolicy } from './DocumentInteractionResetPolicy';

const setup = () => {
  const calls: string[] = [];
  const note = (call: string) => () => { calls.push(call); };
  const policy = new DocumentInteractionResetPolicy({
    finishTextEditing: note('text'), resetPaint: note('paint'), resetTransform: note('transform'),
    selection: {
      resetGesture: note('selection-gesture'), clearDraft: note('draft'),
      clearClipboardFeedback: note('clipboard'), closeDialogs: note('dialogs'),
      publishNewEditorSession: note('new-editor'), clearPublishedGeometry: note('geometry')
    },
    lensBlur: { resetDepth: note('depth'), clearPickers: note('pickers'), showResult: note('result') }
  });
  return { calls, policy };
};

describe('document interaction reset policy', () => {
  it('keeps source preparation distinct from source publication in original participant order', () => {
    const { policy, calls } = setup();
    policy.prepareNewSource();
    expect(calls).toEqual(['text']);
    policy.initializeNewSelection(createEditorSession()); policy.initializeLensBlur();
    expect(calls).toEqual(['text', 'new-editor', 'selection-gesture', 'paint', 'draft',
      'clipboard', 'dialogs', 'transform', 'depth', 'pickers', 'result']);
    calls.length = 0; policy.sourcePublished();
    expect(calls).toEqual(['depth', 'pickers', 'selection-gesture', 'paint', 'draft',
      'transform', 'geometry', 'clipboard', 'dialogs', 'result']);
  });

  it('rebind retires transients without invoking new editor/selection or Lens Blur reset', () => {
    const { policy, calls } = setup();
    policy.rebindExisting();
    expect(calls).toEqual(['text', 'selection-gesture', 'paint', 'transform', 'draft', 'clipboard']);
  });
});
