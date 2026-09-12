import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { useTextPropertyCommands } from './useTextPropertyCommands';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createEditorSession } from '../../editor/session/editorSession';
import { resolveTextProperties } from '../../application/text/textPropertyPresentation';
import type { FlowTextEditingSnapshot } from '../../application/text/flowTextEditingSession';
import type { TextPropertyCommandPorts } from '../../application/text/TextPropertyCommandController';

// Simulated React scheduling; the hook/controller and DocumentSession below are the production owners.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => (() => void), dependencies: readonly unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as { dependencies: readonly unknown[]; cleanup?: () => void } | undefined;
    if (previous && dependencies.every((value, i) => value === previous.dependencies[i])) return;
    const next = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = next;
    hooks.effects.push(() => { previous?.cleanup?.(); next.cleanup = setup(); });
  }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
const font: DocumentFontAsset = { assetId: 'inter', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
  source: 'bundled', container: 'woff2', outline: 'truetype', postScriptName: 'Inter-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Inter'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const fixture = () => {
  const session = new DocumentSession({ id: 'text' as DocumentSessionId, source: { id: 'text', name: 'Text', mediaType: 'image/png' } });
  sessions.push(session); session.setDocument(createTextLayer(createImageDocument('Text', 64, 48, 'asset'), createDefaultTextLayerData(), 'Type'));
  session.setReady(); const registry = {};
  let editing: FlowTextEditingSnapshot = { status: 'idle', documentId: session.getSnapshot().document!.id, layerId: null,
    selection: { anchor: 0, focus: 0 }, compositionRange: null, caretAffinity: 'downstream', preferredCaretX: null, focusKey: 0 };
  const execute = vi.fn<TextPropertyCommandPorts['execute']>(async () => ({ status: 'completed' }));
  const loadFont = vi.fn<TextPropertyCommandPorts['loadFont']>(async () => font);
  const reportFailure = vi.fn();
  const ports: TextPropertyCommandPorts = {
    getDocument: () => session.getSnapshot().document, getTool: () => 'text-point',
    captureScope: () => ({ isCurrent: () => true, assertCurrent: () => undefined }), getFontRegistry: () => registry,
    getFonts: () => [font], loadFont, execute,
    getPresentation: () => resolveTextProperties(session.getSnapshot().document, { getSnapshot: () => editing, formatProjection: () => null }, [font]).model,
    getBrushColor: () => '#000000', updateBrushColor: vi.fn(), updateDefaults: vi.fn(), getFirstBaselineOffset: () => 8,
    gestures: { begin: vi.fn(() => true), apply: vi.fn(() => true), queuePaint: vi.fn(), commit: vi.fn(() => true), cancel: vi.fn(() => true) },
    editing: { getSnapshot: () => editing, finish: vi.fn(() => true), begin: vi.fn(() => true) },
    mutations: { change: vi.fn(() => true) }, activateTool: vi.fn(), reportFailure
  };
  const render = (open = true, identity: object = session) => { hooks.cursor = 0; return useTextPropertyCommands(identity, ports, open); };
  const commit = () => hooks.effects.splice(0).forEach(effect => effect());
  const owner = render(); commit();
  return { owner, render, commit, ports, execute, loadFont, session, reportFailure,
    edit: () => { editing = { ...editing, status: 'editing', layerId: session.getSnapshot().document!.activeLayerId }; },
    reopen: () => { render(false); commit(); render(true); commit(); },
    unmount: () => { for (const slot of hooks.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.(); }
  };
};

it.each(['resolve', 'reject'] as const)('close/reopen retires pending font %s without successor mutation or error', async finish => {
  const f = fixture(), pending = deferred<DocumentFontAsset | null>(); f.loadFont.mockReturnValueOnce(pending.promise);
  const request = f.owner.applyFont('old').catch(f.reportFailure); f.reopen();
  if (finish === 'resolve') pending.resolve(font); else pending.reject(new Error('old font error'));
  await request; expect(f.execute).not.toHaveBeenCalled(); expect(f.reportFailure).not.toHaveBeenCalled();
  await f.owner.applyFont('new'); expect(f.execute).toHaveBeenCalledOnce();
});

it('ordinary rerender retains pending font work without repeating preparation', async () => {
  const f = fixture(), pending = deferred<DocumentFontAsset | null>(); f.loadFont.mockReturnValueOnce(pending.promise);
  const request = f.owner.applyFont('inter'); expect(f.render()).toBe(f.owner); f.commit();
  pending.resolve(font); await request; expect(f.loadFont).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
});

it('closed retained async entries do not start font load, text finish, execute or mutation', async () => {
  const f = fixture(); f.render(false); f.commit();
  await f.owner.applyFont('inter'); await f.owner.applyWritingMode('vertical-rl');
  expect(f.owner.applyStyle({ fontSize: 32 })).toBe(false); f.owner.changeLayoutMode('paragraph');
  expect(f.loadFont).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  expect(f.ports.editing.finish).not.toHaveBeenCalled(); expect(f.ports.mutations.change).not.toHaveBeenCalled();
});

it.each(['completed', 'rejected', 'throw'] as const)('old writing-mode %s delivery cannot activate or report after reopen', async result => {
  const f = fixture(), pending = deferred<{ status: string; message?: string }>(); f.execute.mockReturnValueOnce(pending.promise);
  const request = f.owner.applyWritingMode('vertical-rl').catch(f.reportFailure); f.reopen();
  if (result === 'throw') pending.reject(new Error('old execute error')); else pending.resolve({ status: result, message: 'old rejection' });
  await request; expect(f.ports.activateTool).not.toHaveBeenCalled(); expect(f.reportFailure).not.toHaveBeenCalled();
  await f.owner.applyWritingMode('vertical-rl'); expect(f.ports.activateTool).toHaveBeenCalledExactlyOnceWith('text-vertical');
});

it.each(['rejected', 'throw'] as const)('keeps current writing-mode %s visible exactly once', async result => {
  const f = fixture();
  if (result === 'throw') f.execute.mockRejectedValueOnce(new Error('current failure'));
  else f.execute.mockResolvedValueOnce({ status: 'rejected', message: 'current failure' });
  await f.owner.applyWritingMode('vertical-rl').catch(f.reportFailure);
  expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'current failure' }));
  expect(f.ports.activateTool).not.toHaveBeenCalled();
});

it.each(['rejected', 'throw'] as const)('discrete formatting %s is scoped across the entire execute await', async result => {
  const f = fixture(), pending = deferred<{ status: string; message?: string }>(); f.execute.mockReturnValueOnce(pending.promise);
  expect(f.owner.applyStyle({ fontSize: 32 })).toBe(true); f.reopen();
  if (result === 'throw') pending.reject(new Error('old discrete error')); else pending.resolve({ status: 'rejected', message: 'old discrete error' });
  await pending.promise.catch(() => undefined); await Promise.resolve(); expect(f.reportFailure).not.toHaveBeenCalled();
  f.execute.mockResolvedValueOnce({ status: 'rejected', message: 'current discrete error' }); f.owner.applyStyle({ fontSize: 33 });
  await Promise.resolve(); await Promise.resolve();
  expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'current discrete error' }));
});

it('retiring pending layout-mode activation does not re-enter editing after reopen', () => {
  const f = fixture(); f.edit(); let after!: () => void;
  vi.mocked(f.ports.activateTool).mockImplementation((_tool, callback) => { after = callback!; });
  f.owner.changeLayoutMode('paragraph'); expect(f.ports.mutations.change).toHaveBeenCalledOnce();
  f.reopen(); after(); expect(f.ports.editing.begin).not.toHaveBeenCalled();
  f.owner.changeLayoutMode('paragraph'); after(); expect(f.ports.editing.begin).toHaveBeenCalledOnce();
});

it.each(['identity', 'unmount'] as const)('pending font failure stays quiet after %s', async retirement => {
  const f = fixture(), pending = deferred<DocumentFontAsset | null>(); f.loadFont.mockReturnValueOnce(pending.promise);
  const request = f.owner.applyFont('inter').catch(f.reportFailure);
  if (retirement === 'identity') { f.render(true, {}); f.commit(); } else f.unmount();
  pending.reject(new Error('old load')); await request; expect(f.reportFailure).not.toHaveBeenCalled();
});

it('keeps current font failure visible without a canonical command', async () => {
  const f = fixture(); f.loadFont.mockRejectedValueOnce(new Error('current font'));
  await f.owner.applyFont('bad'); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'current font' }));
  expect(f.execute).not.toHaveBeenCalled();
});

it('does not publish a scheduled font-default recipe into reopened presentation', async () => {
  const f = fixture(); f.ports.getPresentation = () => null;
  await f.owner.applyFont('inter');
  const recipe = vi.mocked(f.ports.updateDefaults).mock.calls[0]![0], before = createEditorSession().text;
  f.reopen(); expect(recipe(before)).toBe(before);
  await f.owner.applyFont('inter'); const currentRecipe = vi.mocked(f.ports.updateDefaults).mock.calls[1]![0];
  expect(currentRecipe(before)).toMatchObject({ family: 'Inter', style: 'Regular' });
});

it.each(['font', 'writing'] as const)('%s completion before close delivers its current error before retirement, never through a later UI catch', async kind => {
  const f = fixture(), events: string[] = [];
  f.reportFailure.mockImplementation(() => { events.push('current error'); });
  const fontResult = deferred<DocumentFontAsset | null>(), commandResult = deferred<{ status: string; message?: string }>();
  f.loadFont.mockReturnValueOnce(fontResult.promise); f.execute.mockReturnValueOnce(commandResult.promise);
  const request = kind === 'font' ? f.owner.applyFont('inter') : f.owner.applyWritingMode('vertical-rl');
  if (kind === 'font') fontResult.reject(new Error('current failure'));
  else commandResult.resolve({ status: 'rejected', message: 'current failure' });
  queueMicrotask(() => { f.reopen(); events.push('closed and reopened'); });
  await expect(request).resolves.toBeUndefined();
  expect(events).toEqual(['current error', 'closed and reopened']); expect(f.reportFailure).toHaveBeenCalledOnce();
});

it('reports a genuine formatting failure after the admitted formatting operation replaces its own source', async () => {
  const f = fixture(); f.edit();
  vi.mocked(f.ports.gestures.commit).mockImplementation(() => {
    const document = f.session.getSnapshot().document!;
    f.session.setDocument({ ...document, layers: document.layers.map(layer => layer.type === 'text'
      ? { ...layer, text: { ...layer.text, source: { ...layer.text.source } } } : layer) });
    throw new Error('format history failure');
  });
  await f.owner.applyFont('inter');
  expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'format history failure' }));
});
