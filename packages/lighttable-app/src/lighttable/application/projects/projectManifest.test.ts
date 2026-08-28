import { describe, expect, it } from 'vitest';
import {
  createLightTableProjectManifest,
  DEFAULT_PROJECT_FOLDER_MAPPINGS,
  parseLightTableProjectManifest,
  projectStorageRelativePath
} from './projectManifest';

describe('LightTable project manifest', () => {
  it('requires the canonical v2 project workspace state', () => {
    const manifest = createLightTableProjectManifest({ id: 'project-12345678', name: 'Current' });
    expect(manifest.lastUsedDocument).toBeNull();
    expect(() => parseLightTableProjectManifest({ ...manifest, version: 1 }))
      .toThrow('supported LightTable project');
  });

  it('creates the complete portable default layout', () => {
    const manifest = createLightTableProjectManifest({
      id: 'project-12345678', name: 'Portrait Campaign', createdAt: '2026-08-11T12:00:00Z'
    });
    expect(manifest.folders).toEqual(DEFAULT_PROJECT_FOLDER_MAPPINGS);
    expect(manifest.userFolders).toEqual([]);
    expect(projectStorageRelativePath(manifest, 'aiHistory')).toBe('AI/History');
  });

  it.each(['../outside', '/absolute', 'C:/outside', 'folder/../outside', 'folder/'])
  ('rejects escaping or non-canonical folder mapping %s', (cache) => {
    expect(() => parseLightTableProjectManifest({
      format: 'lighttable-project', version: 2, id: 'project-12345678',
      name: 'Unsafe', createdAt: '2026-08-11T12:00:00Z',
      folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, cache }, userFolders: [], lastUsedDocument: null
    })).toThrow('folder mappings');
  });

  it('normalizes portable backslash mappings on read', () => {
    const manifest = parseLightTableProjectManifest({
      format: 'lighttable-project', version: 2, id: 'project-12345678',
      name: 'Portable', createdAt: '2026-08-11T12:00:00Z',
      folders: { ...DEFAULT_PROJECT_FOLDER_MAPPINGS, aiHistory: 'AI\\History' },
      userFolders: [{ name: 'References', path: 'Production\\References' }],
      lastUsedDocument: null
    });
    expect(manifest.folders.aiHistory).toBe('AI/History');
    expect(manifest.userFolders[0]?.path).toBe('Production/References');
  });

  it('rejects unknown manifest and folder fields instead of silently preserving ambiguity', () => {
    const base = createLightTableProjectManifest({ id: 'project-12345678', name: 'Strict' });
    expect(() => parseLightTableProjectManifest({ ...base, futureFlag: true }))
      .toThrow('unsupported fields');
    expect(() => parseLightTableProjectManifest({
      ...base, folders: { ...base.folders, unknownStorage: 'Unknown' }
    })).toThrow('folder mappings');
  });
});
