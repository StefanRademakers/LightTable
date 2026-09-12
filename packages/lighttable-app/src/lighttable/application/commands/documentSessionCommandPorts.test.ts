import { afterEach, describe, expect, it, vi } from 'vitest';
import * as svgNormalizer from '../vectors/normalizeEditableSvgSource';
import {
  createAdjustmentLayer,
  createRasterLayer,
  groupLayers,
  setActiveLayer
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { EditorApplicationSession } from '../workspace/editorApplicationSession';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { createDocumentSessionCommandPorts } from './documentSessionCommandPorts';
import { LightTableCommandPortRegistry } from './lightTableCommandPortRegistry';
import { LightTableCommandService } from './lightTableCommandService';
import type { DocumentLightTableCommandPorts, LightTableCommandId } from './lightTableCommandContract';
import { canReadInactiveFlatRaster } from './inactiveFlatRasterArtifacts';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { layerStyleSnapshot } from '../styles/completeLayerStyleSnapshot';
import { filterSnapshot } from '../filters/completeFilterSnapshot';
import { createFilterStack } from '../../processing/filter';
import { LIGHTTABLE_COMMAND_IDS } from '@lighttable/command-contract';
import {
  MOUNTED_DOCUMENT_COMMANDS,
  SERVICE_OWNED_COMMANDS
} from './lightTableCommandOwnership';

describe('document-lifetime command ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  it('imports SVG into the captured inactive session with one undoable boundary', async () => {
    const workspace = new WorkspaceSession();
    const opened = workspace.open({ source: { id: 'svg-source', name: 'SVG', mediaType: 'image/svg+xml' } });
    if (!opened.ok) throw new Error('SVG fixture failed to open');
    const session = opened.value;
    session.setDocument(createImageDocument('SVG', 100, 100, 'svg-source'));
    session.setReady();
    const ports = createDocumentSessionCommandPorts(session, new EditorApplicationSession());
    let release!: (source: string) => void;
    vi.spyOn(svgNormalizer, 'normalizeEditableSvgSource').mockImplementation(() => (
      new Promise<string>((resolve) => { release = resolve; })
    ));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const pending = ports.executeSvgImport!({ svg, placement: 'document' });
    const edited = createRasterLayer(session.getSnapshot().document!, 'Intervening edit');
    session.setDocument(edited);
    const activeBefore = workspace.getSnapshot().activeDocumentId;
    release(svg);
    const result = await pending;
    const imported = session.getSnapshot().document!;
    expect(result).toMatchObject({ layerId: imported.layers.at(-1)?.id });
    expect(imported.layers.slice(0, edited.layers.length)).toEqual(edited.layers);
    expect(session.getSnapshot().history.undoDepth).toBe(1);
    expect(workspace.getSnapshot().activeDocumentId).toBe(activeBefore);
    await session.history.undo();
    expect(session.getSnapshot().document).toBe(edited);
    await session.history.redo();
    expect(session.getSnapshot().document).toBe(imported);
    workspace.dispose();
  });

  it('rejects deferred SVG normalization after the owning session retires', async () => {
    const workspace = new WorkspaceSession();
    const opened = workspace.open({ source: { id: 'svg-source', name: 'SVG', mediaType: 'image/svg+xml' } });
    if (!opened.ok) throw new Error('SVG fixture failed to open');
    const session = opened.value;
    session.setDocument(createImageDocument('SVG', 100, 100, 'svg-source'));
    session.setReady();
    const ports = createDocumentSessionCommandPorts(session, new EditorApplicationSession());
    let release!: (source: string) => void;
    vi.spyOn(svgNormalizer, 'normalizeEditableSvgSource').mockImplementation(() => (
      new Promise<string>((resolve) => { release = resolve; })
    ));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const pending = ports.executeSvgImport!({ svg, placement: 'document' });
    session.dispose();
    const retired = session.getSnapshot();
    release(svg);
    await expect(pending).rejects.toThrow('scope is no longer current');
    expect(session.getSnapshot()).toBe(retired);
    workspace.dispose();
  });

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
    const revisionBefore = first.value.getSnapshot().documentRevision;
    const semanticMarkChanged = vi.spyOn(first.value, 'markChanged');

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
    const committedRevision = first.value.getSnapshot().documentRevision;
    expect(committedRevision).toBeGreaterThan(revisionBefore);
    expect(semanticMarkChanged).not.toHaveBeenCalled();
    expect(result).toMatchObject({ revisions: { document: committedRevision } });
    expect(first.value.getSnapshot().history.undoDepth).toBe(1);

    await first.value.history.undo();
    expect(first.value.getSnapshot().document?.layers.find(({ id }) => id === firstLayerId)?.name)
      .not.toBe('Renamed while inactive');
    expect(workspace.getSnapshot().activeDocumentId).toBe(activeBefore);
    expect(first.value.getSnapshot().documentRevision).toBeGreaterThan(committedRevision);
    expect(semanticMarkChanged).not.toHaveBeenCalled();

    service.dispose();
    workspace.dispose();
  });

  it('keeps layer-panel structure and appearance commands available without a mounted panel', async () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-layers' as never });
    const opened = workspace.open({
      source: { id: 'source-layers', name: 'Layers.png', mediaType: 'image/png' }
    });
    if (!opened.ok) throw new Error('The layer command fixture did not open.');
    opened.value.setDocument(createRasterLayer(createImageDocument(
      'Layers', 80, 60, 'source-layers'
    )));
    opened.value.setReady();
    const registry = new LightTableCommandPortRegistry(() => createDocumentSessionCommandPorts(
      opened.value, new EditorApplicationSession()
    ));
    const service = new LightTableCommandService(workspace, registry);
    const sourceLayerId = opened.value.getSnapshot().document!.activeLayerId!;
    const execute = (requestId: string, command: LightTableCommandId,
      parameters: unknown) => service.execute({
        protocolVersion: 1, requestId, command, documentId: opened.value.id, parameters
      });

    await expect(execute('opacity', 'layer.setOpacity', {
      layerId: sourceLayerId, opacity: 0.35
    })).resolves.toMatchObject({ status: 'completed', value: { opacity: 0.35 } });
    expect(findDocumentLayer(opened.value.getSnapshot().document!, sourceLayerId)?.opacity).toBe(0.35);

    const group = await execute('create-group', 'layer.createGroup', {});
    expect(group).toMatchObject({ status: 'completed', value: { layerId: expect.any(String) } });
    const gradient = await execute('create-gradient', 'layer.createGradientFill', {});
    expect(gradient).toMatchObject({ status: 'completed', value: { layerId: expect.any(String) } });
    expect(opened.value.getSnapshot().history.undoDepth).toBe(3);

    service.dispose();
    workspace.dispose();
  });

  it('reports generated identities for nested structure commands and records them once', async () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-nested' as never });
    const opened = workspace.open({
      source: { id: 'source-nested', name: 'Nested.psd', mediaType: 'image/vnd.adobe.photoshop' }
    });
    if (!opened.ok) throw new Error('The nested fixture did not open.');
    let document = createRasterLayer(createImageDocument('Nested', 80, 60, 'source-nested'));
    const firstLayerId = document.activeLayerId!;
    document = createRasterLayer(document);
    const secondLayerId = document.activeLayerId!;
    document = groupLayers(document, [firstLayerId, secondLayerId]);
    document = setActiveLayer(document, firstLayerId);
    opened.value.setDocument(document);
    opened.value.setReady();
    const registry = new LightTableCommandPortRegistry(() => createDocumentSessionCommandPorts(
      opened.value, new EditorApplicationSession()
    ));
    const service = new LightTableCommandService(workspace, registry);
    const execute = (requestId: string, command: LightTableCommandId, parameters: unknown) => (
      service.execute({
        protocolVersion: 1, requestId, command, documentId: opened.value.id, parameters
      })
    );

    const createdGroup = await execute('nested-group', 'layer.createGroup', {});
    expect(createdGroup).toMatchObject({ status: 'completed', value: { layerId: expect.any(String) } });
    const groupId = createdGroup.status === 'completed'
      ? (createdGroup.value as { layerId: string }).layerId
      : '';
    expect(findDocumentLayer(opened.value.getSnapshot().document!, groupId as never)?.type).toBe('group');

    const gradient = await execute('nested-gradient', 'layer.createGradientFill', {});
    expect(gradient).toMatchObject({ status: 'completed', value: { layerId: expect.any(String) } });
    const gradientId = gradient.status === 'completed'
      ? (gradient.value as { layerId: string }).layerId
      : '';
    expect(findDocumentLayer(opened.value.getSnapshot().document!, gradientId as never)?.type).toBe('vector');

    const grouped = await execute('nested-regroup', 'layer.group', {
      layerIds: [groupId, gradientId]
    });
    expect(grouped).toMatchObject({
      status: 'completed',
      value: { layerIds: [groupId, gradientId], groupId: expect.any(String) }
    });
    expect(opened.value.getSnapshot().history.undoDepth).toBe(3);

    service.dispose();
    workspace.dispose();
  });

  it('owns processing-structure changes through normal document history', async () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-processing' as never });
    const opened = workspace.open({
      source: { id: 'source-processing', name: 'Processing.png', mediaType: 'image/png' }
    });
    if (!opened.ok) throw new Error('The processing fixture did not open.');
    opened.value.setDocument(createRasterLayer(createImageDocument(
      'Processing', 80, 60, 'source-processing'
    )));
    opened.value.setReady();
    const registry = new LightTableCommandPortRegistry(() => createDocumentSessionCommandPorts(
      opened.value, new EditorApplicationSession()
    ));
    const service = new LightTableCommandService(workspace, registry);
    const layerId = opened.value.getSnapshot().document!.activeLayerId!;

    const parameters = {
      operation: 'set-enabled',
      target: { kind: 'local', layerId, owner: 'curves' },
      enabled: false
    } as const;
    await expect(service.execute({
      protocolVersion: 1,
      requestId: 'disable-curves',
      command: 'adjustment.modifyStructure',
      documentId: opened.value.id,
      parameters
    })).resolves.toMatchObject({ status: 'completed' });
    expect(opened.value.getSnapshot().history.undoDepth).toBe(1);
    await expect(service.execute({
      protocolVersion: 1,
      requestId: 'disable-curves-again',
      command: 'adjustment.modifyStructure',
      documentId: opened.value.id,
      parameters
    })).resolves.toMatchObject({ status: 'completed', value: { changed: false } });
    expect(opened.value.getSnapshot().history.undoDepth).toBe(1);
    await opened.value.history.undo();
    const layer = findDocumentLayer(opened.value.getSnapshot().document!, layerId);
    expect(layer?.type === 'raster' ? layer.adjustmentStack : null).toBeNull();

    service.dispose();
    workspace.dispose();
  });

  it('executes complete style and filter snapshots for an inactive document', () => {
    const workspace = new WorkspaceSession({ createId: () => 'document-effects' as never });
    const opened = workspace.open({
      source: { id: 'source-effects', name: 'Effects.psd', mediaType: 'image/vnd.adobe.photoshop' }
    });
    if (!opened.ok) throw new Error('The effects fixture did not open.');
    let document = createImageDocument('Effects', 80, 60, 'source-effects');
    const styledLayerId = document.activeLayerId!;
    document = createAdjustmentLayer(
      document,
      createFilterStack('gaussian-blur'),
      'Gaussian Blur',
      styledLayerId,
      'gaussian-blur'
    );
    const filterLayerId = document.activeLayerId!;
    opened.value.setDocument(document);
    opened.value.setReady();
    const ports = createDocumentSessionCommandPorts(opened.value, new EditorApplicationSession());
    const styledLayer = findDocumentLayer(document, styledLayerId)!;

    expect(ports.supportsCommand?.('layer.style.setSnapshot')).toBe(true);
    expect(ports.supportsCommand?.('filter.setSnapshot')).toBe(true);
    ports.executeLayerStyleSnapshot?.({
      layerId: styledLayerId,
      snapshot: { ...layerStyleSnapshot(styledLayer.styleStack), enabled: false }
    });
    ports.executeFilterSnapshot?.({
      target: { kind: 'layer', layerId: filterLayerId },
      snapshot: filterSnapshot('gaussian-blur', true, { radius: 22 })
    });

    expect(findDocumentLayer(opened.value.getSnapshot().document!, styledLayerId)?.styleStack.enabled)
      .toBe(false);
    const filterLayer = findDocumentLayer(opened.value.getSnapshot().document!, filterLayerId);
    expect(filterLayer?.type === 'adjustment'
      ? filterLayer.adjustmentStack.modules[0]?.settings
      : null).toMatchObject({ radius: 22 });
    expect(opened.value.getSnapshot().history.undoDepth).toBe(2);
    workspace.dispose();
  });

  it('uses the mounted presentation owner while active and resumes the document-lifetime owner after detach', () => {
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
