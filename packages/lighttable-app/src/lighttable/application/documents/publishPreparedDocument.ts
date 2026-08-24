import type { ReferenceDifferenceMetrics } from '../rendering/rendererTypes';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from '../../editor/psd/psdDocumentAdapter';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { BasicAdjustments, LightTableImageMetadata } from '../../types';
import type { PreparedDocumentSource } from './prepareDocumentSource';
import type {
  FontAssetBlob,
  PreservedSourceAssetBlob
} from '../../editor/persistence/layeredDocumentFormat';

export interface PreparedDocumentPublicationPorts {
  /** Batches external application-store notifications for this sync commit. */
  commitPublication?(publish: () => void): void;
  mergeStartupTimings(
    timings: PreparedDocumentSource['loaded']['timings']
  ): void;
  publishDocument(document: ImageDocument): void;
  publishMetadata(metadata: LightTableImageMetadata): void;
  publishPsdImport(info: PsdDecodeSuccess | null): void;
  publishPsdCompatibility(
    entries: readonly PsdImportCompatibilityEntry[]
  ): void;
  publishPsdDifference(
    metrics: ReferenceDifferenceMetrics | null
  ): void;
  publishSource(name: string, blob: Blob, identity: string): void;
  resetDocumentInteraction(): void;
  publishAdjustments(adjustments: BasicAdjustments): void;
  publishStatus(status: string | null): void;
  reportDifferenceFailure(error: unknown): void;
  reportPsdWarnings(warnings: readonly string[]): void;
  publishBinaryAssets?(
    fontAssets: readonly FontAssetBlob[],
    preservedSourceAssets: readonly PreservedSourceAssetBlob[]
  ): void;
}

/**
 * Publishes a fully prepared source as one synchronous presentation commit.
 *
 * Cancellation must be checked immediately before this function. No async
 * boundary exists inside publication, so React cannot observe a canonical
 * document without its matching assets, grade, source identity and metadata.
 */
export const publishPreparedDocument = (
  prepared: PreparedDocumentSource,
  source: {
    readonly name: string;
    readonly identity: string;
  },
  ports: PreparedDocumentPublicationPorts
): void => {
  const { loaded, hydration } = prepared;
  const {
    document,
    metadata,
    imageBlob,
    psdImport,
    psdWarnings,
    psdCompatibility,
    timings
  } = loaded;

  const publish = () => {
    ports.mergeStartupTimings(timings);
    ports.publishDocument(document);
    ports.publishMetadata(metadata);
    ports.publishPsdImport(psdImport
      ? { ...psdImport, warnings: [...psdWarnings] }
      : psdImport);
    ports.publishPsdCompatibility([...psdCompatibility]);
    ports.publishPsdDifference(null);
    ports.publishSource(source.name, imageBlob, source.identity);
    ports.publishBinaryAssets?.(loaded.fontAssets, loaded.preservedSourceAssets);
    ports.resetDocumentInteraction();
    ports.publishAdjustments(hydration.adjustments);

    if (!psdImport) return;
    ports.publishPsdDifference(hydration.psdDifferenceMetrics);
    ports.publishStatus(hydration.status);
    if (hydration.differenceError) {
      ports.reportDifferenceFailure(hydration.differenceError);
    }
    if (psdWarnings.length) ports.reportPsdWarnings(psdWarnings);
  };
  if (ports.commitPublication) ports.commitPublication(publish);
  else publish();
};
