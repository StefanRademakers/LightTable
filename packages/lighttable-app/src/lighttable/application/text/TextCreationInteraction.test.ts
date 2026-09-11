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
});
