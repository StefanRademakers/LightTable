import { describe, expect, it } from 'vitest';
import type { SerializedDockview } from 'dockview-react';
import {
  clearWorkspaceLayout,
  LIGHTTABLE_WORKSPACE_STORAGE_KEY,
  persistWorkspaceLayout,
  readWorkspaceLayout,
  sanitizeWorkspaceLayout
} from './workspaceLayoutPersistence';

const layout = (params: Record<string, unknown> = { contentKey: 'layers' }) => ({
  grid: { root: { type: 'leaf', data: { views: ['layers'], activeView: 'layers' } }, width: 800, height: 600 },
  panels: {
    layers: { id: 'layers', contentComponent: 'workspacePanel', tabComponent: 'persistentPanelTab', params }
  },
  activeGroup: 'group-1'
}) as unknown as SerializedDockview;

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values
  };
};

describe('workspace layout persistence', () => {
  it('roundtrips a versioned layout and selected preset', () => {
    const storage = memoryStorage();
    persistWorkspaceLayout(storage, layout(), 'custom');
    expect(readWorkspaceLayout(storage)).toMatchObject({ version: 2, preset: 'custom' });
  });

  it('roundtrips the grading preset', () => {
    const storage = memoryStorage();
    persistWorkspaceLayout(storage, layout(), 'grading');
    expect(readWorkspaceLayout(storage)?.preset).toBe('grading');
  });

  it('drops runtime and document data from serialized panel params', () => {
    const clean = sanitizeWorkspaceLayout(layout({
      contentKey: 'layers',
      documentId: 'private-document',
      sourcePath: 'D:\\private\\file.psd',
      runtime: { gpu: 'state' }
    }));
    expect((clean.panels.layers as { params: unknown }).params).toEqual({ contentKey: 'layers' });
  });

  it('repairs corrupt or unknown versions by resetting to no saved layout', () => {
    const storage = memoryStorage();
    storage.setItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY, '{bad json');
    expect(readWorkspaceLayout(storage)).toBeNull();
    expect(storage.getItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    storage.setItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 99, preset: 'default', layout: layout() }));
    expect(readWorkspaceLayout(storage)).toBeNull();
  });

  it('discards the incompatible prior panel layout and supports a complete reset', () => {
    const storage = memoryStorage();
    storage.setItem('lighttable.workspace.layout.v5', JSON.stringify(layout()));
    expect(readWorkspaceLayout(storage)).toBeNull();
    expect(storage.getItem('lighttable.workspace.layout.v5')).toBeNull();
    expect(storage.getItem(LIGHTTABLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    clearWorkspaceLayout(storage);
    expect(storage.values.size).toBe(0);
  });
});
