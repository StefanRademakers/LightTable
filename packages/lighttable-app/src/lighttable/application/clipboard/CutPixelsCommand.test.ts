import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { CutPixelsCommand, type CutPixelsDependencies } from './CutPixelsCommand';

const fixture = () => {
  let current = true;
  let document = createImageDocument('cut', 100, 100, 'source');
  let revision = 1;
  const capture = { file: new File(['image'], 'cut.png', { type: 'image/png' }),
    bounds: { x: 1, y: 2, width: 19, height: 8 } };
  const ports: CutPixelsDependencies = {
    captureScope: () => ({ isCurrent: () => current }), settleInteraction: vi.fn(async () => undefined),
    getDocument: () => document,
    getSelection: () => ({ active: true, supportBounds: { x: 1, y: 2, width: 19, height: 8 }, revision }),
    copySelected: vi.fn(async () => capture),
    fill: { apply: vi.fn(() => ({ layerId: document.activeLayerId!, channel: 'pixels' as const })) },
    reportStatus: vi.fn()
  };
  return { ports, capture, owner: new CutPixelsCommand(() => ports),
    change(kind: string) {
      if (kind === 'scope') current = false;
      if (kind === 'document') document = { ...document };
      if (kind === 'selection') revision++;
    } };
};

describe('CutPixelsCommand', () => {
  it('copies then delegates one cut edit to the existing fill owner', async () => {
    const f = fixture();
    expect(await f.owner.execute()).toBe(f.capture);
    expect(f.ports.copySelected).toHaveBeenCalledOnce();
    expect(f.ports.fill.apply).toHaveBeenCalledExactlyOnceWith({
      layerId: f.ports.getDocument()!.activeLayerId, channel: 'pixels', color: '#000000',
      preserveTransparency: false, opacity: 0
    }, { label: 'Cut', type: 'raster.cut' });
    expect(f.ports.reportStatus).toHaveBeenCalledOnce();
  });

  it.each(['scope', 'document', 'selection'])('never clears a changed %s after asynchronous copy', async kind => {
    const f = fixture();
    vi.mocked(f.ports.copySelected).mockImplementation(async () => { f.change(kind); return f.capture; });
    await expect(f.owner.execute()).rejects.toThrow('Pixels were copied but not removed');
    expect(f.ports.fill.apply).not.toHaveBeenCalled();
    expect(f.ports.reportStatus).not.toHaveBeenCalled();
  });

  it('does not fill when copy failed or selection is absent', async () => {
    const f = fixture();
    vi.mocked(f.ports.copySelected).mockResolvedValue(null);
    expect(await f.owner.execute()).toBeNull();
    expect(f.ports.fill.apply).not.toHaveBeenCalled();
    f.ports.getSelection = () => ({ active: false, supportBounds: null, revision: 2 });
    vi.mocked(f.ports.copySelected).mockClear();
    expect(await f.owner.execute()).toBeNull();
    expect(f.ports.copySelected).not.toHaveBeenCalled();
  });

  it('does not confuse fully clipped active coverage with a whole-document cut', async () => {
    const f = fixture();
    f.ports.getSelection = () => ({ active: true, supportBounds: null, revision: 2 });
    await expect(f.owner.execute()).rejects.toThrow('no pixels inside the canvas to cut');
    expect(f.ports.copySelected).not.toHaveBeenCalled();
    expect(f.ports.fill.apply).not.toHaveBeenCalled();
  });
});
