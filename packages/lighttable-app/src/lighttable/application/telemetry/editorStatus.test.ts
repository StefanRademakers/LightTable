import { describe, expect, it } from 'vitest';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import { buildEditorStatus } from './editorStatus';

const photoshopImport = {
  kind: 'decoded-psd',
  requestId: 1,
  preview: new Blob(),
  width: 1920,
  height: 1080,
  bitsPerChannel: 8,
  colorMode: 'RGB',
  inventory: {
    layers: 5,
    groups: 1,
    rasterPreviews: 4,
    masks: 2,
    layerStyles: 3,
    adjustments: 1,
    textLayers: 1,
    smartObjects: 1,
    vectorLayers: 0,
    maximumDepth: 2
  },
  layers: [],
  patterns: [],
  warnings: ['Unsupported example payload.']
} as PsdDecodeSuccess;

describe('buildEditorStatus', () => {
  it('formats precision, scale, readiness and owned GPU memory', () => {
    const status = buildEditorStatus({
      metadata: {
        name: 'flowers.tiff',
        width: 960,
        height: 640,
        contentType: 'image/tiff',
        decoder: 'wasm-vips',
        sourceBitDepth: 16,
        sourceFormat: 'ushort',
        sourceProfile: 'embedded ICC -> sRGB',
        decodeDurationMs: 103
      },
      scale: 0.88,
      startupTimings: { firstFrameMs: 592 },
      gpuMemoryBytes: 128 * 1024 * 1024,
      photoshopImport: null,
      photoshopCompatibilitySummary: '',
      referenceDifference: null,
      reportAvailable: false
    });

    expect(status.meta).toBe(
      '960 × 640 · 88% · 16-bit ushort · embedded ICC -> sRGB · wasm-vips · 103 ms · ready 592 ms · GPU ~128 MB'
    );
    expect(status.title).toContain('first frame: 592 ms');
    expect(status.title).toContain('GPU memory is an estimate');
    expect(status.reportAvailable).toBe(false);
  });

  it('describes reconstructed Photoshop semantics and comparison metrics', () => {
    const status = buildEditorStatus({
      metadata: {
        name: 'parity.psd',
        width: 1920,
        height: 1080,
        contentType: 'image/vnd.adobe.photoshop',
        decoder: 'ag-psd',
        sourceBitDepth: 8,
        sourceFormat: 'PSD',
        sourceInterpretation: 'RGB'
      },
      scale: 1,
      startupTimings: null,
      gpuMemoryBytes: 0,
      photoshopImport,
      photoshopCompatibilitySummary: '9 native; 1 preview-backed',
      referenceDifference: {
        threshold: 2 / 255,
        differingPixels: 5,
        differingPixelPercentage: 0.125,
        meanAbsoluteRgbError: 0.00125,
        maximumChannelError: 0.02,
        meanAbsoluteAlphaError: 0,
        maximumAlphaError: 0,
        sampledPixels: 4000,
        stride: 2
      },
      reportAvailable: true
    });

    expect(status.meta).toContain('8-bit PSD · RGB · Photoshop composite');
    expect(status.title).toContain('5 layers; 1 groups; 2 masks');
    expect(status.title).toContain('Semantic import support: 9 native; 1 preview-backed.');
    expect(status.title).toContain('0.125% above 2/255');
    expect(status.title).toContain('Unsupported example payload.');
    expect(status.reportAvailable).toBe(true);
  });

  it('has an explicit empty-document model', () => {
    expect(buildEditorStatus({
      metadata: null,
      scale: 1,
      startupTimings: null,
      gpuMemoryBytes: 0,
      photoshopImport: null,
      photoshopCompatibilitySummary: '',
      referenceDifference: null,
      reportAvailable: false
    })).toEqual({
      meta: 'No image',
      title: undefined,
      reportAvailable: false
    });
  });
});
