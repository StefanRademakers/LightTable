import type { LayerId } from '../../document/documentTypes';

export type SampledBrushToolId = 'clone-stamp' | 'healing-brush';
export type SampledBrushOperator = 'clone' | 'healing';
export type SampledBrushMode = 'current' | 'current-and-below' | 'all';

export interface SampledBrushSettings {
  readonly aligned: boolean;
  readonly sampleMode: SampledBrushMode;
}

export interface SampledBrushSource {
  readonly documentId: string;
  readonly anchorLayerId: LayerId;
  readonly point: { readonly x: number; readonly y: number };
}

export interface SampledBrushStrokePlan {
  readonly operator: SampledBrushOperator;
  readonly source: SampledBrushSource;
  readonly sampleMode: SampledBrushMode;
  /** Added to a destination document point to resolve its source point. */
  readonly sourceOffset: { readonly x: number; readonly y: number };
}

export const isSampledBrushTool = (tool: string): tool is SampledBrushToolId =>
  tool === 'clone-stamp' || tool === 'healing-brush';

export const sampledBrushOperatorFor = (
  tool: SampledBrushToolId
): SampledBrushOperator => tool === 'clone-stamp' ? 'clone' : 'healing';
