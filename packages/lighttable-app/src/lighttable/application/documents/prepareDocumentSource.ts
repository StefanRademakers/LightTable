import type { GroupVisibility } from '../adjustments/groupVisibility';
import type { DocumentOpenMode } from './documentSourceProbe';
import type { BasicAdjustments } from '../../types';
import type { DocumentCreationSettings } from '../../editor/document/documentTypes';
import {
  hydrateDocumentSource,
  type DocumentHydrationRenderer,
  type HydratedDocumentSource
} from './hydrateDocumentSource';
import {
  loadDocumentSource,
  type DocumentSourceRenderer,
  type LoadedDocumentSource
} from './loadDocumentSource';
import type { DocumentStartupTimeline } from '../telemetry/documentStartupTimeline';
import type { PreparedDocumentOpenSource } from './prepareDocumentOpenSource';

export interface PreparedDocumentSource {
  readonly loaded: LoadedDocumentSource;
  readonly hydration: HydratedDocumentSource;
}

export interface PrepareDocumentSourceRequest {
  readonly renderer: DocumentSourceRenderer & DocumentHydrationRenderer;
  readonly blob: Blob;
  readonly name: string;
  readonly cacheKey: string;
  readonly decodeMode: DocumentOpenMode;
  readonly initialAdjustments: BasicAdjustments;
  readonly creationSettings?: DocumentCreationSettings;
  readonly groupVisibility: GroupVisibility;
  readonly signal?: AbortSignal;
  readonly isCanceled?: () => boolean;
  readonly startupTimeline?: DocumentStartupTimeline | null;
  readonly preparedOpenSource?: PreparedDocumentOpenSource;
}

/**
 * Imports, uploads and hydrates a source as one application transaction.
 *
 * Presentation code receives a result only after the canonical document,
 * assets, grade stack and optional PSD comparison are all ready. This prevents
 * React or either host shell from observing a half-hydrated document.
 */
export const prepareDocumentSource = async (
  request: PrepareDocumentSourceRequest
): Promise<PreparedDocumentSource | null> => {
  const isCanceled = request.isCanceled ?? (() => false);
  const loaded = await loadDocumentSource({
    renderer: request.renderer,
    blob: request.blob,
    name: request.name,
    cacheKey: request.cacheKey,
    decodeMode: request.decodeMode,
    initialAdjustments: request.initialAdjustments,
    creationSettings: request.creationSettings,
    startupTimeline: request.startupTimeline,
    preparedOpenSource: request.preparedOpenSource,
    signal: request.signal,
    isCanceled
  });
  if (!loaded || isCanceled() || request.signal?.aborted) return null;

  const hydration = await hydrateDocumentSource({
    renderer: request.renderer,
    loaded,
    initialAdjustments: request.initialAdjustments,
    groupVisibility: request.groupVisibility,
    isCanceled
  });
  if (!hydration || isCanceled() || request.signal?.aborted) return null;

  return { loaded, hydration };
};
