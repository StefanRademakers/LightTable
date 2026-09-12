import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentFontAsset, type LayerId } from '../../editor/document/documentTypes';
import { createEditorSession } from '../../editor/session/editorSession';
import type { TextFontRuntimePort } from '../../editor/rendering/createLayerDocumentRendererRuntime';
import { TextCreationInteraction, type TextCreationPorts } from './TextCreationInteraction';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const font: DocumentFontAsset = { assetId: 'inter', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
  source: 'bundled', container: 'woff2', outline: 'truetype', postScriptName: 'Inter-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Inter'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const setup = () => {
  let document = createImageDocument('Creation', 100, 100, 'asset');
  let tool = 'text-point'; let current = true; let registry = {};
  let renderer = { configureTextFonts: vi.fn() }; const firstRenderer = renderer;
  const settings = { ...createEditorSession().text, family: 'Inter', style: 'Regular' };
  const runtime: TextFontRuntimePort = { revision: 1, assets: [font], loadedByteSize: 0,
    bytes: async () => null, subscribe: () => () => undefined };
  const ready = deferred<void>();
  const ports: TextCreationPorts = {
    getDocument: () => document, getTool: () => tool, getSettings: () => settings,
    getColor: () => '#123456', getScale: () => 1, getRenderer: () => renderer, rendererReady: () => true,
    getFontRuntime: () => runtime, getFontRegistry: () => registry, getFonts: () => [font],
    prepareFont: vi.fn(() => ready.promise), probe: vi.fn(async () => undefined),
    captureScope: () => ({ isCurrent: () => current, assertCurrent: vi.fn() }),
    execute: vi.fn(async () => { document = { ...document, activeLayerId: 'created' as LayerId };
      return { status: 'completed', value: { layerId: 'created' } }; }),
    beginEditing: vi.fn(), setStatus: vi.fn(), reportFailure: vi.fn()
  };
  const owner = new TextCreationInteraction(() => ports);
  return { owner, ports, ready, firstRenderer, settings,
    retire: () => { current = false; }, tool: (value: string) => { tool = value; },
    registry: () => { registry = {}; }, renderer: () => { renderer = { configureTextFonts: vi.fn() }; },
    target: () => { document = { ...document, activeLayerId: 'other' as LayerId }; } };
};

describe('Text creation intent lifetime', () => {
  it('queued file readiness is read-only and rejects pending creation without dispatching it', async () => {
    const h = setup(); expect(() => h.owner.assertFileCommandReady()).not.toThrow();
    void h.owner.beginPoint({ x: 5, y: 7 });
    expect(() => h.owner.assertFileCommandReady()).toThrow(/pending text creation/);
    expect(h.ports.execute).not.toHaveBeenCalled();
    const file = h.owner.finishForFile(); h.ready.resolve(); await file;
    expect(() => h.owner.assertFileCommandReady()).not.toThrow();
    expect(h.ports.execute).toHaveBeenCalledOnce();
  });
  it('queued file readiness does not reject a retired creation belonging to an old scope', () => {
    const h = setup(); void h.owner.beginPoint({ x: 5, y: 7 }); h.retire();
    expect(() => h.owner.assertFileCommandReady()).not.toThrow();
    expect(h.ports.execute).not.toHaveBeenCalled(); h.owner.cancel(); h.ready.resolve();
  });
  it('creates once through the semantic route after preparation and activates the authored result', async () => {
    const h = setup(); const begin = h.owner.beginPoint({ x: 5, y: 7 });
    expect(h.ports.execute).not.toHaveBeenCalled(); h.ready.resolve(); await begin; await flush();
    expect(h.firstRenderer.configureTextFonts).toHaveBeenCalledOnce();
    expect(h.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'point', origin: { x: 5, y: 7 } }));
    expect(h.ports.beginEditing).toHaveBeenCalledWith('created'); expect(h.owner.commitPoint()).toBe(false);
  });
  it.each(['cancel', 'retire', 'tool', 'renderer', 'registry', 'target'] as const)(
    'does not configure or create after pending %s', async change => {
      const h = setup(); const begin = h.owner.beginPoint({ x: 5, y: 7 });
      if (change === 'cancel') expect(h.owner.cancelPoint()).toBe(true);
      else if (change === 'tool') h.tool('text-vertical');
      else h[change]();
      h.ready.resolve(); await begin;
      expect(h.firstRenderer.configureTextFonts).not.toHaveBeenCalled();
      expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.ports.beginEditing).not.toHaveBeenCalled();
    });
  it('waits for probe as well as font before a finished paragraph is published exactly once', async () => {
    const h = setup(); const probe = deferred<void>(); h.ports.probe = () => probe.promise;
    h.owner.beginParagraph(1, { x: 2, y: 3 }); h.owner.finish(1, { x: 40, y: 30 });
    h.ready.resolve(); await flush(); expect(h.ports.execute).not.toHaveBeenCalled();
    probe.resolve(); await flush();
    expect(h.ports.execute).toHaveBeenCalledOnce();
    expect(h.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'paragraph', frame: { width: 38, height: 27 } }));
    expect(h.owner.finish(1, { x: 50, y: 40 })).toBe(false);
  });
  it('cannot recreate a point draft when canceled between preparation and its awaiting continuation', async () => {
    const h = setup(); h.firstRenderer.configureTextFonts.mockImplementation(() => {
      queueMicrotask(() => h.owner.cancel());
    });
    h.ready.resolve(); await h.owner.beginPoint({ x: 5, y: 7 });
    expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.owner.cancelPoint()).toBe(false);
  });
  it.each(['target', 'renderer', 'retire'] as const)('retires a finished cold paragraph after %s changes', async change => {
    const h = setup(); h.owner.beginParagraph(1, { x: 2, y: 3 }); h.owner.finish(1, { x: 40, y: 30 });
    expect(h.owner.getSnapshot().status).toBe('editing'); h[change]();
    h.ready.resolve(); await flush();
    expect(h.owner.getSnapshot().status).toBe('idle'); expect(h.owner.owns(1)).toBe(false);
    expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.owner.cancel()).toBe(false);
  });
  it('commits a warmed paragraph synchronously on pointer-up without another preparation wait', async () => {
    const h = setup(); h.ready.resolve(); h.owner.beginParagraph(1, { x: 2, y: 3 }); await flush();
    expect(h.ports.execute).not.toHaveBeenCalled(); h.owner.finish(1, { x: 40, y: 30 });
    expect(h.ports.execute).toHaveBeenCalledOnce();
  });
  it('retires a paragraph invalidated between preparation and its continuation', async () => {
    const h = setup(); h.firstRenderer.configureTextFonts.mockImplementation(() => {
      queueMicrotask(h.target);
    });
    h.owner.beginParagraph(1, { x: 2, y: 3 }); h.owner.finish(1, { x: 40, y: 30 });
    h.ready.resolve(); await flush();
    expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.owner.getSnapshot().status).toBe('idle');
  });
  it('small drags become a single point command and preserve vertical authoring', async () => {
    const h = setup(); h.tool('text-vertical'); h.owner.beginParagraph(2, { x: 4, y: 4 });
    h.owner.finish(2, { x: 5, y: 4 }); h.ready.resolve(); await flush();
    expect(h.ports.execute).toHaveBeenCalledOnce();
    expect(h.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'point', writingMode: 'vertical-rl' }));
  });
  it('captures creation settings instead of reading later toolbar defaults', async () => {
    const h = setup(); const size = h.settings.size;
    const begin = h.owner.beginPoint({ x: 5, y: 7 }); h.settings.size = 300;
    h.ready.resolve(); await begin;
    expect(h.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ style: expect.objectContaining({ fontSize: size }) }));
  });
  it('preserves the explicit native path target in the semantic command', async () => {
    const h = setup(); h.tool('text-path');
    const path = { pathLayerId: 'path-layer' as LayerId, pathElementId: 'path-element', pathSubpathId: 'contour' };
    const begin = h.owner.beginPoint({ x: 5, y: 7 }, path); h.ready.resolve(); await begin;
    expect(h.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'path',
      path: expect.objectContaining({ layerId: path.pathLayerId, elementId: path.pathElementId, subpathId: path.pathSubpathId }) }));
  });
  it('a canceled command continuation cannot steal editing focus after document publication', async () => {
    const h = setup(); const execution = deferred<{ status: string; value: unknown }>();
    h.ports.execute = () => execution.promise;
    h.ready.resolve(); await h.owner.beginPoint({ x: 5, y: 7 });
    h.owner.cancel(); execution.resolve({ status: 'completed', value: { layerId: 'created' } }); await flush();
    expect(h.ports.beginEditing).not.toHaveBeenCalled();
  });
  it('failed old preparation cannot cancel a newer paragraph or publish its error', async () => {
    const h = setup(); const first = h.owner.beginPoint({ x: 5, y: 7 });
    const second = deferred<void>(); h.ports.prepareFont = () => second.promise;
    h.owner.beginParagraph(2, { x: 3, y: 4 }); h.ready.reject(new Error('old font'));
    await first; expect(h.owner.owns(2)).toBe(true); expect(h.ports.reportFailure).not.toHaveBeenCalled();
    second.resolve(); await flush(); h.owner.finish(2, { x: 30, y: 40 });
    expect(h.ports.execute).toHaveBeenCalledOnce();
  });
  it('current preparation failure is visible and retires its draft', async () => {
    const h = setup(); h.owner.beginParagraph(2, { x: 3, y: 4 });
    h.ready.reject(new Error('font failed')); await flush();
    expect(h.ports.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'Text creation is unavailable: font failed' }));
    expect(h.owner.owns(2)).toBe(false); expect(h.ports.execute).not.toHaveBeenCalled();
  });

  it.each(['point', 'paragraph'] as const)('file preparation waits for cold %s creation and actual command completion', async kind => {
    const h = setup(); const execution = deferred<{ status: string; value: unknown }>();
    h.ports.execute = vi.fn(() => execution.promise);
    if (kind === 'point') void h.owner.beginPoint({ x: 5, y: 7 });
    else { h.owner.beginParagraph(1, { x: 2, y: 3 }); h.owner.move(1, { x: 40, y: 30 }); }
    let finished = false;
    const fileReady = h.owner.finishForFile().then(() => { finished = true; });
    await flush(); expect(finished).toBe(false); expect(h.ports.execute).not.toHaveBeenCalled();
    h.ready.resolve(); await flush();
    expect(h.ports.execute).toHaveBeenCalledOnce(); expect(finished).toBe(false);
    execution.resolve({ status: 'completed', value: { layerId: 'created' } }); await fileReady;
    expect(finished).toBe(true); expect(h.ports.beginEditing).not.toHaveBeenCalled();
  });

  it('file preparation waits through the point-ready continuation gap', async () => {
    const h = setup(); let fileReady!: Promise<void>;
    h.firstRenderer.configureTextFonts.mockImplementation(() => {
      queueMicrotask(() => { fileReady = h.owner.finishForFile(); });
    });
    const begin = h.owner.beginPoint({ x: 5, y: 7 }); h.ready.resolve();
    await begin; await fileReady;
    expect(h.ports.execute).toHaveBeenCalledOnce();
    expect(h.ports.beginEditing).not.toHaveBeenCalled();
  });

  it('two file waiters share one in-flight text command', async () => {
    const h = setup(); const execution = deferred<{ status: string; value: unknown }>();
    h.ports.execute = vi.fn(() => execution.promise);
    h.ready.resolve(); await h.owner.beginPoint({ x: 5, y: 7 });
    const first = h.owner.finishForFile(); const second = h.owner.finishForFile();
    execution.resolve({ status: 'completed', value: { layerId: 'created' } });
    await Promise.all([first, second]); expect(h.ports.execute).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'retire', 'renderer', 'registry'] as const)('file preparation rejects pending %s without a new creation', async change => {
    const h = setup(); void h.owner.beginPoint({ x: 5, y: 7 });
    const ready = expect(h.owner.finishForFile()).rejects.toThrow(/retired/i);
    if (change === 'cancel') h.owner.cancel(); else h[change]();
    h.ready.resolve(); await ready;
    expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.ports.beginEditing).not.toHaveBeenCalled();
  });

  it('file preparation reports font failure and rejects instead of saving without the creation', async () => {
    const h = setup(); void h.owner.beginPoint({ x: 5, y: 7 });
    const ready = expect(h.owner.finishForFile()).rejects.toThrow('font failed');
    h.ready.reject(new Error('font failed')); await ready;
    expect(h.ports.reportFailure).toHaveBeenCalledOnce(); expect(h.ports.execute).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'accepted'] as const)('file preparation rejects semantic %s rather than claiming committed text', async status => {
    const h = setup(); h.ports.execute = vi.fn(async () => ({ status, message: 'Not committed' }));
    void h.owner.beginPoint({ x: 5, y: 7 });
    const ready = expect(h.owner.finishForFile()).rejects.toThrow('Not committed');
    h.ready.resolve(); await ready;
    expect(h.ports.beginEditing).not.toHaveBeenCalled(); expect(h.ports.reportFailure).toHaveBeenCalledOnce();
  });

  it('file preparation propagates synchronous dispatch failure without an unhandled promise', async () => {
    const h = setup(); h.ports.execute = vi.fn(() => { throw new Error('Dispatch failed'); });
    void h.owner.beginPoint({ x: 5, y: 7 });
    const ready = expect(h.owner.finishForFile()).rejects.toThrow('Dispatch failed');
    h.ready.resolve(); await ready;
    expect(h.ports.reportFailure).toHaveBeenCalledOnce();
  });

  it('file preparation preserves short-drag conversion to one point creation', async () => {
    const h = setup(); h.owner.beginParagraph(1, { x: 5, y: 7 });
    h.owner.move(1, { x: 6, y: 7 });
    const ready = h.owner.finishForFile(); h.ready.resolve(); await ready;
    expect(h.ports.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'point' }));
    expect(h.ports.beginEditing).not.toHaveBeenCalled();
  });

  it('a new creation rejects an old file waiter without joining or canceling the new owner', async () => {
    const h = setup(); void h.owner.beginPoint({ x: 5, y: 7 });
    const oldFile = expect(h.owner.finishForFile()).rejects.toThrow(/retired/i);
    h.owner.beginParagraph(2, { x: 3, y: 4 }); await oldFile;
    expect(h.owner.owns(2)).toBe(true);
    h.ready.resolve(); await flush(); h.owner.finish(2, { x: 40, y: 30 }); await flush();
    expect(h.ports.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'paragraph' }));
  });

  it('keeps a current interactive editing-activation failure visible after creation commits', async () => {
    const h = setup(); h.ports.beginEditing = vi.fn(() => { throw new Error('Editing activation failed'); });
    h.ready.resolve(); await h.owner.beginPoint({ x: 5, y: 7 }); await flush();
    expect(h.ports.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'Editing activation failed' }));
  });
});
