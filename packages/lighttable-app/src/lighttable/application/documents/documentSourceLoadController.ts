import type { GroupVisibility } from '../adjustments/groupVisibility';
import type { LightTableImageDecodeMode } from '../rendering/rendererTypes';
import type { BasicAdjustments } from '../../types';
import type {
  DocumentHydrationRenderer
} from './hydrateDocumentSource';
import type {
  DocumentSourceRenderer
} from './loadDocumentSource';
import {
  prepareAndPublishDocumentSource
} from './prepareAndPublishDocumentSource';
import type {
  PreparedDocumentPublicationPorts
} from './publishPreparedDocument';

export type DocumentSourceLoadRenderer =
  DocumentSourceRenderer & DocumentHydrationRenderer;

export interface DocumentSourceLoadRequest {
  readonly blob: Blob;
  readonly name: string;
  readonly cacheKey: string;
  readonly sourceIdentity: string;
  readonly decodeMode: LightTableImageDecodeMode;
  readonly initialAdjustments: BasicAdjustments;
  readonly signal?: AbortSignal;
  readonly isCanceled?: () => boolean;
}

export interface DocumentSourceLoadControllerPort {
  getRenderer(): DocumentSourceLoadRenderer | null;
  getGroupVisibility(): GroupVisibility;
  getPublicationPorts(): PreparedDocumentPublicationPorts;
}

export interface DocumentSourceLoadController {
  load(request: DocumentSourceLoadRequest): Promise<boolean>;
}

/**
 * Owns the complete source import transaction for one document runtime.
 *
 * UI composition supplies current renderer and publication ports, but cannot
 * reorder decode, hydration, cancellation and final publication. Missing
 * renderers and superseded generations resolve as a non-publication instead
 * of exposing a partially opened document.
 */
export const createDocumentSourceLoadController = (
  port: DocumentSourceLoadControllerPort
): DocumentSourceLoadController => ({
  async load(request) {
    const renderer = port.getRenderer();
    if (!renderer || request.signal?.aborted || request.isCanceled?.()) {
      return false;
    }

    return prepareAndPublishDocumentSource({
      renderer,
      blob: request.blob,
      name: request.name,
      cacheKey: request.cacheKey,
      sourceIdentity: request.sourceIdentity,
      decodeMode: request.decodeMode,
      initialAdjustments: request.initialAdjustments,
      groupVisibility: port.getGroupVisibility(),
      signal: request.signal,
      isCanceled: request.isCanceled,
      publication: port.getPublicationPorts()
    });
  }
});
