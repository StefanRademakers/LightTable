import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';

export type WorkspaceDocumentKind = 'image' | 'video' | 'model-3d';

export type WorkspaceSurface =
  | { readonly kind: 'launcher' }
  | { readonly kind: 'project-home'; readonly projectId: string }
  | { readonly kind: 'document-loading'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'image-document'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'video-document'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'model-3d-document'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'document-error'; readonly documentId: DocumentSessionId };

export type WorkspaceDocumentLifecycle = 'opening' | 'ready' | 'failed' | 'closing' | 'disposed';

export const resolveWorkspaceSurface = ({
  projectId,
  activeDocumentId,
  lifecycle,
  documentKind = 'image'
}: {
  readonly projectId: string | null;
  readonly activeDocumentId: DocumentSessionId | null;
  readonly lifecycle: WorkspaceDocumentLifecycle | null;
  readonly documentKind?: WorkspaceDocumentKind;
}): WorkspaceSurface => {
  if (!activeDocumentId) {
    return projectId ? { kind: 'project-home', projectId } : { kind: 'launcher' };
  }
  if (lifecycle === 'failed') return { kind: 'document-error', documentId: activeDocumentId };
  if (lifecycle !== 'ready') return { kind: 'document-loading', documentId: activeDocumentId };
  if (documentKind === 'video') return { kind: 'video-document', documentId: activeDocumentId };
  if (documentKind === 'model-3d') return { kind: 'model-3d-document', documentId: activeDocumentId };
  return { kind: 'image-document', documentId: activeDocumentId };
};

export type WorkspaceCommandScope =
  | 'application'
  | 'project'
  | 'project-assets'
  | 'document'
  | 'image-canvas'
  | 'layer-stack'
  | 'editable-pixels'
  | 'vector-editing'
  | 'text-editing'
  | 'selection'
  | 'media-view'
  | 'media-playback'
  | 'model-view';

const surfaceScopes: Record<WorkspaceSurface['kind'], ReadonlySet<WorkspaceCommandScope>> = {
  launcher: new Set(['application']),
  'project-home': new Set(['application', 'project', 'project-assets']),
  'document-loading': new Set(['application', 'project', 'project-assets', 'document']),
  'document-error': new Set(['application', 'project', 'project-assets', 'document']),
  'image-document': new Set([
    'application', 'project', 'project-assets', 'document', 'image-canvas', 'layer-stack',
    'editable-pixels', 'vector-editing', 'text-editing', 'selection'
  ]),
  'video-document': new Set([
    'application', 'project', 'project-assets', 'document', 'media-view', 'media-playback'
  ]),
  'model-3d-document': new Set([
    'application', 'project', 'project-assets', 'document', 'model-view'
  ])
};

export const workspaceSurfaceCan = (
  surface: WorkspaceSurface,
  scope: WorkspaceCommandScope
): boolean => surfaceScopes[surface.kind].has(scope);
