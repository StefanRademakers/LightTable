import type { ImageDocument } from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';
import { materializeAdjustmentPresentationSource, resolveAdjustmentPresentationSource,
  type AdjustmentPresentationSource } from './resolveAdjustmentPresentation';

/** Owns only contextual presentation caching, never canonical adjustments. */
export class AdjustmentPresentationSynchronizer {
  private source: AdjustmentPresentationSource | null = null;
  private documentId: string | null = null;

  constructor(private readonly publish: (next: BasicAdjustments, domain: AdjustmentPresentationDomain) => void) {}

  publishPresentation = (next: BasicAdjustments, domain: AdjustmentPresentationDomain = 'all'): void => {
    this.source = null;
    this.documentId = null;
    this.publish(next, domain);
  };

  synchronize = (document: ImageDocument, adjustments: BasicAdjustments,
    target: PropertiesInspectorTarget, force = false): void => {
    const source = resolveAdjustmentPresentationSource(document, adjustments, target);
    if (!source) return;
    if (!force && this.documentId === document.id && source.key === this.source?.key
      && source.source === this.source.source) return;
    const presentation = materializeAdjustmentPresentationSource(source);
    this.publishPresentation(presentation.adjustments, presentation.domain);
    this.source = source;
    this.documentId = document.id;
  };
}
