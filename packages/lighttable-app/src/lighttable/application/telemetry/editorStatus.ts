import type { ReferenceDifferenceMetrics } from '../rendering/rendererTypes';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { LightTableImageMetadata } from '../../types';
import {
  formatGpuMemory,
  formatStartupTimings,
  type LightTableStartupTimings
} from './editorTelemetry';

export interface EditorStatusInput {
  metadata: LightTableImageMetadata | null;
  scale: number;
  startupTimings: LightTableStartupTimings | null;
  gpuMemoryBytes: number;
  photoshopImport: PsdDecodeSuccess | null;
  photoshopCompatibilitySummary: string;
  referenceDifference: ReferenceDifferenceMetrics | null;
  reportAvailable: boolean;
}

export interface EditorStatusModel {
  meta: string;
  title?: string;
  reportAvailable: boolean;
}

const photoshopStatus = (
  source: PsdDecodeSuccess,
  compatibilitySummary: string,
  difference: ReferenceDifferenceMetrics | null
): string => [
  'PSD layers are reconstructed by LightTable; the embedded Photoshop composite is retained only as the in-session Original/reference view and is not duplicated in native saves.',
  `${source.inventory.layers} layers; ${source.inventory.groups} groups; `
    + `${source.inventory.masks} masks; ${source.inventory.layerStyles} styled layers; `
    + `${source.inventory.adjustments} adjustment layers; ${source.inventory.smartObjects} smart objects.`,
  compatibilitySummary ? `Semantic import support: ${compatibilitySummary}.` : '',
  difference
    ? `Reference difference: ${difference.differingPixelPercentage.toFixed(3)}% above `
      + `${Math.round(difference.threshold * 255)}/255; mean RGB error `
      + `${(difference.meanAbsoluteRgbError * 100).toFixed(3)}%; maximum channel error `
      + `${(difference.maximumChannelError * 100).toFixed(2)}%; `
      + `${difference.sampledPixels.toLocaleString()} sampled pixels `
      + `(stride ${difference.stride}).`
    : '',
  ...source.warnings
].filter(Boolean).join('\n');

const imageMeta = (
  metadata: LightTableImageMetadata,
  scale: number,
  startupTimings: LightTableStartupTimings | null,
  gpuMemoryBytes: number
): string => [
  `${metadata.width} × ${metadata.height}`,
  `${Math.round(scale * 100)}%`,
  metadata.decoder === 'wasm-vips'
    ? [
        `${metadata.sourceBitDepth}-bit ${metadata.sourceFormat}`,
        metadata.sourceProfile,
        'wasm-vips',
        `${Math.round(metadata.decodeDurationMs ?? 0)} ms`
      ].filter(Boolean).join(' · ')
    : metadata.decoder === 'ag-psd'
      ? [
          `${metadata.sourceBitDepth}-bit ${metadata.sourceFormat}`,
          metadata.sourceInterpretation,
          'Photoshop composite'
        ].filter(Boolean).join(' · ')
      : null,
  startupTimings?.firstFrameMs !== undefined
    ? `ready ${Math.round(startupTimings.firstFrameMs)} ms`
    : null,
  gpuMemoryBytes > 0 ? `GPU ~${formatGpuMemory(gpuMemoryBytes)}` : null
].filter(Boolean).join(' · ');

export const buildEditorStatus = ({
  metadata,
  scale,
  startupTimings,
  gpuMemoryBytes,
  photoshopImport,
  photoshopCompatibilitySummary,
  referenceDifference,
  reportAvailable
}: EditorStatusInput): EditorStatusModel => {
  const title = [
    formatStartupTimings(startupTimings),
    photoshopImport
      ? photoshopStatus(
          photoshopImport,
          photoshopCompatibilitySummary,
          referenceDifference
        )
      : '',
    gpuMemoryBytes > 0
      ? 'GPU memory is an estimate of LightTable-owned textures; browsers do not expose driver VRAM usage.'
      : ''
  ].filter(Boolean).join('\n') || undefined;

  return {
    meta: metadata
      ? imageMeta(metadata, scale, startupTimings, gpuMemoryBytes)
      : 'No image',
    title,
    reportAvailable
  };
};
