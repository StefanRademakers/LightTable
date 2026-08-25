import { describe, expect, it } from 'vitest';
import { editorMenuEnabledForDocumentKind } from './LightTableEditorShell';

describe('editorMenuEnabledForDocumentKind', () => {
  it('keeps application menus but disables image-edit menus for video', () => {
    expect(editorMenuEnabledForDocumentKind('video', 'file')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'edit')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'ai')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'view')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'help')).toBe(true);
    for (const menu of ['image', 'layer', 'type', 'select', 'filter'] as const) {
      expect(editorMenuEnabledForDocumentKind('video', menu)).toBe(false);
    }
  });

  it('keeps the complete image editor menu surface for image documents', () => {
    for (const menu of ['file', 'edit', 'image', 'layer', 'type', 'select', 'filter', 'ai', 'view', 'help'] as const) {
      expect(editorMenuEnabledForDocumentKind('image', menu)).toBe(true);
    }
  });
});
