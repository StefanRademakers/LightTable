export interface DocumentSourceLoadRequest {
  readonly projectId: string;
  readonly sourceFileKey: string;
  readonly signal: AbortSignal;
}

export type DocumentSourceLoader = (
  request: DocumentSourceLoadRequest
) => Promise<Blob>;

export interface ResolveDocumentSourceOptions {
  readonly inlineSource: Blob | null;
  readonly projectId: string;
  readonly sourceFileKey: string | null;
  readonly loadSource?: DocumentSourceLoader;
}

/**
 * Resolves one document source without knowing which host supplied it.
 *
 * Inline bytes win because they represent an explicit local open operation.
 * Persistent host handles are resolved only when no inline source exists.
 */
export const resolveDocumentSource = async (
  options: ResolveDocumentSourceOptions,
  signal: AbortSignal
): Promise<Blob> => {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The document open operation was canceled.', 'AbortError');
  }
  if (options.inlineSource) return options.inlineSource;
  if (!options.sourceFileKey) {
    throw new Error('No source image was supplied to LightTable.');
  }
  if (!options.loadSource) {
    throw new Error('The LightTable host cannot read this source image.');
  }
  return options.loadSource({
    projectId: options.projectId,
    sourceFileKey: options.sourceFileKey,
    signal
  });
};
