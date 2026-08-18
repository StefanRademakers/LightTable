import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectHomeSurface } from './ProjectHomeSurface';

describe('ProjectHomeSurface', () => {
  it('renders project and asset workspace without mounting an image editor', () => {
    const markup = renderToStaticMarkup(<ProjectHomeSurface
      project={{
        id: 'project-1',
        name: 'Campaign',
        rootPath: 'D:/Campaign',
        manifestPath: 'D:/Campaign/lighttable.project.json',
        lastUsedDocument: null
      }}
      surface={{ kind: 'project-home', projectId: 'project-1' }}
      importing={false}
      error={null}
      onBrowse={vi.fn()}
      onNewDocument={vi.fn()}
      onOpenFile={vi.fn()}
      onOpenAsset={vi.fn()}
      onImportFiles={vi.fn()}
      onCloseProject={vi.fn()}
      onRevealProject={vi.fn()}
    />);

    expect(markup).toContain('Drop media to add to Campaign');
    expect(markup).toContain('Project Home');
    expect(markup).toContain('aria-label="Project assets"');
    expect(markup).not.toContain('lighttable-editor-canvas');
    expect(markup).not.toContain('<canvas');
  });
});
