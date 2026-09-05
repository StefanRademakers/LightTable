import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { EditorApplicationSession } from '../workspace/editorApplicationSession';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { createDocumentSessionCommandPorts } from './documentSessionCommandPorts';
import { LightTableCommandPortRegistry } from './lightTableCommandPortRegistry';
import { LightTableCommandService } from './lightTableCommandService';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';
import { canReadInactiveFlatRaster } from './inactiveFlatRasterArtifacts';
import { LIGHTTABLE_COMMAND_IDS } from '@lighttable/command-contract';
import {
  MOUNTED_DOCUMENT_COMMANDS,
  SERVICE_OWNED_COMMANDS
} from './lightTableCommandOwnership';

describe('document-lifetime command ownership', () => {
  it('assigns every public command to exactly one explicit execution owner', () => {
    const assigned = new Set([...SERVICE_OWNED_COMMANDS, ...MOUNTED_DOCUMENT_COMMANDS]);
    const overlap = [...SERVICE_OWNED_COMMANDS].filter((command) => (
      MOUNTED_DOCUMENT_COMMANDS.has(command)
    ));

    expect(overlap).toEqual([]);
    expect([...assigned].sort()).toEqual([...LIGHTTABLE_COMMAND_IDS].sort());
  });

  it('admits a clean flat raster source for inactive visual reads only', () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-flat' as never });
    const opened = workspace.open({
      source: { id: 'source-flat', name: 'Flat.jpg', mediaType: 'image/jpeg' }
    });
    if (!opened.ok) throw new Error('The flat document fixture did not open.');
    opened.value.setDocument(createImageDocument('Flat', 80, 60, 'source-flat'));
    opened.value.updateLoadedSource((current) => ({
      ...current, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), identity: 'source-flat'
    }));
    opened.value.setReady();
    expect(canReadInactiveFlatRaster(opened.value)).toBe(true);
    opened.value.markChanged();
    expect(canReadInactiveFlatRaster(opened.value)).toBe(false);
    workspace.dispose();
  });

  it('mutates an inactive document without activating or mounting its editor', async () => {
    let sequence = 0;
    const workspace = new WorkspaceSession({
      createId: () => `document-${++sequence}` as never
    });
    const first = workspace.open({
      source: { id: 'source-a', name: 'A.png', mediaType: 'image/png' }
    });
    const second = workspace.open({
      source: { id: 'source-b', name: 'B.png', mediaType: 'image/png' }
    });
    if (!first.ok || !second.ok) throw new Error('The document fixtures did not open.');
    first.value.setDocument(createRasterLayer(createImageDocument('A', 80, 60, 'source-a')));
    second.value.setDocument(createRasterLayer(createImageDocument('B', 80, 60, 'source-b')));
    first.value.setReady();
    second.value.setReady();

    const application = new EditorApplicationSession();
    const controllers = new Map<string, DocumentLightTableCommandPorts>();
    const registry = new LightTableCommandPortRegistry((documentId) => {
      const session = workspace.getDocument(documentId);
      if (!session) return null;
      const existing = controllers.get(documentId);
      if (existing) return existing;
      const created = createDocumentSessionCommandPorts(session, application);
      controllers.set(documentId, created);
      return created;
    });
    const service = new LightTableCommandService(workspace, registry);
    const activeBefore = workspace.getSnapshot().activeDocumentId;
    const secondBefore = second.value.getSnapshot().document;
    const firstLayerId = first.value.getSnapshot().document!.activeLayerId!;

    expect(registry.has(first.value.id)).toBe(true);
    expect(service.queryCapabilities(first.value.id)).toEqual(expect.arrayContaining([
      { command: 'layer.rename', available: true, reason: null },
      { command: 'raster.fill', available: false,
        reason: 'The command requires the active document renderer.' },
      { command: 'file.exportNative', available: false,
        reason: 'The command requires the active document renderer.' }
    ]));

    const result = await service.execute({
      protocolVersion: 1,
      requestId: 'inactive-rename',
      command: 'layer.rename',
      documentId: first.value.id,
      parameters: { layerId: firstLayerId, name: 'Renamed while inactive' }
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(workspace.getSnapshot().activeDocumentId).toBe(activeBefore);
    expect(second.value.getSnapshot().document).toBe(secondBefore);
    expect(first.value.getSnapshot().document?.layers.find(({ id }) => id === firstLayerId)?.name)
      .toBe('Renamed while inactive');
    expect(first.value.getSnapshot().documentRevision).toBe(1);
    expect(first.value.getSnapshot().history.undoDepth).toBe(1);

    await first.value.history.undo();
    expect(first.value.getSnapshot().document?.layers.find(({ id }) => id === firstLayerId)?.name)
      .not.toBe('Renamed while inactive');
    expect(workspace.getSnapshot().activeDocumentId).toBe(activeBefore);

    service.dispose();
    workspace.dispose();
  });

  it('uses the mounted presentation port while active and falls back after detach', () => {
    const canonicalCreate = vi.fn();
    const mountedCreate = vi.fn();
    const canonical = { createRasterLayer: canonicalCreate } as unknown as DocumentLightTableCommandPorts;
    const mounted = { createRasterLayer: mountedCreate } as unknown as DocumentLightTableCommandPorts;
    const documentId = 'document-a' as never;
    const registry = new LightTableCommandPortRegistry(() => canonical);
    const detach = registry.register(documentId, mounted);

    registry.createRasterLayer(documentId);
    expect(mountedCreate).toHaveBeenCalledOnce();
    expect(canonicalCreate).not.toHaveBeenCalled();

    detach();
    registry.createRasterLayer(documentId);
    expect(canonicalCreate).toHaveBeenCalledOnce();
  });

  it('fails closed when the selected owner has no explicit command capabilities', () => {
    const documentId = 'document-a' as never;
    const canonical = { createRasterLayer: vi.fn() } as unknown as DocumentLightTableCommandPorts;
    const registry = new LightTableCommandPortRegistry(() => canonical);

    expect(registry.supportsCommand(documentId, 'layer.createRaster')).toBe(false);
  });

  it('does not advertise a declared command when its required port is absent', () => {
    const documentId = 'document-a' as never;
    const incomplete = {
      supportsCommand: () => true
    } as unknown as DocumentLightTableCommandPorts;
    const registry = new LightTableCommandPortRegistry(() => incomplete);

    expect(registry.supportsCommand(documentId, 'raster.invert')).toBe(false);
  });

  it('never mixes a mounted owner with canonical fallback methods', () => {
    const documentId = 'document-a' as never;
    const canonicalImport = vi.fn();
    const canonical = {
      supportsCommand: () => true,
      executeSvgImport: canonicalImport
    } as unknown as DocumentLightTableCommandPorts;
    const mounted = {
      supportsCommand: () => false,
      createRasterLayer: vi.fn()
    } as unknown as DocumentLightTableCommandPorts;
    const registry = new LightTableCommandPortRegistry(() => canonical);
    registry.register(documentId, mounted);

    expect(() => registry.executeSvgImport(documentId, {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      placement: 'document'
    })).toThrow('SVG import is unavailable in the target document.');
    expect(canonicalImport).not.toHaveBeenCalled();
  });
});
