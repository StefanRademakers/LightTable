import { describe, expect, it } from 'vitest';
import {
  createDefaultAdjustments
} from '../../types';
import {
  createImageDocument,
  createLayerId
} from '../../editor/document/documentTypes';
import {
  createAdjustmentLayer,
  setRasterLayerAdjustmentStack
} from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  adjustmentStackForOwner,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import { projectAdjustmentSnapshot } from './projectAdjustmentSnapshot';
import {
  addWarpNodeToStack,
  createDefaultWarpNodeSettings,
  createWarpModuleInstance,
  findWarpModuleInstance,
  readWarpNodeSettings
} from '../../effects/warp/warpTypes';

describe('adjustment snapshot projection', () => {
  it('rejects an adjustment when no explicit layer target is selected', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    const snapshot = {
      ...createDefaultAdjustments(),
      exposureEV: 1.5
    };
    expect(() => projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: null,
      document,
      documentAdjustments: createDefaultAdjustments()
    })).toThrow('Select a raster layer or Grade Layer');
  });

  it('stores Grade and Lens Fx on the raster owner and clears hidden document effects', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    const rasterId = document.activeLayerId;
    if (!rasterId) throw new Error('Expected an active raster layer.');
    const documentAdjustments = createDefaultAdjustments();
    documentAdjustments.effects.grain.enabled = true;
    const snapshot = {
      ...structuredClone(documentAdjustments),
      exposureEV: 1.5
    };
    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: rasterId,
      document,
      documentAdjustments
    });
    expect(result.scope).toBe('layer');
    expect(result.documentAdjustments.exposureEV).toBe(0);
    expect(result.documentAdjustments.effects.grain.enabled).toBe(false);
    const projected = result.document
      ? findDocumentLayer(result.document, rasterId)
      : null;
    expect(projected?.type).toBe('raster');
    if (projected?.type !== 'raster') return;
    expect(projected.adjustmentStack?.modules.some((module) => (
      module.type === 'lt.light' && module.settings.exposureEV === 1.5
    ))).toBe(true);
    expect(projected.adjustmentStack?.modules.some((module) => (
      module.type === 'lt.grain'
    ))).toBe(true);
  });

  it('keeps an authored pixel-layer warp intact when its grade changes', () => {
    const base = createImageDocument('Image', 64, 48, 'image');
    const rasterId = base.activeLayerId!;
    const warpSettings = {
      ...createDefaultWarpNodeSettings(),
      strokes: [{
        id: 'stroke-1',
        mode: 'push' as const,
        settings: {
          diameterPx: 24,
          hardness: 0.5,
          strength: 0.75,
          flow: 1,
          spacing: 0.2,
          pressureSize: true,
          pressureStrength: true
        },
        samples: [{
          positionPx: [12, 18] as const,
          deltaPx: [4, -2] as const,
          pressure: 1,
          tilt: [0, 0] as const,
          timeMs: 10
        }],
        startedAtMs: 10,
        durationMs: 16
      }]
    };
    const warp = createWarpModuleInstance('warp-1', warpSettings);
    const warpedStack = addWarpNodeToStack(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      warp
    );
    const document = setRasterLayerAdjustmentStack(base, rasterId, warpedStack);
    const snapshot = createDefaultAdjustments();
    snapshot.exposureEV = 1.25;

    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: rasterId,
      document,
      documentAdjustments: createDefaultAdjustments()
    });
    const projected = result.document
      ? findDocumentLayer(result.document, rasterId)
      : null;
    if (projected?.type !== 'raster') throw new Error('Expected raster projection.');

    const preservedWarp = findWarpModuleInstance(projected.adjustmentStack);
    expect(preservedWarp).toMatchObject({ id: warp.id, revision: warp.revision });
    expect(readWarpNodeSettings(preservedWarp!)).toEqual(warpSettings);
    expect(projected.adjustmentStack?.modules[0]?.type).toBe('lt.warp');
    expect(projected.adjustmentStack?.modules.some((module) =>
      module.type === 'lt.light' && module.settings.exposureEV === 1.25
    )).toBe(true);
  });

  it('updates one Grade Layer without manufacturing Lens Fx modules', () => {
    const base = createImageDocument('Image', 64, 48, 'image');
    const document = createAdjustmentLayer(
      base,
      adjustmentStackForOwner(
        createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
        'grade'
      ),
      'Grade'
    );
    const adjustmentId = document.activeLayerId;
    if (!adjustmentId) throw new Error('Expected an active Adjustment Layer.');
    const documentAdjustments = createDefaultAdjustments();
    documentAdjustments.effects.grain.enabled = true;
    documentAdjustments.effects.grain.amount = 1.55;
    const snapshot = { ...createDefaultAdjustments(), contrast: 35 };
    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: adjustmentId,
      document,
      documentAdjustments
    });
    expect(result.scope).toBe('adjustment-layer');
    expect(result.documentAdjustments.effects.grain.enabled).toBe(false);
    expect(result.documentAdjustments.contrast).toBe(0);
    if (!result.document) throw new Error('Expected a projected document.');
    const projected = findDocumentLayer(result.document, adjustmentId);
    expect(projected?.type).toBe('adjustment');
    if (projected?.type !== 'adjustment') return;
    expect(projected.adjustmentStack.modules.some((module) => (
      module.type === 'lt.light' && module.settings.contrast === 35
    ))).toBe(true);
    expect(projected.adjustmentStack.modules.some((module) => (
      module.type === 'lt.grain'
    ))).toBe(false);
  });

  it('stores Lens Fx without manufacturing a neutral Grade owner', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    const rasterId = document.activeLayerId!;
    const snapshot = createDefaultAdjustments();
    snapshot.effects.lensDistortion.enabled = true;
    snapshot.effects.lensDistortion.amount = -24;

    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: rasterId,
      document,
      documentAdjustments: createDefaultAdjustments()
    });
    const projected = result.document
      ? findDocumentLayer(result.document, rasterId)
      : null;
    if (projected?.type !== 'raster') throw new Error('Expected raster projection.');

    expect(projected.adjustmentStack?.modules.some((module) =>
      module.type === 'lt.lens-distortion'
      && module.settings['effects.lensDistortion']
    )).toBe(true);
    expect(projected.adjustmentStack?.modules.some((module) =>
      module.type === 'lt.light'
    )).toBe(false);
  });

  it('adds Lens Fx to an existing Grade owner without dropping either category', () => {
    const base = createImageDocument('Image', 64, 48, 'image');
    const rasterId = base.activeLayerId!;
    const gradeSnapshot = createDefaultAdjustments();
    gradeSnapshot.exposureEV = 0.75;
    const graded = projectAdjustmentSnapshot({
      snapshot: gradeSnapshot,
      targetLayerId: rasterId,
      document: base,
      documentAdjustments: createDefaultAdjustments()
    }).document;
    if (!graded) throw new Error('Expected a graded document.');

    const combinedSnapshot = structuredClone(gradeSnapshot);
    combinedSnapshot.effects.lensDistortion.enabled = true;
    combinedSnapshot.effects.lensDistortion.amount = 18;
    const combined = projectAdjustmentSnapshot({
      snapshot: combinedSnapshot,
      targetLayerId: rasterId,
      document: graded,
      documentAdjustments: createDefaultAdjustments()
    }).document;
    const projected = combined ? findDocumentLayer(combined, rasterId) : null;
    if (projected?.type !== 'raster') throw new Error('Expected raster projection.');

    expect(projected.adjustmentStack?.modules.some((module) =>
      module.type === 'lt.light' && module.settings.exposureEV === 0.75
    )).toBe(true);
    expect(projected.adjustmentStack?.modules.some((module) =>
      module.type === 'lt.lens-distortion'
    )).toBe(true);
  });

  it('rejects a stale grade owner identity', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    expect(() => projectAdjustmentSnapshot({
      snapshot: createDefaultAdjustments(),
      targetLayerId: createLayerId(),
      document,
      documentAdjustments: createDefaultAdjustments()
    })).toThrow('cannot own a grade');
  });
});
