import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { createMountedLayerCommandBinding } from './createMountedLayerCommandBinding';
import type { MountedLayerCommandPorts } from './MountedLayerCommandAdapter';

const fixture = () => {
  const workspace = new WorkspaceSession({ createId: () => 'registered-document' as never });
  const opened = workspace.open({ source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Fixture failed to open');
  const session = opened.value;
  session.setDocument(createImageDocument('Image', 10, 10, 'source')); session.setReady();
  let currentSession = session;
  let renderer: object | null = {};
  let generation = 0;
  const lifecycle = {};
  const ports: Omit<MountedLayerCommandPorts, 'assertCurrent'> = {
    panel: {
      createGroup: vi.fn(() => 'created-group' as never), createGradientFillLayer: vi.fn(() => null),
      groupSelection: vi.fn(() => null), deleteSelection: vi.fn(), move: vi.fn(),
      setOpacity: vi.fn(), setVectorAntiAlias: vi.fn(), setBlendMode: vi.fn(), setClipping: vi.fn(),
      reorder: vi.fn(), ungroupSelection: vi.fn(), setLock: vi.fn()
    },
    pixels: {
      duplicateLayer: vi.fn(() => null), layerViaCopy: vi.fn(() => null), addLayerMask: vi.fn(() => true),
      invertLayerColors: vi.fn(() => true), applyLayerMask: vi.fn(() => true), removeLayerMask: vi.fn(() => true)
    },
    mutations: { change: vi.fn(() => true) }, settlePixels: vi.fn(async () => undefined),
    waitForPresentation: vi.fn(async () => undefined), loadMaskAsSelection: vi.fn(async () => true)
  };
  const captureRendererScope = vi.fn(() => captureInteractionScope({
    getWorkspaceId: () => currentSession.id, getRenderer: () => renderer,
    getLifecycleIdentity: () => lifecycle, getRendererGeneration: () => generation
  }));
  const execute = createMountedLayerCommandBinding(session, renderer, {
    getCurrentSession: () => currentSession, getCurrentRenderer: () => renderer, captureRendererScope
  }, ports);
  return { workspace, session, ports, execute, captureRendererScope,
    replaceSession: (next: typeof session) => { currentSession = next; },
    replaceRenderer: () => { renderer = {}; },
    retireGeneration: () => { generation++; }
  };
};

describe('registered mounted layer command scope', () => {
  it('captures renderer generation at request, not at registration', async () => {
    const f = fixture(); expect(f.captureRendererScope).not.toHaveBeenCalled();
    f.retireGeneration();
    await expect(f.execute({ kind: 'create-group' })).resolves.toEqual({ layerId: 'created-group' });
    expect(f.captureRendererScope).toHaveBeenCalledTimes(1); f.workspace.dispose();
  });

  it('rejects retained ports after exact session replacement, including the same public ID', async () => {
    const f = fixture(); const replacement = fixture();
    expect(replacement.session.id).toBe(f.session.id);
    f.replaceSession(replacement.session);
    await expect(f.execute({ kind: 'create-group' })).rejects.toThrow('retired');
    expect(f.ports.panel.createGroup).not.toHaveBeenCalled();
    f.workspace.dispose(); replacement.workspace.dispose();
  });

  it('rejects disposed sessions before mounted ref cleanup', async () => {
    const f = fixture(); f.session.dispose();
    await expect(f.execute({ kind: 'create-group' })).rejects.toThrow('retired');
    expect(f.ports.panel.createGroup).not.toHaveBeenCalled(); f.workspace.dispose();
  });

  it('does not let a retained port acquire a replacement renderer', async () => {
    const f = fixture(); f.replaceRenderer();
    await expect(f.execute({ kind: 'create-group' })).rejects.toThrow('retired');
    expect(f.ports.panel.createGroup).not.toHaveBeenCalled(); f.workspace.dispose();
  });

  it('rejects renderer generation retirement during settlement before copying pixels', async () => {
    const f = fixture();
    vi.mocked(f.ports.settlePixels).mockImplementation(async () => f.retireGeneration());
    await expect(f.execute({ kind: 'copy-to-new-layer', layerId: f.session.getSnapshot().document!.activeLayerId! }))
      .rejects.toThrow('retired');
    expect(f.ports.pixels.layerViaCopy).not.toHaveBeenCalled(); f.workspace.dispose();
  });
});
