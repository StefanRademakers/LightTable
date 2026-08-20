import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import type { TranslationAlignmentOptions, TranslationAlignmentResult }
  from '../../../editor/autoAlign/alignmentTypes';
import type { SemanticAutoAlignCommand } from '../../commands/semanticAutoAlignCommandContract';

export interface AutoAlignRendererPort {
  alignLayersTranslation(referenceLayerId: LayerId, targetLayerId: LayerId,
    options?: Partial<TranslationAlignmentOptions>, signal?: AbortSignal): Promise<TranslationAlignmentResult>;
  previewTranslationAlignment(result: TranslationAlignmentResult): boolean;
  clearTranslationAlignmentPreview(targetLayerId?: LayerId): boolean;
}

export const autoAlignPreviewMatchesCommand = (
  result: TranslationAlignmentResult | null,
  source: { readonly documentId: string; readonly revision: number } | null,
  document: ImageDocument,
  command: SemanticAutoAlignCommand
) => Boolean(result && source && result.referenceLayerId === command.referenceLayerId
  && result.targetLayerId === command.targetLayerId
  && source.documentId === document.id && source.revision === document.revision);

export const reuseAutoAlignPreview = <Result>(
  result: TranslationAlignmentResult | null,
  source: { readonly documentId: string; readonly revision: number } | null,
  document: ImageDocument,
  command: SemanticAutoAlignCommand,
  commit: (result: TranslationAlignmentResult) => Result
): { readonly reused: false } | { readonly reused: true; readonly value: Result } => (
  result && autoAlignPreviewMatchesCommand(result, source, document, command)
    ? { reused: true, value: commit(result) }
    : { reused: false }
);

export const executeAutoAlignOperation = async <Result>({
  document, renderer, command, signal, getDocument, commit
}: {
  readonly document: ImageDocument;
  readonly renderer: AutoAlignRendererPort;
  readonly command: SemanticAutoAlignCommand;
  readonly signal: AbortSignal;
  readonly getDocument: () => ImageDocument | null;
  readonly commit: (result: TranslationAlignmentResult) => Result;
}): Promise<Result> => {
  if (signal.aborted) throw new DOMException('Auto Align was canceled.', 'AbortError');
  const source = { documentId: document.id, revision: document.revision };
  const result = await renderer.alignLayersTranslation(
    command.referenceLayerId, command.targetLayerId, {}, signal
  );
  if (signal.aborted) throw new DOMException('Auto Align was canceled.', 'AbortError');
  const current = getDocument();
  if (!current || current.id !== source.documentId || current.revision !== source.revision) {
    throw new Error('Auto Align result was discarded because the document changed.');
  }
  return commit(result);
};
