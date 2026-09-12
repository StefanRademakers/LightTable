import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION } from '../commands/lightTableCommandService';
import { createClipboardCommands, type ClipboardCommandPorts } from './createClipboardCommands';

afterEach(() => vi.unstubAllGlobals());

const makeSession = () => {
  const session = new DocumentSession({ id: 'clipboard' as DocumentSessionId,
    source: { id: 'source', name: 'source.png', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Source', 20, 10, 'source'));
  session.setReady();
  return session;
};
const fixture = () => {
  let session = makeSession();
  let renderer: object | null = null;
  let generation = 0;
  let request = 0;
  const bitmap = { width: 2, height: 2, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  const execute = vi.fn<ClipboardCommandPorts['commands']['execute']>(async () => ({
    status: 'completed', requestId: 'result', command: 'selection.pastePixels'
  } as never));
  const readImage = vi.fn(async () => ({ blob: new Blob(['png'], { type: 'image/png' }), placement: null }));
  const copySelected = vi.fn<ClipboardCommandPorts['copySelected']>(async () => ({ id: 'capture' } as never));
  const fill = { apply: vi.fn(() => true) } as unknown as ClipboardCommandPorts['fill'];
  const ports: ClipboardCommandPorts = {
    getSession: () => session, getRenderer: () => renderer,
    captureScope: () => { const opening = generation; return { isCurrent: () => generation === opening }; },
    getPlacementView: () => ({ viewportSize: { width: 20, height: 10 }, imageRect: { x: 0, y: 0, width: 20, height: 10 } }),
    settleInteraction: vi.fn(async () => undefined),
    clipboard: { readImage } as unknown as ClipboardCommandPorts['clipboard'],
    commands: { execute, matchingPixelClipboardCopyArtifact: vi.fn(() => null),
      registerPixelClipboardArtifact: vi.fn(() => ({ id: 'artifact' } as never)), releaseArtifact: vi.fn(() => true) },
    nextRequestId: id => `ui-${id}-${++request}`, copySelected, fill,
    reportError: vi.fn(), reportStatus: vi.fn()
  };
  const commands = createClipboardCommands(() => ports);
  return { commands, ports, execute, readImage, bitmap, copySelected,
    session: () => session, mount: () => { renderer = {}; },
    retire: (kind: 'session' | 'renderer' | 'generation') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'renderer') renderer = {};
      else generation += 1;
    } };
};
const paintSelection = (session: DocumentSession, active = true) => {
  const raw = new Uint16Array(200);
  if (active) raw[2 * 20 + 4] = 0x3c00;
  const coverage = SelectionMaskSnapshot.fromRaw(20, 10, raw);
  session.updateEditor(editor => ({ ...editor, selection: [],
    selectionMaskSnapshot: coverage, selectionSupportBounds: coverage.measureSupportBounds(), selectionRevision: 9 }));
};

describe('clipboard command composition', () => {
  it('captures the renderer at request time and preserves command metadata and default UI recording', async () => {
    const f = fixture(); // Owner is constructed before the renderer exists.
    f.mount();
    expect(await f.commands.host.copy('merged')).toBe(true);
    expect(f.execute).toHaveBeenCalledExactlyOnceWith({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION, requestId: 'ui-clipboard-1',
      documentId: 'clipboard', command: 'selection.copyPixels', parameters: { source: 'merged' }
    });
    // No second execute-options argument overrides the service's UI/record defaults.
    expect(f.ports.settleInteraction).not.toHaveBeenCalled();
  });

  it('uses exact committed painted support and channel, even with empty geometric provenance', async () => {
    const f = fixture(); f.mount(); paintSelection(f.session());
    f.session().updateEditor(editor => ({ ...editor, activeChannel: 'mask' }));
    expect(await f.commands.host.paste()).toBe(true);
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ parameters: {
      artifactId: 'artifact', name: 'Pasted Selection', bounds: { x: 4, y: 2, width: 2, height: 2 },
      target: { channel: 'mask', layerId: f.session().getSnapshot().document!.activeLayerId }
    } }));
    expect(f.bitmap.close).toHaveBeenCalledOnce();
    expect(f.ports.commands.releaseArtifact).not.toHaveBeenCalled();
  });

  it('does not reject a live gesture before the semantic gateway can settle its admission', async () => {
    const f = fixture(); f.mount();
    const reservation = f.session().history.reserve({ id: 'gesture', type: 'test', label: 'Gesture',
      documentId: f.session().id, undo() {}, redo() {} });
    expect(f.session().isAcceptingMutations()).toBe(false);
    f.execute.mockImplementation(async () => {
      reservation.cancel();
      return { status: 'completed' } as never;
    });
    expect(await f.commands.host.copy('active-layer')).toBe(true);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.session().isAcceptingMutations()).toBe(true);
  });

  it.each(['session', 'renderer', 'generation'] as const)('rejects %s replacement across host read without foreign error', async kind => {
    const f = fixture(); f.mount();
    f.readImage.mockImplementation(async () => { f.retire(kind); return { blob: new Blob(['png']), placement: null }; });
    expect(await f.commands.host.paste()).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.ports.reportError).not.toHaveBeenCalled();
  });

  it('does not confuse active clipped coverage with no selection', async () => {
    const f = fixture(); f.mount(); paintSelection(f.session(), false);
    expect(await f.commands.host.paste()).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.ports.reportError).toHaveBeenCalledWith(expect.stringContaining('no pixels inside'));
  });

  it('cuts painted selection without a geometric provenance entry and rejects changed coverage after copy', async () => {
    const f = fixture(); f.mount(); paintSelection(f.session());
    f.copySelected.mockImplementation(async () => {
      f.session().updateEditor(editor => ({ ...editor, selectionRevision: 10 }));
      return { id: 'capture' } as never;
    });
    await expect(f.commands.cut.execute()).rejects.toThrow('Pixels were copied but not removed');
    expect(f.copySelected).toHaveBeenCalledWith([]);
    expect(f.ports.fill.apply).not.toHaveBeenCalled();
  });
});
