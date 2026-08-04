import type {
  DocumentSessionId,
  DocumentSessionSnapshot,
  DocumentViewport
} from '../documents/documentSession';
import type { WorkspaceSession } from '../workspace/workspaceSession';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import { findDocumentLayer, walkLayerTree } from '../../editor/document/layerTree';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';
import { queryLayerCommandCapabilities } from '../layers/layerCommandCapabilities';

export const LIGHTTABLE_COMMAND_PROTOCOL_VERSION = 1 as const;

export type LightTableCommandId =
  | 'view.setZoom'
  | 'layer.createRaster'
  | 'layer.rename'
  | 'history.undo'
  | 'history.redo';

export type LightTableCommandErrorCode =
  | 'invalid-request'
  | 'unsupported-protocol'
  | 'unknown-command'
  | 'document-required'
  | 'document-not-found'
  | 'document-not-ready'
  | 'stale-document-revision'
  | 'command-unavailable'
  | 'invalid-parameters'
  | 'execution-failed';

export interface LightTableCommandRequest {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly command: string;
  readonly documentId?: string;
  readonly parameters: unknown;
  readonly expectedDocumentRevision?: number;
}

export interface LightTableRevisionSet {
  readonly workspace: number;
  readonly document?: number;
  readonly historyState?: number;
}

export type LightTableCommandResult =
  | {
      readonly requestId: string;
      readonly status: 'completed';
      readonly value: unknown;
      readonly revisions: LightTableRevisionSet;
    }
  | {
      readonly requestId: string;
      readonly status: 'rejected';
      readonly code: LightTableCommandErrorCode;
      readonly message: string;
      readonly revisions: LightTableRevisionSet;
    };

export interface WorkspaceDocumentSummary {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly lifecycle: DocumentSessionSnapshot['lifecycle'];
  readonly dirty: boolean;
  readonly source: {
    readonly name: string;
    readonly mediaType: string;
    readonly byteLength?: number;
  };
}

export interface WorkspaceQueryResult {
  readonly revision: number;
  readonly activeDocumentId: DocumentSessionId | null;
  readonly documents: readonly WorkspaceDocumentSummary[];
}

export interface DocumentQueryResult {
  readonly revision: number;
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly lifecycle: DocumentSessionSnapshot['lifecycle'];
  readonly dirty: boolean;
  readonly canonicalRevision: number;
  readonly savedRevision: number;
  readonly canvas: { readonly width: number; readonly height: number } | null;
  readonly activeLayerId: LayerId | null;
  readonly layerCount: number;
  readonly viewport: DocumentViewport;
  readonly history: {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly busy: boolean;
    readonly undoDepth: number;
    readonly redoDepth: number;
    readonly currentStateId: number;
  };
  readonly tasks: {
    readonly activeCount: number;
  };
  readonly renderer: {
    readonly status: DocumentSessionSnapshot['renderer']['status'];
    readonly active: boolean;
    readonly estimatedGpuBytes: number;
  };
}

export interface LayerQuerySummary {
  readonly id: LayerId;
  readonly parentId: LayerId | null;
  readonly depth: number;
  readonly type: LayerNode['type'];
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly fillOpacity: number;
  readonly blendMode: LayerNode['blendMode'];
  readonly clipping: boolean;
  readonly hasMask: boolean;
  readonly hasActiveEffects: boolean;
}

export interface CommandCapabilitySummary {
  readonly command: LightTableCommandId;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface LightTableCommandPorts {
  setZoom(documentId: DocumentSessionId, viewport: DocumentViewport): void | Promise<void>;
  createRasterLayer(documentId: DocumentSessionId): void | Promise<void>;
  renameLayer(documentId: DocumentSessionId, layerId: LayerId, name: string): void | Promise<void>;
  undo(documentId: DocumentSessionId): boolean | Promise<boolean>;
  redo(documentId: DocumentSessionId): boolean | Promise<boolean>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Transport-neutral read/query and bounded command registry.
 *
 * It exposes serializable projections only. Existing application controllers
 * remain mutation authority through the injected ports; this service never
 * edits React state, document objects or GPU resources itself.
 */
export class LightTableCommandService {
  private workspaceRevision = 1;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly workspace: WorkspaceSession,
    private readonly ports: LightTableCommandPorts
  ) {
    this.unsubscribe = workspace.subscribe(() => {
      this.workspaceRevision += 1;
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  queryWorkspace(): WorkspaceQueryResult {
    const snapshot = this.workspace.getSnapshot();
    return {
      revision: this.workspaceRevision,
      activeDocumentId: snapshot.activeDocumentId,
      documents: snapshot.documentOrder.flatMap((id) => {
        const document = snapshot.documents[id];
        return document ? [{
          id,
          title: document.title,
          lifecycle: document.lifecycle,
          dirty: document.dirty,
          source: {
            name: document.source.name,
            mediaType: document.source.mediaType,
            ...(document.source.byteLength === undefined
              ? {}
              : { byteLength: document.source.byteLength })
          }
        }] : [];
      })
    };
  }

  queryDocument(documentId: DocumentSessionId): DocumentQueryResult | null {
    const document = this.document(documentId);
    if (!document) return null;
    const canonical = document.document;
    return {
      revision: this.workspaceRevision,
      id: document.id,
      title: document.title,
      lifecycle: document.lifecycle,
      dirty: document.dirty,
      canonicalRevision: document.documentRevision,
      savedRevision: document.savedRevision,
      canvas: canonical ? { width: canonical.width, height: canonical.height } : null,
      activeLayerId: canonical?.activeLayerId ?? null,
      layerCount: canonical ? walkLayerTree(canonical.layers).length : 0,
      viewport: { ...document.viewport },
      history: {
        canUndo: document.history.canUndo,
        canRedo: document.history.canRedo,
        busy: document.history.busy,
        undoDepth: document.history.undoDepth,
        redoDepth: document.history.redoDepth,
        currentStateId: document.history.currentStateId
      },
      tasks: { activeCount: document.tasks.activeTaskIds.length },
      renderer: {
        status: document.renderer.status,
        active: document.renderer.active,
        estimatedGpuBytes: document.renderer.estimatedGpuBytes
      }
    };
  }

  queryLayers(documentId: DocumentSessionId): readonly LayerQuerySummary[] | null {
    const canonical = this.document(documentId)?.document;
    if (!canonical) return null;
    return walkLayerTree(canonical.layers).map(({ node, parentId, path }) => ({
      id: node.id,
      parentId,
      depth: path.length - 1,
      type: node.type,
      name: node.name,
      visible: node.visible,
      opacity: node.opacity,
      fillOpacity: node.fillOpacity,
      blendMode: node.blendMode,
      clipping: node.clipping,
      hasMask: Boolean(node.mask),
      hasActiveEffects: layerStyleStackIsActive(node.styleStack)
    }));
  }

  queryCapabilities(documentId: DocumentSessionId): readonly CommandCapabilitySummary[] | null {
    const snapshot = this.document(documentId);
    if (!snapshot?.document) return null;
    const ready = snapshot.lifecycle === 'ready';
    const layerCapabilities = queryLayerCommandCapabilities(snapshot.document);
    const availability = (
      command: LightTableCommandId,
      available: boolean,
      reason: string
    ): CommandCapabilitySummary => ({
      command,
      available: ready && available,
      reason: !ready ? 'The document is not ready.' : available ? null : reason
    });
    return [
      availability('view.setZoom', true, ''),
      availability('layer.createRaster', true, ''),
      availability(
        'layer.rename',
        Boolean(layerCapabilities.activeLayer),
        'Select an existing layer.'
      ),
      availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
      availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
    ];
  }

  async execute(requestValue: unknown): Promise<LightTableCommandResult> {
    const request = this.parseRequest(requestValue);
    if ('rejection' in request) return request.rejection;
    const { value } = request;
    const snapshot = this.document(value.documentId);
    if (!snapshot) {
      return this.reject(value.requestId, 'document-not-found', 'The target document is not open.');
    }
    if (snapshot.lifecycle !== 'ready' || !snapshot.document) {
      return this.reject(value.requestId, 'document-not-ready', 'The target document is not ready.');
    }
    if (
      value.expectedDocumentRevision !== undefined
      && value.expectedDocumentRevision !== snapshot.documentRevision
    ) {
      return this.reject(
        value.requestId,
        'stale-document-revision',
        `Expected document revision ${value.expectedDocumentRevision}, current revision is ${snapshot.documentRevision}.`,
        snapshot
      );
    }

    try {
      const result = await this.executeParsed(value, snapshot);
      if ('code' in result) return this.reject(value.requestId, result.code, result.message, snapshot);
      return {
        requestId: value.requestId,
        status: 'completed',
        value: result.value,
        revisions: this.revisions(this.document(value.documentId) ?? snapshot)
      };
    } catch (reason) {
      return this.reject(
        value.requestId,
        'execution-failed',
        reason instanceof Error ? reason.message : 'The command failed.',
        snapshot
      );
    }
  }

  private async executeParsed(
    request: ParsedCommandRequest,
    snapshot: DocumentSessionSnapshot
  ): Promise<{ value: unknown } | { code: LightTableCommandErrorCode; message: string }> {
    const parameters = request.parameters;
    switch (request.command) {
      case 'view.setZoom': {
        if (!isRecord(parameters)) return this.invalidParameters('Zoom parameters must be an object.');
        const mode = parameters.mode;
        const percent = parameters.percent;
        if (mode !== 'fit' && mode !== '100' && mode !== 'custom') {
          return this.invalidParameters('Zoom mode must be fit, 100 or custom.');
        }
        if (mode === 'custom' && (typeof percent !== 'number' || !Number.isFinite(percent))) {
          return this.invalidParameters('Custom zoom requires a finite percent.');
        }
        const scale = mode === 'custom'
          ? Math.max(0.01, Math.min(256, Number(percent) / 100))
          : mode === '100' ? 1 : snapshot.viewport.scale;
        const viewport: DocumentViewport = { ...snapshot.viewport, zoomMode: mode, scale };
        await this.ports.setZoom(request.documentId, viewport);
        return { value: { viewport } };
      }
      case 'layer.createRaster':
        if (!isRecord(parameters) || Object.keys(parameters).length > 0) {
          return this.invalidParameters('Create raster parameters must be an empty object.');
        }
        await this.ports.createRasterLayer(request.documentId);
        return { value: { created: true } };
      case 'layer.rename': {
        if (!isRecord(parameters)) return this.invalidParameters('Rename parameters must be an object.');
        const layerId = typeof parameters.layerId === 'string'
          ? parameters.layerId as LayerId
          : null;
        const name = typeof parameters.name === 'string' ? parameters.name.trim() : '';
        if (!layerId || !name) return this.invalidParameters('Rename requires layerId and a non-empty name.');
        if (!findDocumentLayer(snapshot.document!, layerId)) {
          return { code: 'command-unavailable', message: 'The target layer does not exist.' };
        }
        await this.ports.renameLayer(request.documentId, layerId, name);
        return { value: { layerId, name } };
      }
      case 'history.undo':
      case 'history.redo': {
        if (!isRecord(parameters) || Object.keys(parameters).length > 0) {
          return this.invalidParameters('History parameters must be an empty object.');
        }
        const direction = request.command === 'history.undo' ? 'undo' : 'redo';
        const available = direction === 'undo' ? snapshot.history.canUndo : snapshot.history.canRedo;
        if (!available) {
          return {
            code: 'command-unavailable',
            message: direction === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.'
          };
        }
        const changed = await this.ports[direction](request.documentId);
        if (!changed) return { code: 'execution-failed', message: `${direction} did not complete.` };
        return { value: { changed: true } };
      }
    }
  }

  private parseRequest(value: unknown):
    | { value: ParsedCommandRequest }
    | { rejection: LightTableCommandResult } {
    const requestId = isRecord(value) && typeof value.requestId === 'string'
      ? value.requestId
      : 'invalid-request';
    if (!isRecord(value)) {
      return { rejection: this.reject(requestId, 'invalid-request', 'The command request must be an object.') };
    }
    if (value.protocolVersion !== LIGHTTABLE_COMMAND_PROTOCOL_VERSION) {
      return { rejection: this.reject(requestId, 'unsupported-protocol', 'Unsupported command protocol version.') };
    }
    if (!requestId.trim() || typeof value.command !== 'string') {
      return { rejection: this.reject(requestId, 'invalid-request', 'requestId and command are required.') };
    }
    if (!this.isCommandId(value.command)) {
      return { rejection: this.reject(requestId, 'unknown-command', `Unknown command: ${value.command}.`) };
    }
    if (typeof value.documentId !== 'string' || !value.documentId) {
      return { rejection: this.reject(requestId, 'document-required', 'An explicit documentId is required.') };
    }
    if (
      value.expectedDocumentRevision !== undefined
      && (
        typeof value.expectedDocumentRevision !== 'number'
        || !Number.isInteger(value.expectedDocumentRevision)
        || value.expectedDocumentRevision < 0
      )
    ) {
      return { rejection: this.reject(requestId, 'invalid-request', 'expectedDocumentRevision must be a non-negative integer.') };
    }
    return { value: {
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId,
      command: value.command,
      documentId: value.documentId as DocumentSessionId,
      parameters: value.parameters,
      expectedDocumentRevision: value.expectedDocumentRevision as number | undefined
    } };
  }

  private isCommandId(value: string): value is LightTableCommandId {
    return [
      'view.setZoom',
      'layer.createRaster',
      'layer.rename',
      'history.undo',
      'history.redo'
    ].includes(value);
  }

  private document(documentId: DocumentSessionId): DocumentSessionSnapshot | null {
    return this.workspace.getSnapshot().documents[documentId] ?? null;
  }

  private invalidParameters(message: string) {
    return { code: 'invalid-parameters' as const, message };
  }

  private revisions(snapshot?: DocumentSessionSnapshot): LightTableRevisionSet {
    return {
      workspace: this.workspaceRevision,
      ...(snapshot ? {
        document: snapshot.documentRevision,
        historyState: snapshot.history.currentStateId
      } : {})
    };
  }

  private reject(
    requestId: string,
    code: LightTableCommandErrorCode,
    message: string,
    snapshot?: DocumentSessionSnapshot
  ): LightTableCommandResult {
    return {
      requestId,
      status: 'rejected',
      code,
      message,
      revisions: this.revisions(snapshot)
    };
  }
}

interface ParsedCommandRequest {
  readonly protocolVersion: typeof LIGHTTABLE_COMMAND_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly command: LightTableCommandId;
  readonly documentId: DocumentSessionId;
  readonly parameters: unknown;
  readonly expectedDocumentRevision?: number;
}
