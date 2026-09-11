import { describe, expect, it, vi } from 'vitest';
import {
  cancelActiveEditorOperation,
  type EditorEscapeOutcome,
  type EditorEscapeParticipants
} from './cancelActiveEditorOperation';

const order = [
  'face-detection', 'tool-menu', 'crop', 'text-editing', 'paragraph-creation',
  'point-creation', 'transform', 'auto-align', 'warp', 'selection-draft',
  'pen-path', 'selection'
] as const;

const fixture = (active: readonly EditorEscapeOutcome[]) => {
  const events: string[] = [];
  const target = (name: EditorEscapeOutcome) => ({
    isActive: vi.fn(() => active.includes(name)),
    cancel: vi.fn(() => { events.push(name); })
  });
  const attempt = (name: EditorEscapeOutcome) => vi.fn(() => {
    if (!active.includes(name)) return false;
    events.push(name);
    return true;
  });
  const participants: EditorEscapeParticipants = {
    faceDetection: target('face-detection'), toolMenu: target('tool-menu'),
    crop: target('crop'), textEditing: target('text-editing'),
    cancelParagraphCreation: attempt('paragraph-creation'),
    cancelPointCreation: attempt('point-creation'), transform: target('transform'),
    autoAlign: target('auto-align'), warp: target('warp'),
    selectionDraft: target('selection-draft'), cancelPenPath: attempt('pen-path'),
    selection: target('selection')
  };
  return { participants, events };
};

describe('cancelActiveEditorOperation', () => {
  it.each(order)('terminates only %s when it and every lower target are active', (name) => {
    const { participants, events } = fixture(order.slice(order.indexOf(name)));
    expect(cancelActiveEditorOperation(participants)).toBe(name);
    expect(events).toEqual([name]);
  });

  it('leaves an idle editor unchanged', () => {
    const { participants, events } = fixture([]);
    expect(cancelActiveEditorOperation(participants)).toBe('idle');
    expect(events).toEqual([]);
  });

  it('does not consume a failure or try a lower-priority owner', () => {
    const { participants, events } = fixture(['transform', 'selection']);
    const failure = new Error('Transform cancellation is not exact');
    participants.transform.cancel = () => { throw failure; };
    expect(() => cancelActiveEditorOperation(participants)).toThrow(failure);
    expect(events).toEqual([]);
  });

  it('does not query lower owners after a higher-priority cancellation', () => {
    const { participants } = fixture(['tool-menu', 'transform']);
    expect(cancelActiveEditorOperation(participants)).toBe('tool-menu');
    expect(participants.textEditing.isActive).not.toHaveBeenCalled();
    expect(participants.transform.isActive).not.toHaveBeenCalled();
    expect(participants.cancelParagraphCreation).not.toHaveBeenCalled();
  });

  it('reads later activity after unsuccessful earlier terminal attempts', () => {
    const { participants, events } = fixture([]);
    let transformActive = false;
    participants.cancelPointCreation = () => { transformActive = true; return false; };
    participants.transform.isActive = () => transformActive;
    expect(cancelActiveEditorOperation(participants)).toBe('transform');
    expect(events).toEqual(['transform']);
  });
});
