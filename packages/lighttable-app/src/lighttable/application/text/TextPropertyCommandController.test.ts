import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createEditorSession } from '../../editor/session/editorSession';
import type { FlowTextEditingSnapshot } from './flowTextEditingSession';
import { resolveTextProperties } from './textPropertyPresentation';
import { TextPropertyCommandController, type TextPropertyCommandPorts } from './TextPropertyCommandController';

const font: DocumentFontAsset = { assetId: 'inter', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
  source: 'bundled', container: 'woff2', outline: 'truetype', postScriptName: 'Inter-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Inter'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const setup = () => {
  const first = createTextLayer(createImageDocument('Text', 64, 48, 'asset'), createDefaultTextLayerData(), 'A');
  const second = createTextLayer(first, createDefaultTextLayerData(), 'B');
  let document = { ...second, activeLayerId: first.activeLayerId };
  let current = true; let tool = 'text-point'; let registry = {};
  let defaults = createEditorSession().text;
  let editing: FlowTextEditingSnapshot = { status: 'idle', documentId: document.id, layerId: null,
    selection: { anchor: 0, focus: 0 }, compositionRange: null, caretAffinity: 'downstream',
    preferredCaretX: null, focusKey: 0 };
  const pending = new Map<string, (asset: DocumentFontAsset | null) => void>();
  const gestures = { begin: vi.fn(() => true), apply: vi.fn(() => true), queuePaint: vi.fn(),
    commit: vi.fn(() => true), cancel: vi.fn(() => true) };
  const ports: TextPropertyCommandPorts = {
    getDocument: () => document, getTool: () => tool,
    captureScope: () => ({ isCurrent: () => current, assertCurrent: () => { if (!current) throw new Error('retired'); } }),
    getFontRegistry: () => registry, getFonts: () => [font],
    loadFont: id => new Promise(resolve => pending.set(id, resolve)),
    getPresentation: () => resolveTextProperties(document, { getSnapshot: () => editing, formatProjection: () => null }, [font]).model,
    getBrushColor: () => '#000000', updateBrushColor: vi.fn(),
    updateDefaults: recipe => { defaults = recipe(defaults); }, getFirstBaselineOffset: () => 8,
    gestures, editing: { getSnapshot: () => editing, finish: vi.fn(() => true), begin: vi.fn(() => true) },
    mutations: { change: vi.fn(() => true) }, execute: vi.fn(async () => ({ status: 'completed' })),
    activateTool: vi.fn(), reportFailure: vi.fn()
  };
  const controller = new TextPropertyCommandController(() => ports);
  return { controller, ports, gestures, pending, firstId: first.activeLayerId!, secondId: second.activeLayerId!,
    selectB: () => { document = second; }, retire: () => { current = false; },
    replaceRegistry: () => { registry = {}; }, changeTool: () => { tool = 'paint'; },
    edit: (anchor: number, focus: number) => { editing = { ...editing, status: 'editing', layerId: document.activeLayerId,
      selection: { anchor, focus } }; },
    clearTarget: () => { document = { ...document, activeLayerId: null }; },
    get defaults() { return defaults; }
  };
};

describe('Text property command ownership', () => {
  it.each(['selectB', 'retire', 'replaceRegistry', 'changeTool'] as const)(
    'rejects pending font publication after %s', async transition => {
      const h = setup(); const request = h.controller.applyFont('inter');
      h[transition](); h.pending.get('inter')!(font); await request;
      expect(h.ports.execute).not.toHaveBeenCalled(); expect(h.gestures.begin).not.toHaveBeenCalled();
    });
  it('keeps the exact editing range through font loading', async () => {
    const h = setup(); h.edit(0, 2);
    const request = h.controller.applyFont('inter'); h.edit(2, 3);
    h.pending.get('inter')!(font); await request;
    expect(h.gestures.begin).not.toHaveBeenCalled(); expect(h.ports.execute).not.toHaveBeenCalled();
  });
  it('publishes only the latest font request when bytes arrive out of order', async () => {
    const h = setup();
    const old = h.controller.applyFont('old'); const latest = h.controller.applyFont('new');
    h.pending.get('new')!({ ...font, assetId: 'new' }); await latest;
    h.pending.get('old')!({ ...font, assetId: 'old' }); await old;
    expect(h.ports.execute).toHaveBeenCalledOnce();
    expect(h.ports.execute).toHaveBeenCalledWith('text.format', expect.objectContaining({ layerId: h.firstId }));
  });
  it('retires pending work on unmount even with the same document and renderer', async () => {
    const h = setup(); const request = h.controller.applyFont('inter'); h.controller.cancelPending();
    h.pending.get('inter')!(font); await request; expect(h.ports.execute).not.toHaveBeenCalled();
  });
  it('formats an editing range through the existing gesture owner, not a second semantic command', () => {
    const h = setup(); h.edit(0, 2); h.controller.applyStyle({ fontSize: 42 });
    expect(h.gestures.begin).toHaveBeenCalledWith(h.firstId);
    expect(h.gestures.apply).toHaveBeenCalledWith({ fontSize: 42 }, {});
    expect(h.gestures.commit).toHaveBeenCalledOnce(); expect(h.ports.execute).not.toHaveBeenCalled();
  });
  it('retains existing paint coalescing and default brush behavior', () => {
    const h = setup(); h.controller.applyFill('#ff0000');
    expect(h.gestures.queuePaint).toHaveBeenCalledOnce(); expect(h.ports.execute).not.toHaveBeenCalled();
    h.clearTarget(); h.controller.applyFill('#0000ff');
    expect(h.ports.updateBrushColor).toHaveBeenCalledWith('#0000ff');
    h.controller.applyFillEnabled(false); expect(h.defaults.fillEnabled).toBe(false);
  });
  it.each(['selectB', 'retire', 'changeTool'] as const)('does not activate a tool after writing-mode completion and %s', async transition => {
    const h = setup(); let complete!: () => void;
    h.ports.execute = () => new Promise(resolve => { complete = () => resolve({ status: 'completed' }); });
    const request = h.controller.applyWritingMode('vertical-rl'); h[transition](); complete(); await request;
    expect(h.ports.activateTool).not.toHaveBeenCalled();
  });
  it('preserves visible font load failures instead of reporting success', async () => {
    const h = setup(); h.ports.loadFont = async () => { throw new Error('font load failed'); };
    await h.controller.applyFont('bad');
    expect(h.ports.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'font load failed' }));
    expect(h.ports.execute).not.toHaveBeenCalled();
  });
  it('keeps an explicitly selected font face when changing family defaults', async () => {
    const h = setup(); h.clearTarget();
    h.controller.updateDefaults({ family: 'Different', style: 'Regular' });
    const request = h.controller.applyFont('inter-bold');
    h.pending.get('inter-bold')!({ ...font, assetId: 'inter-bold', styleName: 'Bold', weight: 700 });
    await request;
    expect(h.defaults).toMatchObject({ family: 'Inter', style: 'Bold' });
    expect(h.ports.execute).not.toHaveBeenCalled();
  });
  it('does not reactivate a tool after the property binding unmounts', async () => {
    const h = setup(); let complete!: () => void;
    h.ports.execute = () => new Promise(resolve => { complete = () => resolve({ status: 'completed' }); });
    const request = h.controller.applyWritingMode('vertical-rl'); h.controller.cancelPending();
    complete(); await request; expect(h.ports.activateTool).not.toHaveBeenCalled();
  });
  it('only the newest writing-mode request may activate its matching tool', async () => {
    const h = setup(); const completed: Array<() => void> = [];
    h.ports.execute = () => new Promise(resolve => { completed.push(() => resolve({ status: 'completed' })); });
    const vertical = h.controller.applyWritingMode('vertical-rl');
    const horizontal = h.controller.applyWritingMode('horizontal-tb');
    completed[0]!(); await vertical; expect(h.ports.activateTool).not.toHaveBeenCalled();
    completed[1]!(); await horizontal;
    expect(h.ports.activateTool).toHaveBeenCalledExactlyOnceWith('text-point');
  });
});
