import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { setLayerTransform } from '../document/documentCommands';
import { findRasterLayer } from '../document/layerTree';
import { rasterRenderContract } from '../rendering/renderContract';
import { translationMatrix } from '../tools/transform/affine';
import {
  alignedTargetTransform,
  alignmentSpaceForContracts,
  chooseBestAlignment,
  chooseBestTranslation,
  intersectRects
} from './alignmentMath';
import { DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS } from './alignmentTypes';

describe('LightTable translation alignment math', () => {
  it('uses the conservative position and uniform-scale model by default', () => {
    expect(DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS.analysisSize).toBe(128);
    expect(DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS.maximumRotationDegrees).toBe(0);
  });

  it('calculates transformed overlap in one document space', () => {
    const base = createImageDocument('Image', 100, 50, 'asset');
    const shifted = setLayerTransform(base, base.layers[0].id, translationMatrix(20, 0));
    const reference = rasterRenderContract(findRasterLayer(base, base.layers[0].id)!, {});
    const target = rasterRenderContract(findRasterLayer(shifted, shifted.layers[0].id)!, {});
    const space = alignmentSpaceForContracts(reference, target, 80);
    expect(space?.documentBounds).toEqual({ x: 20, y: 0, width: 80, height: 50 });
    expect(space?.analysisWidth).toBe(80);
    expect(space?.analysisHeight).toBe(50);
  });

  it('rejects layers without document-space overlap', () => {
    expect(intersectRects(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 5, height: 5 }
    )).toBeNull();
  });

  it('returns the inverse candidate offset as geometry correction', () => {
    const layer = createImageDocument('Image', 10, 10, 'asset').layers[0].id;
    const result = chooseBestTranslation([
      { dx: 0, dy: 0, errorSum: 80, weightSum: 100, validPixelCount: 100 },
      { dx: 3, dy: -2, errorSum: 5, weightSum: 95, validPixelCount: 95 },
      { dx: -5, dy: 4, errorSum: 70, weightSum: 90, validPixelCount: 90 }
    ], 100, layer, layer, 2);
    expect(result?.correctionMatrix).toEqual(translationMatrix(-6, 4));
    expect(result?.confidence).toBeGreaterThan(0.5);
    expect(result?.diagnostics.improvementFromIdentity).toBeGreaterThan(0.9);
  });

  it('composes alignment after existing layer geometry', () => {
    const layer = createImageDocument('Image', 10, 10, 'asset').layers[0].id;
    const result = chooseBestTranslation([
      { dx: 0, dy: 0, errorSum: 20, weightSum: 100, validPixelCount: 100 },
      { dx: 2, dy: 3, errorSum: 1, weightSum: 95, validPixelCount: 95 }
    ], 100, layer, layer, 1);
    expect(result).not.toBeNull();
    expect(alignedTargetTransform(translationMatrix(10, -4), result!)).toEqual(
      translationMatrix(8, -7)
    );
  });

  it('returns the inverse scale, rotation and translation as a similarity correction', () => {
    const layer = createImageDocument('Image', 100, 80, 'asset').layers[0].id;
    const scale = 0.8;
    const rotation = 5 * Math.PI / 180;
    const result = chooseBestAlignment([
      {
        dx: 0,
        dy: 0,
        scale: 1,
        rotation: 0,
        errorSum: 50,
        weightSum: 100,
        validPixelCount: 100
      },
      {
        dx: 4,
        dy: -3,
        scale,
        rotation,
        errorSum: 2,
        weightSum: 90,
        validPixelCount: 90
      },
      {
        dx: -4,
        dy: 3,
        scale: 1.2,
        rotation: -rotation,
        errorSum: 40,
        weightSum: 85,
        validPixelCount: 85
      }
    ], 100, layer, layer, {
      documentBounds: { x: 0, y: 0, width: 100, height: 80 },
      analysisWidth: 100,
      analysisHeight: 80,
      documentPixelsPerAnalysisPixel: 1
    });

    expect(result?.model).toBe('similarity');
    expect(result?.correctionMatrix.a).toBeCloseTo(Math.cos(rotation) / scale, 5);
    expect(result?.correctionMatrix.b).toBeCloseTo(-Math.sin(rotation) / scale, 5);
    expect(result?.correctionMatrix.c).toBeCloseTo(Math.sin(rotation) / scale, 5);
    expect(result?.correctionMatrix.d).toBeCloseTo(Math.cos(rotation) / scale, 5);
    expect(result?.confidence).toBeGreaterThan(0.5);
  });
});
