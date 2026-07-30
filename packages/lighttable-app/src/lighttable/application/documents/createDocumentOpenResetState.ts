import {
  createDefaultGroupVisibility,
  type GroupVisibility
} from '../adjustments/groupVisibility';
import {
  createEditorSession,
  type EditorSession
} from '../../editor/session/editorSession';
import {
  DEFAULT_SCOPE_SETTINGS,
  DEFAULT_SCOPE_VISIBILITY,
  type ScopeSettings,
  type ScopeVisibility
} from '../../scopes';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';

export interface DocumentOpenResetState {
  readonly adjustments: BasicAdjustments;
  readonly editorSession: EditorSession;
  readonly scopeSettings: ScopeSettings;
  readonly scopeVisibility: ScopeVisibility;
  readonly groupVisibility: GroupVisibility;
}

/**
 * Creates the complete mutable presentation baseline for one document-open
 * generation. Every returned object is fresh so inactive documents and
 * replacement opens cannot share mutable editor defaults.
 */
export const createDocumentOpenResetState = (
  initialAdjustments?: BasicAdjustments
): DocumentOpenResetState => ({
  adjustments: initialAdjustments
    ? cloneAdjustments(initialAdjustments)
    : createDefaultAdjustments(),
  editorSession: createEditorSession(),
  scopeSettings: { ...DEFAULT_SCOPE_SETTINGS },
  scopeVisibility: { ...DEFAULT_SCOPE_VISIBILITY },
  groupVisibility: createDefaultGroupVisibility()
});
