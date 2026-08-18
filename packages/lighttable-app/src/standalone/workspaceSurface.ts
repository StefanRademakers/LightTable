import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';

export type WorkspaceSurface =
  | { readonly kind: 'launcher' }
  | { readonly kind: 'project-home'; readonly projectId: string }
  | { readonly kind: 'document-loading'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'image-document'; readonly documentId: DocumentSessionId }
  | { readonly kind: 'document-error'; readonly documentId: DocumentSessionId };

export type WorkspaceDocumentLifecycle = 'opening' | 'ready' | 'failed' | 'closing' | 'disposed';

export const resolveWorkspaceSurface = ({
  projectId,
  activeDocumentId,
  lifecycle
}: {
  readonly projectId: string | null;
  readonly activeDocumentId: DocumentSessionId | null;
  readonly lifecycle: WorkspaceDocumentLifecycle | null;
}): WorkspaceSurface => {
  if (!activeDocumentId) {
    return projectId ? { kind: 'project-home', projectId } : { kind: 'launcher' };
  }
  if (lifecycle === 'failed') return { kind: 'document-error', documentId: activeDocumentId };
  if (lifecycle !== 'ready') return { kind: 'document-loading', documentId: activeDocumentId };
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
  | 'selection';

const surfaceScopes: Record<WorkspaceSurface['kind'], ReadonlySet<WorkspaceCommandScope>> = {
  launcher: new Set(['application']),
  'project-home': new Set(['application', 'project', 'project-assets']),
  'document-loading': new Set(['application', 'project', 'project-assets', 'document']),
  'document-error': new Set(['application', 'project', 'project-assets', 'document']),
  'image-document': new Set([
    'application', 'project', 'project-assets', 'document', 'image-canvas', 'layer-stack',
    'editable-pixels', 'vector-editing', 'text-editing', 'selection'
  ])
};

export const workspaceSurfaceCan = (
  surface: WorkspaceSurface,
  scope: WorkspaceCommandScope
): boolean => surfaceScopes[surface.kind].has(scope);
