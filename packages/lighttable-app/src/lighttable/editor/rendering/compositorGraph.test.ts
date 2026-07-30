import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  type RasterLayer
} from '../document/documentTypes';
import { createDefaultLayerStyle } from '../styles/layerStyleDefaults';
import {
  buildCompositorSequence,
  collectVisibleLeafNodes,
  containsActiveLayerStyles,
  groupNeedsCompositingEnvelope
} from './compositorGraph';

const raster = (name: string): RasterLayer => {
  const document = createImageDocument(name, 64, 64, name);
  return { ...(document.layers[0] as RasterLayer), name };
};

describe('compositorGraph', () => {
  it('builds contiguous clipping chains and rejects orphaned clips', () => {
    const orphan = { ...raster('orphan'), clipping: true };
    const base = raster('base');
    const firstClip = { ...raster('first clip'), clipping: true };
    const secondClip = { ...raster('second clip'), clipping: true };
    const nextBase = raster('next base');

    const entries = buildCompositorSequence([
      orphan,
      base,
      firstClip,
      secondClip,
      nextBase
    ]);

    expect(entries.map((entry) => ({
      skip: entry.skipBecauseClippingBaseMissing,
      use: entry.usesClippingBase,
      capture: entry.captureClippingBase
    }))).toEqual([
      { skip: true, use: false, capture: false },
      { skip: false, use: false, capture: true },
      { skip: false, use: true, capture: false },
      { skip: false, use: true, capture: false },
      { skip: false, use: false, capture: false }
    ]);
  });

  it('collects only visible leaves while preserving bottom-first order', () => {
    const hidden = { ...raster('hidden'), visible: false };
    const group = createGroupLayer('group');
    group.children = [raster('inside'), hidden];
    const leaves = collectVisibleLeafNodes([raster('bottom'), group]);
    expect(leaves.map(({ name }) => name)).toEqual(['bottom', 'inside']);
  });

  it('detects nested styles and group envelope requirements', () => {
    const child = raster('styled');
    child.styleStack.effects.push(createDefaultLayerStyle('drop-shadow'));
    const group = createGroupLayer('group');
    group.children = [child];

    expect(containsActiveLayerStyles([group])).toBe(true);
    expect(groupNeedsCompositingEnvelope(group, false)).toBe(false);
    group.opacity = 0.5;
    expect(groupNeedsCompositingEnvelope(group, false)).toBe(true);
  });

  it('requires an envelope only when an enabled group mask has a runtime texture', () => {
    const group = createGroupLayer('masked');
    group.mask = {
      id: 'mask',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    expect(groupNeedsCompositingEnvelope(group, false)).toBe(false);
    expect(groupNeedsCompositingEnvelope(group, true)).toBe(true);
  });
});
