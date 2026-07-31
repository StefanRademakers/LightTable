import { describe, expect, it } from 'vitest';
import { estimateDocumentGpuBytes } from './documentGpuMemoryEstimate';

const completeSnapshot = {
  width: 16,
  height: 8,
  sourceBitDepth: 8,
  source: true,
  corrected: true,
  downsample: true,
  blur: true,
  creative: true,
  display: true,
  final: true,
  curveLutBytes: 64,
  adjustmentLayerBytes: 128,
  layerDocumentBytes: 256,
  effectBytes: 512
} as const;

describe('estimateDocumentGpuBytes', () => {
  it('accounts for full-size, quarter-size and owned subsystem textures', () => {
    const fullPixels = 16 * 8;
    const reducedPixels = 4 * 2;
    expect(estimateDocumentGpuBytes(completeSnapshot)).toBe(
      fullPixels * (4 + 8 + 8 + 8 + 4)
      + reducedPixels * (8 + 8)
      + 64 + 128 + 256 + 512
    );
  });

  it('accounts for a high-precision source as rgba16float working storage', () => {
    expect(estimateDocumentGpuBytes({
      ...completeSnapshot,
      sourceBitDepth: 16,
      corrected: false,
      downsample: false,
      blur: false,
      creative: false,
      display: false,
      final: false,
      curveLutBytes: 0,
      adjustmentLayerBytes: 0,
      layerDocumentBytes: 0,
      effectBytes: 0
    })).toBe(16 * 8 * 8);
  });

  it('never subtracts invalid optional resource estimates', () => {
    expect(estimateDocumentGpuBytes({
      ...completeSnapshot,
      width: 0,
      height: 0,
      curveLutBytes: -1,
      adjustmentLayerBytes: -1,
      layerDocumentBytes: -1,
      effectBytes: -1
    })).toBe(0);
  });
});
