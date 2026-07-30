import type { BasicAdjustments } from '../../types';
import {
  createDocumentOpenResetState,
  type DocumentOpenResetState
} from './createDocumentOpenResetState';

export interface DocumentOpenPresentationResetPort {
  resetTelemetry(): void;
  resetSource(): void;
  resetDocument(): void;
  resetSelection(session: DocumentOpenResetState['editorSession']): void;
  resetLensBlur(): void;
  publishAdjustments(adjustments: DocumentOpenResetState['adjustments']): void;
  resetHistory(): void;
  resetViewport(): void;
  resetScopes(
    settings: DocumentOpenResetState['scopeSettings'],
    visibility: DocumentOpenResetState['scopeVisibility']
  ): void;
  resetDiagnostics(): void;
  publishGroupVisibility(
    visibility: DocumentOpenResetState['groupVisibility']
  ): void;
}

/**
 * Applies the complete presentation reset for a new document-open generation.
 *
 * The application layer owns the ordering. React state, refs, renderer details
 * and telemetry remain behind the supplied semantic port so hosts cannot
 * accidentally perform only a partial reset.
 */
export const resetDocumentOpenPresentation = ({
  initialAdjustments,
  port
}: {
  initialAdjustments?: BasicAdjustments;
  port: DocumentOpenPresentationResetPort;
}): DocumentOpenResetState => {
  const state = createDocumentOpenResetState(initialAdjustments);

  port.resetTelemetry();
  port.resetSource();
  port.resetDocument();
  port.resetSelection(state.editorSession);
  port.resetLensBlur();
  port.publishAdjustments(state.adjustments);
  port.resetHistory();
  port.resetViewport();
  port.resetScopes(state.scopeSettings, state.scopeVisibility);
  port.resetDiagnostics();
  port.publishGroupVisibility(state.groupVisibility);

  return state;
};
