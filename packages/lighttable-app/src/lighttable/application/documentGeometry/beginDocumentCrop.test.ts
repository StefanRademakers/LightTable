import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { beginDocumentCrop } from './beginDocumentCrop';

const setup = () => {
  const session = new DocumentSession({ id: 'crop' as DocumentSessionId,
    source: { id: 'source', name: 'crop', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('crop', 20, 10, 'image'));
  session.updateEditor(editor => ({ ...editor, selectionMaskSnapshot: SelectionMaskSnapshot.inactive(20, 10) }));
  let generation = 1;
  const renderer = {};
  const settle = vi.fn(async () => undefined);
  const apply = vi.fn(); const present = vi.fn();
  return {
    session, settle, apply, present, retire: () => { generation++; },
    begin: () => beginDocumentCrop({ session, settleInteraction: settle,
      captureScope: () => captureInteractionScope({ getWorkspaceId: () => 'crop',
        getLifecycleIdentity: () => renderer, getRenderer: () => renderer,
        getRendererGeneration: () => generation }),
      applySelectionCrop: apply, presentInteractiveCrop: present })
  };
};

describe('document crop intent', () => {
  it('presents interactive crop only for inactive exact coverage, without publishing document state', async () => {
    const f = setup();
    const before = f.session.getSnapshot();
    await f.begin();
    expect(f.present).toHaveBeenCalledWith({ x: 0, y: 0, width: 20, height: 10 });
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.session.getSnapshot()).toBe(before);
    f.session.dispose();
  });

  it('uses committed painted support after settlement, even with no geometry provenance', async () => {
    const f = setup();
    f.settle.mockImplementation(async () => {
      const data = new Uint16Array(200); data[44] = 0x3c00;
      f.session.updateEditor(editor => ({ ...editor, selection: [],
        selectionMaskSnapshot: SelectionMaskSnapshot.fromRaw(20, 10, data),
        selectionSupportBounds: { x: 4, y: 2, width: 1, height: 1 } }));
    });
    await f.begin();
    expect(f.apply).toHaveBeenCalledWith({ x: 4, y: 2, width: 1, height: 1 });
    expect(f.present).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it('rejects fully off-canvas active selection instead of offering a full-canvas crop', async () => {
    const f = setup();
    f.session.updateEditor(editor => ({ ...editor,
      selectionMaskSnapshot: SelectionMaskSnapshot.fromRaw(20, 10, new Uint16Array(200)),
      selectionSupportBounds: null }));
    await expect(f.begin()).rejects.toThrow('no crop area');
    expect(f.apply).not.toHaveBeenCalled(); expect(f.present).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it('rejects renderer replacement while the active transform settles', async () => {
    const f = setup();
    f.settle.mockImplementation(async () => { f.retire(); });
    await expect(f.begin()).rejects.toThrow('retired document renderer');
    expect(f.apply).not.toHaveBeenCalled(); expect(f.present).not.toHaveBeenCalled();
    f.session.dispose();
  });
});
