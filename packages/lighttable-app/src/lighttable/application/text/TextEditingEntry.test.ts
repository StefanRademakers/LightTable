import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, createTextLayerNode, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { TextEditingEntry, type TextEditingEntryPorts } from './TextEditingEntry';

const face: DocumentFontAsset = { assetId: 'present', faceIndex: 0, fingerprintSha256: 'b'.repeat(64),
  source: 'bundled', container: 'woff2', outline: 'truetype', postScriptName: 'Present-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Present'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const deferred = () => { let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const setup = (missing = false) => {
  const initial = createDefaultFlowTextSource('Hello');
  const source = { ...initial, styleRuns: initial.styleRuns.map(run => ({ ...run,
    requestedFont: { families: [missing ? 'Missing' : 'Present'] } })) };
  const layer = createTextLayerNode({ ...createDefaultTextLayerData(), source }, 'Text');
  let document = createImageDocument('Entry', 100, 100, 'asset'); document.layers.push(layer);
  let scope = true; let tool = 'brush'; let registry = {};
  const selection = deferred();
  const p: TextEditingEntryPorts = {
    getDocument: () => document, getTool: () => tool, getFontRegistry: () => registry,
    getFonts: () => [face], substitutionFamilies: [],
    captureScope: () => ({ isCurrent: () => scope, assertCurrent: vi.fn() }),
    selectLayer: vi.fn(async id => { await selection.promise; document = { ...document, activeLayerId: id }; }),
    activateType: vi.fn(async after => { tool = 'text-point'; after(); }), cancelCreation: vi.fn(),
    beginEditing: vi.fn(() => true), requestRecovery: vi.fn(), showProperties: vi.fn(), closeReport: vi.fn(), reportFailure: vi.fn()
  };
  const owner = new TextEditingEntry(() => p);
  return { owner, p, layer, selection, retire: () => { scope = false; }, tool: (value: string) => { tool = value; },
    registry: () => { registry = {}; }, source: () => { layer.text = { ...layer.text,
      revisions: { ...layer.text.revisions, content: layer.text.revisions.content + 1 } }; } };
};
describe('Text editing entry', () => {
  it('enters exact fonts immediately without consulting diagnostic UI', () => {
    const h = setup(); expect(h.owner.request(h.layer.id, 3, 'upstream')).toBe(true);
    expect(h.p.beginEditing).toHaveBeenCalledWith(h.layer.id, 3, 'upstream');
    expect(h.p.requestRecovery).not.toHaveBeenCalled();
  });
  it('opens recovery from authored missing font identity and keeps offset/affinity', () => {
    const h = setup(true); expect(h.owner.request(h.layer.id, 3, 'upstream')).toBe(false);
    expect(h.p.requestRecovery).toHaveBeenCalledWith(expect.objectContaining({ layerId: h.layer.id,
      requestedFont: 'Missing', sourceIdentity: expect.any(String), offset: 3, affinity: 'upstream' }));
    expect(h.p.beginEditing).not.toHaveBeenCalled();
  });
  it('selects, activates Type and enters through the same font gate', async () => {
    const h = setup(true); const entry = h.owner.selectAndEnter(h.layer.id, { closeReport: true, offset: 2 });
    expect(h.p.activateType).not.toHaveBeenCalled(); h.selection.resolve(); await entry;
    expect(h.p.cancelCreation).toHaveBeenCalledOnce(); expect(h.p.closeReport).toHaveBeenCalledOnce();
    expect(h.p.showProperties).toHaveBeenCalledWith(h.layer.id); expect(h.p.requestRecovery).toHaveBeenCalledOnce();
  });
  it.each(['retire', 'tool', 'registry', 'source', 'cancel'] as const)(
    'rejects pending entry after %s', async change => {
      const h = setup(); const entry = h.owner.selectAndEnter(h.layer.id);
      if (change === 'tool') h.tool('zoom'); else if (change === 'cancel') h.owner.cancel(); else h[change]();
      h.selection.resolve(); await entry;
      expect(h.p.activateType).not.toHaveBeenCalled(); expect(h.p.beginEditing).not.toHaveBeenCalled();
    });
  it('checks lifetime again inside delayed tool activation', async () => {
    const h = setup(); const activation = deferred();
    h.p.activateType = async after => { await activation.promise; h.tool('text-point'); after(); };
    const entry = h.owner.selectAndEnter(h.layer.id); h.selection.resolve();
    await Promise.resolve(); await Promise.resolve(); h.retire(); activation.resolve(); await entry;
    expect(h.p.beginEditing).not.toHaveBeenCalled(); expect(h.p.showProperties).not.toHaveBeenCalled();
  });
  it('returning to the initial tool cannot revive an entry canceled by an observed tool change', async () => {
    const h = setup(); const entry = h.owner.selectAndEnter(h.layer.id);
    h.tool('zoom'); h.owner.observeTool('zoom'); h.tool('brush'); h.owner.observeTool('brush');
    h.selection.resolve(); await entry;
    expect(h.p.activateType).not.toHaveBeenCalled(); expect(h.p.beginEditing).not.toHaveBeenCalled();
  });
  it('allows its own observed Type activation without retiring the entry', async () => {
    const h = setup(); h.p.activateType = async after => {
      h.tool('text-point'); h.owner.observeTool('text-point'); after();
    };
    const entry = h.owner.selectAndEnter(h.layer.id); h.selection.resolve(); await entry;
    expect(h.p.beginEditing).toHaveBeenCalledOnce();
  });
  it('a direct text hit supersedes an older pending report entry', async () => {
    const h = setup(); const entry = h.owner.selectAndEnter(h.layer.id, { closeReport: true });
    h.owner.request(h.layer.id); h.selection.resolve(); await entry;
    expect(h.p.beginEditing).toHaveBeenCalledOnce(); expect(h.p.closeReport).not.toHaveBeenCalled();
    expect(h.p.activateType).not.toHaveBeenCalled();
  });
  it('reports current activation/UI errors instead of swallowing them after successful editing entry', async () => {
    const h = setup(); const failure = new Error('properties failed');
    h.p.showProperties = () => { throw failure; };
    const entry = h.owner.selectAndEnter(h.layer.id); h.selection.resolve(); await entry;
    expect(h.p.beginEditing).toHaveBeenCalledOnce(); expect(h.p.reportFailure).toHaveBeenCalledWith(failure);
  });
  it.each([false, true])('reports selection rejection only for its current tool (changed=%s)', async changed => {
    const h = setup(); const failure = new Error('selection failed');
    h.p.selectLayer = async () => { await h.selection.promise; throw failure; };
    const entry = h.owner.selectAndEnter(h.layer.id);
    if (changed) h.tool('zoom');
    h.selection.resolve(); await entry;
    if (changed) expect(h.p.reportFailure).not.toHaveBeenCalled();
    else expect(h.p.reportFailure).toHaveBeenCalledWith(failure);
  });
  it('reports a current activation failure before Type was published', async () => {
    const h = setup(); const failure = new Error('activation failed');
    h.p.activateType = async () => { throw failure; };
    const entry = h.owner.selectAndEnter(h.layer.id); h.selection.resolve(); await entry;
    expect(h.p.reportFailure).toHaveBeenCalledWith(failure);
  });
});
