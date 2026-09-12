import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextCreation } from './useTextCreation';
import { createImageDocument, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { createEditorSession } from '../../editor/session/editorSession';
import { DocumentCommandExecutionQueue } from '../../application/commands/DocumentCommandExecutionQueue';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandService } from '../../application/commands/lightTableCommandService';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], cleanup: null as null | (() => void) }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (create: () => unknown) => hooks.slots[hooks.cursor++] ??= create(),
  useLayoutEffect: (setup: () => () => void) => { hooks.cleanup = setup(); }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.cleanup = null; });
const font: DocumentFontAsset = { assetId: 'fixture-font', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
  source: 'document', container: 'woff2', outline: 'truetype', postScriptName: 'Fixture-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Fixture'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const setup = () => {
  const document = createImageDocument('Text', 100, 100, 'source'), registry = {};
  const renderer = { configureTextFonts: vi.fn() }, queue = new DocumentCommandExecutionQueue();
  let resolve!: () => void, current = true;
  const ready = new Promise<void>(yes => { resolve = yes; });
  const ports: Parameters<typeof useTextCreation>[4] = {
    getDocument: () => document, getTool: () => 'text-point', getSettings: () => ({ ...createEditorSession().text, family: 'Fixture', style: 'Regular' }),
    getColor: () => '#123456', getScale: () => 1, getRenderer: () => renderer, rendererReady: () => true,
    getFontRuntime: () => ({}) as never, getFontRegistry: () => registry, getFonts: () => [font],
    prepareFont: () => ready, probe: async () => {},
    captureScope: () => ({ isCurrent: () => current, assertCurrent: () => { if (!current) throw new Error('Retired'); } }),
    beginEditing: vi.fn(), setStatus: vi.fn(), reportFailure: vi.fn()
  };
  const submission = (documentId: string) => ({ documentId, nextRequestId: vi.fn(() => `request-${documentId}`), commands: {
    enqueueTextCreation: vi.fn<LightTableCommandService['enqueueTextCreation']>((request, assertCurrent) =>
      queue.enqueue(undefined, 'text.create', async () => {
        assertCurrent(); return { requestId: request.requestId, status: 'completed', value: { layerId: 'created' }, revisions: { workspace: 0 } };
      }))
  } });
  const render = (submission: Parameters<typeof useTextCreation>[5]) => {
    hooks.cursor = 0; return useTextCreation(document, 'text-point', 1, registry, ports, submission);
  };
  return { submission, render, ready: resolve, retire: () => { current = false; }, ports };
};

describe('useTextCreation tracked submission mapping (simulated hooks, real creation owner)', () => {
  it('pins original command service/document/request source across an ordinary rerender during preparation', async () => {
    const f = setup(), opening = f.submission('original'), later = f.submission('later');
    const owner = f.render(opening), begin = owner.beginPoint({ x: 12, y: 34 });
    expect(f.render(later)).toBe(owner); f.ready(); await begin; await owner.finishForFile();
    expect(opening.commands.enqueueTextCreation).toHaveBeenCalledExactlyOnceWith({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION, requestId: 'request-original', command: 'text.create', documentId: 'original',
      parameters: expect.objectContaining({ mode: 'point', origin: { x: 12, y: 34 }, style: expect.objectContaining({ font: { assetId: font.assetId } }) })
    }, expect.any(Function));
    expect(opening.nextRequestId).toHaveBeenCalledOnce(); expect(later.nextRequestId).not.toHaveBeenCalled();
    expect(later.commands.enqueueTextCreation).not.toHaveBeenCalled();
    await owner.beginPoint({ x: 2, y: 3 }); await owner.finishForFile();
    expect(later.commands.enqueueTextCreation).toHaveBeenCalledOnce();
  });
  it.each(['scope', 'unmount'] as const)('does not construct an envelope after %s retires pending readiness', async kind => {
    const f = setup(), submission = f.submission('original'), owner = f.render(submission);
    const begin = owner.beginPoint({ x: 12, y: 34 });
    if (kind === 'scope') f.retire(); else hooks.cleanup!();
    f.ready(); await begin;
    expect(submission.commands.enqueueTextCreation).not.toHaveBeenCalled(); expect(submission.nextRequestId).not.toHaveBeenCalled();
    expect(f.ports.reportFailure).not.toHaveBeenCalled();
  });
});
