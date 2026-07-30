import { LightTableEditorOverlay } from '../lighttable/LightTableEditorOverlay';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type {
  LightTableHost
} from '../platform/LightTableHost';
import { DocumentRuntimeErrorBoundary } from './DocumentRuntimeErrorBoundary';
import type {
  StandaloneWorkspaceDocument
} from './projectStandaloneDocumentWorkspace';
import type {
  StandaloneDecodeMode
} from './standaloneDocumentRuntime';

export interface WorkspaceDocumentTab {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly dirty: boolean;
}

interface StandaloneDocumentRuntimeViewProps {
  readonly document: StandaloneWorkspaceDocument;
  readonly workspaceDocuments: readonly WorkspaceDocumentTab[];
  readonly host: LightTableHost;
  readonly onActivate: (id: DocumentSessionId) => void;
  readonly onClose: (id: DocumentSessionId) => void;
  readonly onRequestOpen?: (decodeMode?: StandaloneDecodeMode) => Promise<void>;
  readonly onOpen: (
    file: File,
    decodeMode?: StandaloneDecodeMode
  ) => unknown;
}

const titleWithoutExtension = (name: string) =>
  name.replace(/\.[^.]+$/, '') || 'Untitled';

/**
 * React composition boundary for exactly one open document runtime.
 *
 * A runtime owns its error containment, application services and host save
 * bridge. The workspace shell only controls ordering and activation.
 */
export function StandaloneDocumentRuntimeView({
  document,
  workspaceDocuments,
  host,
  onActivate,
  onClose,
  onRequestOpen,
  onOpen
}: StandaloneDocumentRuntimeViewProps) {
  const {
    id,
    active,
    runtime: { file, decodeMode },
    session
  } = document;

  return (
    <DocumentRuntimeErrorBoundary
      active={active}
      title={file.name}
      onClose={() => onClose(id)}
      onError={(message) => session.setFailed(message)}
    >
      <LightTableEditorOverlay
        open
        active={active}
        projectId=""
        sourceBlob={file}
        sourceDecodeMode={decodeMode}
        fileNameBase={titleWithoutExtension(file.name)}
        subjectLabel={file.name}
        workspaceDocumentId={id}
        workspaceDocuments={workspaceDocuments}
        history={session.history}
        tasks={session.tasks}
        rendererLifecycle={session.renderer}
        documentSession={session}
        imageClipboard={host.clipboard}
        onActivateWorkspaceDocument={(documentId) => {
          onActivate(documentId as DocumentSessionId);
        }}
        onCloseWorkspaceDocument={(documentId) => {
          onClose(documentId as DocumentSessionId);
        }}
        onRequestOpenWorkspaceDocument={onRequestOpen}
        onOpenWorkspaceDocument={onOpen}
        onDocumentReady={() => {
          if (session.getSnapshot().lifecycle !== 'ready') session.setReady();
        }}
        onDocumentError={(message) => session.setFailed(message)}
        onDirtyChange={(dirty) => {
          if (dirty) {
            session.markChanged();
          } else {
            session.markSaved();
          }
        }}
        onClose={() => onClose(id)}
        onSave={async (output, recipe) => {
          const saved = await host.save({ file: output, recipe });
          if (saved !== false) session.markSaved();
          return saved;
        }}
      />
    </DocumentRuntimeErrorBoundary>
  );
}
