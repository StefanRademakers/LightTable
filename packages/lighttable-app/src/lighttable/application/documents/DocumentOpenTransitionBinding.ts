import type { DocumentProcessingBinding } from '../adjustments/DocumentProcessingBinding';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import type { DocumentInteractionResetPolicy } from './DocumentInteractionResetPolicy';
import type { DocumentLoadedSourceBinding } from './DocumentLoadedSourceBinding';
import {
  resetDocumentOpenPresentation,
  type DocumentOpenPresentationResetPort
} from './resetDocumentOpenPresentation';
import type { PreparedDocumentPublicationPorts } from './publishPreparedDocument';

type ProcessingTransitionPort = Pick<DocumentProcessingBinding,
  'prepareNewSource' | 'stageOpeningVisibility' | 'retireOpening'
  | 'publishLoadedProcessing' | 'presentExisting'>;

type LoadedSourceTransitionPort = Pick<DocumentLoadedSourceBinding,
  'resetPresentation' | 'presentExisting'>;

export type DocumentOpenPublicationPresentationPort = Omit<
  PreparedDocumentPublicationPorts,
  'resetDocumentInteraction' | 'publishAdjustments'
> & {
  resetPublishedInteraction(): void;
};

export interface DocumentOpenTransitionBindingOptions {
  readonly generation: object;
  readonly initialAdjustments?: BasicAdjustments;
  readonly initialGlobalGradeStrength: number;
  readonly sourceName: string;
  readonly processing: ProcessingTransitionPort;
  readonly interactions: Pick<DocumentInteractionResetPolicy,
    'prepareNewSource' | 'initializeNewSelection' | 'initializeLensBlur'
    | 'sourcePublished' | 'rebindExisting'>;
  readonly loadedSource: LoadedSourceTransitionPort;
  readonly resetPresentation: Omit<DocumentOpenPresentationResetPort,
    'resetSource' | 'resetSelection' | 'resetLensBlur'
    | 'publishGroupVisibility'>;
  readonly publication: DocumentOpenPublicationPresentationPort;
  readonly resetFontsForOpen: () => void;
  readonly getExistingDocument: () => ImageDocument | null;
  readonly getPropertiesTarget: () => PropertiesInspectorTarget;
  readonly publishExistingDocument: (document: ImageDocument) => void;
  readonly clearRebindStatus: () => void;
  readonly cancelAutoAlign: () => void;
}

/**
 * Owns new-source, existing-document rebind and close ordering for one mounted
 * document generation. Domain participants keep their own state and algorithms;
 * this binding is the sole cross-system document-transition workflow.
 */
export class DocumentOpenTransitionBinding {
  readonly publicationPorts: PreparedDocumentPublicationPorts;

  constructor(private readonly options: DocumentOpenTransitionBindingOptions) {
    this.publicationPorts = {
      ...options.publication,
      resetDocumentInteraction: () => {
        options.interactions.sourcePublished();
        options.publication.resetPublishedInteraction();
      },
      publishAdjustments: adjustments => {
        options.processing.publishLoadedProcessing(options.generation, adjustments);
      }
    };
  }

  readonly beforeOpen = (): void => {
    const options = this.options;
    options.processing.prepareNewSource(
      options.generation,
      options.initialGlobalGradeStrength
    );
    options.interactions.prepareNewSource();
    options.resetFontsForOpen();
    resetDocumentOpenPresentation({
      initialAdjustments: options.initialAdjustments,
      port: {
        ...options.resetPresentation,
        resetSource: () => options.loadedSource.resetPresentation(options.sourceName),
        resetSelection: options.interactions.initializeNewSelection,
        resetLensBlur: options.interactions.initializeLensBlur,
        publishAdjustments: options.resetPresentation.publishAdjustments,
        publishGroupVisibility: visibility => {
          options.processing.stageOpeningVisibility(options.generation, visibility);
        }
      }
    });
  };

  readonly beforeExistingRebind = (): void => {
    const document = this.options.getExistingDocument();
    if (!document) return;
    this.options.interactions.rebindExisting();
    this.options.clearRebindStatus();
    this.options.loadedSource.presentExisting();
    this.options.processing.presentExisting(
      this.options.generation,
      document,
      this.options.getPropertiesTarget()
    );
    this.options.publishExistingDocument(document);
  };

  readonly afterClose = (): void => {
    this.options.processing.retireOpening(this.options.generation);
    this.options.cancelAutoAlign();
  };
}
