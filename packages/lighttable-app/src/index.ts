import './ui/primitives.css';

export {
  LightTableEditorOverlay,
  type LightTableEditorOverlayProps
} from './lighttable/LightTableEditorOverlay';
export { LightTableStandaloneApp } from './standalone/LightTableStandaloneApp';
export { createBrowserHost } from './platform/LightTableHost';
export {
  WorkspaceSession,
  type CloseDocumentOptions,
  type OpenDocumentOptions,
  type WorkspaceError,
  type WorkspaceSnapshot
} from './lighttable/application/workspace/workspaceSession';
export {
  DocumentSession,
  type DocumentLifecycle,
  type DocumentSessionId,
  type DocumentSessionSnapshot,
  type DocumentSourceDescriptor,
  type DocumentViewport
} from './lighttable/application/documents/documentSession';
export {
  DocumentCommandHistory,
  type DocumentCommandHistoryOptions,
  type DocumentCommandHistorySnapshot,
  type ReversibleDocumentCommand
} from './lighttable/application/commands/documentCommandHistory';
export {
  DocumentTaskRegistry,
  type DocumentTaskContext,
  type DocumentTaskKind,
  type DocumentTaskRegistrySnapshot,
  type DocumentTaskResult,
  type DocumentTaskState
} from './lighttable/application/tasks/documentTaskRegistry';
export {
  copyLightTableGrade,
  readLightTableGrade,
  useLightTableGradeClipboard,
  type LightTableGradeClipboard
} from './lighttable/lightTableGradeClipboard';
export {
  createLightTableRecipe,
  parseLightTableRecipe,
  parseLightTableSettings,
  resolveLightTableEditorSourceKey,
  resolveLightTableRecipe,
  type LightTableRecipe
} from './lighttable/lightTableRecipe';
export { renderLightTableGrade } from './lighttable/renderLightTableGrade';
export { useLightTableRecipe } from './lighttable/useLightTableRecipe';
export type { BasicAdjustments } from './lighttable/types';
export type {
  LightTableHost,
  LightTableMediaBrowser,
  LightTableMediaItem,
  LightTableSaveRequest
} from './platform/LightTableHost';
