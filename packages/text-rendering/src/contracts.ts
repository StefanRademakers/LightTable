export type TextRendererCandidate = 'coverage-atlas' | 'hb-gpu';

export const TEXT_RENDERER_BAKEOFF_LIMITS = Object.freeze({
  maximumGlyphs: 512,
  maximumGlyphDimension: 256,
  maximumAtlasDimension: 2048,
  maximumAtlasBytes: 4 * 1024 * 1024,
  maximumHbGpuTexelsPerGlyph: 65_536,
  maximumHbGpuBytes: 8 * 1024 * 1024,
  maximumDrawBatches: 64
});

export interface CoverageGlyphMask {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
  readonly pixels: Uint8Array;
}

export interface CoverageAtlasEntry {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
}

export interface PackedCoverageAtlas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly entries: readonly CoverageAtlasEntry[];
  readonly occupiedBytes: number;
}

export interface RendererBakeoffMeasurement {
  readonly candidate: TextRendererCandidate;
  readonly scenarioId: string;
  readonly coldPreparationMs: number;
  readonly warmFrameMs: number;
  readonly uploadBytes: number;
  readonly estimatedVramBytes: number;
  readonly drawBatches: number;
  readonly meanAbsoluteError: number;
  readonly maximumAbsoluteError: number;
  readonly shaderValidated: boolean;
  readonly captureHash?: string;
  readonly adapterName?: string;
  readonly error?: string;
}

export interface RendererBakeoffDecision {
  readonly coverageAtlas: 'GO' | 'CONDITIONAL GO' | 'NO-GO';
  readonly hbGpu: 'GO' | 'CONDITIONAL GO' | 'NO-GO';
  readonly productionDefault: TextRendererCandidate;
  readonly reasons: readonly string[];
}

export class TextRendererResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextRendererResourceLimitError';
  }
}
