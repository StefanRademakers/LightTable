import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  type RasterLayer
} from '../document/documentTypes';
import { createDefaultLayerStyle } from '../styles/layerStyleDefaults';
import {
  analyzeDocumentComposite,
  buildCompositorPlan,
  buildCompositorSequence,
  collectVisibleLeafNodes,
  containsActiveLayerStyles,
  containsVisibleAdjustmentLayer,
  groupNeedsCompositingEnvelope,
  splitActiveProcessingCheckpoint,
  splitTopmostProcessingSuffix
} from './compositorGraph';
import { createAdjustmentLayer } from '../document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';
import { createDefaultAdjustments } from '../../types';

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
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    expect(groupNeedsCompositingEnvelope(group, false)).toBe(false);
    expect(groupNeedsCompositingEnvelope(group, true)).toBe(true);
  });

  it('detects only effective visible Adjustment Layers', () => {
    const adjustment = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade'
    );
    const group = createGroupLayer('group');
    group.children = [adjustment];
    expect(containsVisibleAdjustmentLayer([group])).toBe(true);

    adjustment.opacity = 0;
    expect(containsVisibleAdjustmentLayer([group])).toBe(false);
    adjustment.opacity = 1;
    group.visible = false;
    expect(containsVisibleAdjustmentLayer([group])).toBe(false);
  });

  it('prebuilds nested group and clipping semantics without GPU resources', () => {
    const base = raster('base');
    const clipped = { ...raster('clipped'), clipping: true };
    const group = createGroupLayer('isolated');
    group.compositing = 'isolated';
    group.children = [base, clipped];

    const plan = buildCompositorPlan([group]);
    const groupEntry = plan.entries[0];

    expect(groupEntry.groupNeedsEnvelope).toBe(true);
    expect(groupEntry.children?.entries.map((entry) => ({
      name: entry.node.name,
      use: entry.usesClippingBase,
      capture: entry.captureClippingBase
    }))).toEqual([
      { name: 'base', use: false, capture: true },
      { name: 'clipped', use: true, capture: false }
    ]);
  });

  it('preserves alternating Grade, content and Lens FX order exactly', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const gradeA = createAdjustmentLayer(
      selectAdjustmentLayerModules(base, 'grade'), 'Grade A', 'grade'
    );
    const lensFx = createAdjustmentLayer(
      selectAdjustmentLayerModules(base, 'lens-fx'), 'Lens FX', 'lens-fx'
    );
    const gradeB = createAdjustmentLayer(
      selectAdjustmentLayerModules(base, 'grade'), 'Grade B', 'grade'
    );

    const plan = buildCompositorPlan([
      raster('bottom'), gradeA, raster('middle'), lensFx, gradeB
    ]);

    expect(plan.entries.map(({ node }) => node.name)).toEqual([
      'bottom', 'Grade A', 'middle', 'Lens FX', 'Grade B'
    ]);
  });

  it('keeps processing layers scoped to their authored group', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const group = createGroupLayer('processing group');
    group.children = [
      raster('inside'),
      createAdjustmentLayer(
        selectAdjustmentLayerModules(base, 'lens-fx'), 'Grouped Lens FX', 'lens-fx'
      )
    ];

    const plan = buildCompositorPlan([raster('outside'), group, raster('above')]);

    expect(plan.entries.map(({ node }) => node.name)).toEqual([
      'outside', 'processing group', 'above'
    ]);
    expect(plan.entries[1]?.children?.entries.map(({ node }) => node.name)).toEqual([
      'inside', 'Grouped Lens FX'
    ]);
  });

  it('recognizes only a contiguous unclipped topmost root processing suffix', () => {
    const base = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const lower = raster('lower');
    const grade = createAdjustmentLayer(base, 'Grade', 'grade');
    const lensFx = createAdjustmentLayer(base, 'Lens FX', 'lens-fx');

    expect(splitTopmostProcessingSuffix([lower, grade, lensFx])).toEqual({
      base: [lower], processing: [grade, lensFx]
    });
    expect(splitTopmostProcessingSuffix([lower, grade, raster('above')])).toBeNull();
    expect(splitTopmostProcessingSuffix([lower, { ...grade, clipping: true }])).toBeNull();
  });

  it('places a safe checkpoint below an active midstack processing layer', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const lower = raster('lower');
    const grade = createAdjustmentLayer(stack, 'Grade', 'grade');
    const above = raster('above');

    expect(splitActiveProcessingCheckpoint([lower, grade, above], grade.id)).toEqual({
      base: [lower], remainder: [grade, above]
    });
    expect(splitActiveProcessingCheckpoint(
      [lower, grade, { ...above, clipping: true }], grade.id
    )).toBeNull();
  });

  it('analyzes the fast-path inputs and mask-dependent group envelope once', () => {
    const visible = raster('visible');
    const hidden = { ...raster('hidden'), visible: false };
    const group = createGroupLayer('masked');
    group.mask = {
      id: 'group-mask',
      enabled: true,
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    group.children = [visible, hidden];

    const analysis = analyzeDocumentComposite(
      [group],
      (layerId) => layerId === group.id
    );

    expect(analysis.visibleLeafNodes.map(({ name }) => name)).toEqual(['visible']);
    expect(analysis.visibleRasterLayers).toEqual([visible]);
    expect(analysis.activeLayerStyles).toBe(false);
    expect(analysis.plan.entries[0].groupNeedsEnvelope).toBe(true);
  });
});
