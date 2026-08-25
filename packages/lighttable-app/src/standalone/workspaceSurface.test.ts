import { describe, expect, it } from 'vitest';
import { resolveWorkspaceSurface, workspaceSurfaceCan } from './workspaceSurface';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';

const documentId = 'document-1' as DocumentSessionId;

describe('workspaceSurface', () => {
  it('distinguishes launcher and project home without fabricating a document', () => {
    expect(resolveWorkspaceSurface({ projectId: null, activeDocumentId: null, lifecycle: null }))
      .toEqual({ kind: 'launcher' });
    const projectHome = resolveWorkspaceSurface({
      projectId: 'project-1', activeDocumentId: null, lifecycle: null
    });
    expect(projectHome).toEqual({ kind: 'project-home', projectId: 'project-1' });
    expect(workspaceSurfaceCan(projectHome, 'project-assets')).toBe(true);
    expect(workspaceSurfaceCan(projectHome, 'image-canvas')).toBe(false);
  });

  it('projects video and future model documents without granting image editing scopes', () => {
    const video = resolveWorkspaceSurface({
      projectId: 'project-1', activeDocumentId: 'video-1' as never,
      lifecycle: 'ready', documentKind: 'video'
    });
    expect(video.kind).toBe('video-document');
    expect(workspaceSurfaceCan(video, 'media-playback')).toBe(true);
    expect(workspaceSurfaceCan(video, 'layer-stack')).toBe(false);

    const model = resolveWorkspaceSurface({
      projectId: 'project-1', activeDocumentId: 'model-1' as never,
      lifecycle: 'ready', documentKind: 'model-3d'
    });
    expect(model.kind).toBe('model-3d-document');
    expect(workspaceSurfaceCan(model, 'model-view')).toBe(true);
    expect(workspaceSurfaceCan(model, 'editable-pixels')).toBe(false);
  });

  it('keeps loading, ready and failed document identities explicit', () => {
    expect(resolveWorkspaceSurface({
      projectId: 'project-1', activeDocumentId: documentId, lifecycle: 'opening'
    }).kind).toBe('document-loading');
    expect(resolveWorkspaceSurface({
      projectId: null, activeDocumentId: documentId, lifecycle: 'ready'
    }).kind).toBe('image-document');
    expect(resolveWorkspaceSurface({
      projectId: null, activeDocumentId: documentId, lifecycle: 'failed'
    }).kind).toBe('document-error');
  });
});
