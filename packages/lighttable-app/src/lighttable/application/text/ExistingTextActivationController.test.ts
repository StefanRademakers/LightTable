import { createDefaultFlowTextSource, createDefaultTextLayerData, type RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, createTextLayerNode } from '../../editor/document/documentTypes';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import type { FlowTextEditingSnapshot } from './flowTextEditingSession';
import { ExistingTextHitController } from './ExistingTextHitController';
import { ExistingTextActivationController, type ExistingTextActivationPorts } from './ExistingTextActivationController';

const setup = (selected = false) => {
  const layer = createTextLayerNode({ ...createDefaultTextLayerData(), source: createDefaultFlowTextSource('alpha beta') }, 'Text');
  let document = createImageDocument('Activation', 100, 100, 'asset');
  document.layers = [layer, ...document.layers];
  if (selected) document.activeLayerId = layer.id;
  let current = true; let tool = 'text-point';
  let layout: TextLayerEditingLayout | null = { layerId: layer.id, preparationKey: 'key', sourceText: 'alpha beta',
    writingMode: 'horizontal-tb', localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    layout: { schemaVersion: 2, key: 'layout', glyphRuns: [], lines: [], selectionGeometry: [], clusterMap: [], warnings: [],
      inkBounds: { x: 0, y: 0, width: 40, height: 20 }, logicalBounds: { x: 0, y: 0, width: 40, height: 20 },
      caretStops: [{ textOffset: 0, x: 0, y: 20, height: 20, affinity: 'downstream' }] } as RealizedTextLayout };
  const renderer = { currentTextEditingLayout: () => layout,
    waitForTextEditingLayout: vi.fn(async () => ({ kind: 'unavailable' as const })) };
  const report = vi.fn();
  const hit = new ExistingTextHitController({ getDocument: () => document, getRenderer: () => renderer,
    getRendererGeneration: () => 1, reportFailure: report });
  const editing: FlowTextEditingSnapshot = { status: 'idle', documentId: document.id, layerId: null,
    selection: { anchor: 0, focus: 0 }, compositionRange: null, caretAffinity: 'downstream', preferredCaretX: null, focusKey: 0 };
  const select: Array<() => void> = [];
  const ports: ExistingTextActivationPorts = {
    getDocument: () => document, getRenderer: () => renderer, getTool: () => tool, getScale: () => 1,
    captureScope: () => ({ isCurrent: () => current, assertCurrent: vi.fn() }), hit,
    editing: { getSnapshot: () => editing, setSelection: vi.fn() }, selection: { begin: vi.fn() },
    cancelCreation: vi.fn(), requestEditing: vi.fn(() => true),
    selectLayer: id => new Promise(resolve => select.push(() => {
      document = { ...document, activeLayerId: id }; resolve(true);
    })), miss: vi.fn(), reportFailure: report
  };
  const controller = new ExistingTextActivationController(() => ports);
  return { controller, ports, layer, select, hit, renderer, report,
    retire: () => { current = false; }, changeTool: () => { tool = 'paint'; },
    removeLayout: () => { layout = null; }, changeSource: () => { layer.text = { ...layer.text,
      source: createDefaultFlowTextSource('changed'),
      revisions: { ...layer.text.revisions, content: layer.text.revisions.content + 1 } }; }
  };
};

describe('Existing text activation', () => {
  it('starts immediate exact hits with the existing selection gesture owner', () => {
    const h = setup(true);
    expect(h.controller.begin({ x: 10, y: 10 }, 'any', 8, 2)).toBe(true);
    expect(h.ports.requestEditing).toHaveBeenCalledWith(h.layer.id, 0, 'downstream');
    expect(h.ports.selection.begin).toHaveBeenCalledWith(8, h.layer.id, expect.any(Object), 'word');
    expect(h.ports.cancelCreation).toHaveBeenCalledOnce();
  });
  it('selects then re-hits current geometry without resurrecting an old pointer gesture', async () => {
    const h = setup(); h.controller.begin({ x: 10, y: 10 }, 'any', 8);
    expect(h.ports.requestEditing).not.toHaveBeenCalled();
    h.select[0]!(); await Promise.resolve();
    expect(h.ports.requestEditing).toHaveBeenCalledWith(h.layer.id, 0, 'downstream');
    expect(h.ports.selection.begin).not.toHaveBeenCalled();
  });
  it.each(['retire', 'changeTool', 'removeLayout', 'changeSource'] as const)(
    'rejects post-selection activation after %s', async change => {
      const h = setup(); h.controller.begin({ x: 10, y: 10 }); h[change]();
      h.select[0]!(); await Promise.resolve(); expect(h.ports.requestEditing).not.toHaveBeenCalled();
    });
  it('cancels same-scope activation and admits only a newer click', async () => {
    const h = setup(); h.controller.begin({ x: 10, y: 10 }); h.controller.cancel();
    h.select[0]!(); await Promise.resolve(); expect(h.ports.requestEditing).not.toHaveBeenCalled();
    h.controller.begin({ x: 10, y: 10 }); expect(h.ports.requestEditing).toHaveBeenCalledOnce();
  });
  it('surfaces a layer selection failure instead of silently discarding it', async () => {
    const h = setup(); const failure = new Error('selection admission failed');
    h.ports.selectLayer = async () => { throw failure; };
    h.controller.begin({ x: 10, y: 10 }); await Promise.resolve(); await Promise.resolve();
    expect(h.report).toHaveBeenCalledWith(failure); expect(h.ports.requestEditing).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'retire', 'newer-click'] as const)('does not report retired selection failure after %s', async change => {
    const h = setup(); let reject!: (error: Error) => void;
    h.ports.selectLayer = () => new Promise((_, fail) => { reject = fail; });
    h.controller.begin({ x: 10, y: 10 });
    const rejectFirst = reject;
    if (change === 'cancel') h.controller.cancel();
    else if (change === 'retire') h.retire();
    else h.controller.begin({ x: 10, y: 10 });
    rejectFirst(new Error('retired selection'));
    await Promise.resolve(); await Promise.resolve();
    expect(h.report).not.toHaveBeenCalled(); expect(h.ports.requestEditing).not.toHaveBeenCalled();
  });
  it('reports a real layout failure, releases pointer intent and never creates text from that failure', async () => {
    const h = setup(true); h.removeLayout(); const failure = new Error('layout failed');
    h.renderer.waitForTextEditingLayout.mockRejectedValue(failure);
    expect(h.controller.begin({ x: 10, y: 10 }, 'any', 8)).toBe(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.report).toHaveBeenCalledWith(failure); expect(h.hit.owns(8)).toBe(false);
    expect(h.ports.miss).not.toHaveBeenCalled();
  });
  it('retired layout cancellation neither reports an error nor starts miss creation', async () => {
    const h = setup(true); h.removeLayout();
    h.renderer.waitForTextEditingLayout.mockRejectedValue(new Error('aborted'));
    h.controller.begin({ x: 10, y: 10 }, 'any', 8); h.controller.cancel();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.report).not.toHaveBeenCalled(); expect(h.ports.miss).not.toHaveBeenCalled();
  });
});
