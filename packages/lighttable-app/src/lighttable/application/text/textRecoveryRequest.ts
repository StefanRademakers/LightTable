import type { LayerId } from '../../editor/document/documentTypes';

export interface MissingFontRecoveryRequest {
  readonly layerId: LayerId;
  readonly sourceIdentity: string;
  readonly requestedFont: string | null;
  readonly layerName: string;
  readonly metricsChanged: boolean;
  readonly offset?: number;
  readonly affinity?: 'upstream' | 'downstream';
}
