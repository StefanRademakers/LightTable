import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { ClipboardHostIntents, type ClipboardHostContext, type ClipboardHostDependencies } from './ClipboardHostIntents';

const fixture = () => {
  let current = true;
  let context: ClipboardHostContext = {
    document: createImageDocument('test', 200, 100, 'source'),
    selection: { active: false, supportBounds: null, revision: 1 }, channel: 'pixels',
    viewportSize: { width: 200, height: 100 }, imageRect: { x: 0, y: 0, width: 200, height: 100 }
  };
  const blob = new Blob(['pixels'], { type: 'image/png' });
  const prepared = { file: new File([blob], 'image.png', { type: blob.type }), width: 20, height: 10, dispose: vi.fn() };
  const ports = {
    captureScope: () => ({ isCurrent: () => current }), getContext: () => context,
    settleInteraction: vi.fn(async () => undefined),
    clipboard: { readImage: vi.fn<ClipboardHostDependencies['clipboard']['readImage']>(async () => ({ blob, placement: null })) },
    prepareImage: vi.fn(async () => prepared),
    execute: vi.fn<ClipboardHostDependencies['execute']>(async () => ({ status: 'completed' })),
    artifacts: {
      matchingCopy: vi.fn<ClipboardHostDependencies['artifacts']['matchingCopy']>(() => null),
      register: vi.fn(() => ({ id: 'new-artifact' })), release: vi.fn()
    },
    reportError: vi.fn()
  };
  return { ports, prepared, owner: new ClipboardHostIntents(() => ports),
    retire: () => { current = false; },
    update: (change: Partial<ClipboardHostContext>) => { context = { ...context, ...change }; },
    read: () => context };
};

describe('ClipboardHostIntents', () => {
  it('reads the host each time, centers without scaling and transfers completed artifacts for Actions', async () => {
    const f = fixture();
    expect(await f.owner.paste()).toBe(true);
    expect(await f.owner.paste()).toBe(true);
    expect(f.ports.clipboard.readImage).toHaveBeenCalledTimes(2);
    expect(f.ports.execute).toHaveBeenLastCalledWith('selection.pastePixels', {
      artifactId: 'new-artifact', name: 'Pasted Selection',
      bounds: { x: 90, y: 45, width: 20, height: 10 }, target: { channel: 'pixels' }
    });
    expect(f.prepared.dispose).toHaveBeenCalledTimes(2);
    expect(f.ports.artifacts.release).not.toHaveBeenCalled();
  });

  it('uses selection as placement only and captures the mask target', async () => {
    const f = fixture();
    f.update({ channel: 'mask', selection: {
      active: true, supportBounds: { x: 10, y: 10, width: 40, height: 20 }, revision: 2
    } });
    await f.owner.paste();
    expect(f.ports.execute).toHaveBeenCalledWith('selection.pastePixels', expect.objectContaining({
      bounds: { x: 20, y: 15, width: 20, height: 10 },
      target: { channel: 'mask', layerId: f.read().document.activeLayerId }
    }));
  });

  it('does not decode or dispatch after retirement during clipboard read', async () => {
    const f = fixture();
    f.ports.clipboard.readImage.mockImplementation(async () => {
      f.retire(); return { blob: new Blob(['image']), placement: null };
    });
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.prepareImage).not.toHaveBeenCalled();
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(f.ports.reportError).not.toHaveBeenCalled();
  });

  it('disposes a late bitmap without registering an artifact or touching a replacement scope', async () => {
    const f = fixture();
    f.ports.prepareImage.mockImplementation(async () => { f.retire(); return f.prepared; });
    expect(await f.owner.paste()).toBe(false);
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
    expect(f.ports.artifacts.register).not.toHaveBeenCalled();
    expect(f.ports.execute).not.toHaveBeenCalled();
  });

  it.each(['session', 'renderer'] as const)('rejects an exact %s replacement even when document ID stays equal', async kind => {
    const f = fixture();
    const mounted = { session: {}, renderer: {} };
    f.ports.captureScope = () => {
      const { session, renderer } = mounted;
      return { isCurrent: () => mounted.session === session && mounted.renderer === renderer };
    };
    f.ports.prepareImage.mockImplementation(async () => { mounted[kind] = {}; return f.prepared; });
    expect(await f.owner.paste()).toBe(false);
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(f.ports.reportError).not.toHaveBeenCalled();
  });

  it.each(['document', 'selection', 'channel'] as const)('does not silently retarget after %s changes', async kind => {
    const f = fixture();
    f.ports.prepareImage.mockImplementation(async () => {
      if (kind === 'document') f.update({ document: { ...f.read().document } });
      if (kind === 'selection') f.update({ selection: { ...f.read().selection, revision: 2 } });
      if (kind === 'channel') f.update({ channel: 'mask' });
      return f.prepared;
    });
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(f.ports.reportError).toHaveBeenCalledWith(expect.stringContaining('paste target changed'));
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
  });

  it('releases its new artifact on known rejection but never a borrowed copy artifact', async () => {
    const f = fixture();
    f.ports.execute.mockResolvedValue({ status: 'rejected', message: 'Actual failure' });
    await f.owner.paste();
    expect(f.ports.artifacts.release).toHaveBeenCalledWith('new-artifact');
    expect(f.ports.reportError).toHaveBeenCalledWith('Actual failure');
    f.ports.artifacts.release.mockClear();
    f.ports.clipboard.readImage.mockResolvedValue({ blob: new Blob(['image']), placement: {
      sourceDocumentId: 'source', x: 1, y: 2, width: 20, height: 10
    } });
    f.ports.artifacts.matchingCopy.mockReturnValue({ id: 'borrowed' });
    await f.owner.paste();
    expect(f.ports.artifacts.release).not.toHaveBeenCalled();
  });

  it('releases a new artifact when its registration reveals a retired scope', async () => {
    const f = fixture();
    f.ports.artifacts.register.mockImplementation(() => { f.retire(); return { id: 'new-artifact' }; });
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(f.ports.artifacts.release).toHaveBeenCalledWith('new-artifact');
  });

  it('keeps dispatched artifacts on uncertain failure and accepted task ownership', async () => {
    const f = fixture();
    f.ports.execute.mockRejectedValueOnce(new Error('Dispatch interrupted'));
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.reportError).toHaveBeenCalledWith('Dispatch interrupted');
    f.ports.execute.mockResolvedValueOnce({ status: 'accepted' });
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.artifacts.release).not.toHaveBeenCalled();
  });

  it('routes SVG to vector import but SVG mask paste through the image codec', async () => {
    const f = fixture();
    const blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    f.ports.clipboard.readImage.mockResolvedValue({ blob, placement: null });
    await f.owner.paste();
    expect(f.ports.prepareImage).not.toHaveBeenCalled();
    expect(f.ports.execute).toHaveBeenCalledWith('vector.importSvg', {
      svg: '<svg/>', placement: 'document', layerName: 'Pasted SVG'
    });
    f.update({ channel: 'mask' });
    await f.owner.paste();
    expect(f.ports.prepareImage).toHaveBeenCalledWith(blob);
  });

  it('delegates copy/cut/layer-via-copy once to semantic commands', async () => {
    const f = fixture();
    await f.owner.copy('merged'); await f.owner.cut(); await f.owner.layerViaCopy();
    expect(f.ports.execute.mock.calls).toEqual([
      ['selection.copyPixels', { source: 'merged' }], ['selection.cutPixels', {}],
      ['layer.copyToNewLayer', { layerId: f.read().document.activeLayerId }]
    ]);
    expect(f.ports.settleInteraction).not.toHaveBeenCalled();
  });

  it('centers on exact sparse-mask support without requiring any operation provenance', async () => {
    const f = fixture();
    f.update({ selection: { active: true, supportBounds: { x: 140, y: 30, width: 6, height: 4 }, revision: 2 } });
    await f.owner.paste();
    expect(f.ports.execute).toHaveBeenCalledWith('selection.pastePixels', expect.objectContaining({
      bounds: { x: 133, y: 27, width: 20, height: 10 }
    }));
  });

  it('rejects fully clipped active coverage without treating it as no selection', async () => {
    const f = fixture();
    f.update({ selection: { active: true, supportBounds: null, revision: 2 } });
    expect(await f.owner.paste()).toBe(false);
    expect(f.ports.reportError).toHaveBeenCalledWith(expect.stringContaining('no pixels inside the canvas'));
    expect(f.ports.prepareImage).not.toHaveBeenCalled();
    expect(f.ports.execute).not.toHaveBeenCalled();
    expect(f.read().selection.active).toBe(true);
  });
});
