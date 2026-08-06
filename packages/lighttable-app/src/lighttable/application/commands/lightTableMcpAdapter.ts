import type { DocumentSessionId } from '../documents/documentSession';
import type { LayerId } from '../../editor/document/documentTypes';
import type {
  LightTableAutomationDriver,
  LightTableCommandId
} from './lightTableCommandService';

export const LIGHTTABLE_MCP_PROTOCOL_VERSION = 1 as const;

export type LightTableMcpMethod =
  | 'workspace.query'
  | 'document.query'
  | 'layer.list'
  | 'layer.effects'
  | 'command.capabilities'
  | 'command.execute'
  | 'task.query'
  | 'artifact.list'
  | 'artifact.query'
  | 'artifact.release'
  | 'gesture.begin'
  | 'gesture.update'
  | 'gesture.finish';

export interface LightTableMcpRequest {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly token: string;
  readonly method: string;
  readonly parameters?: unknown;
}

export type LightTableMcpResult =
  | { readonly requestId: string; readonly status: 'completed'; readonly value: unknown }
  | {
      readonly requestId: string;
      readonly status: 'rejected';
      readonly code:
        | 'adapter-disabled'
        | 'invalid-request'
        | 'authentication-failed'
        | 'session-expired'
        | 'session-revoked'
        | 'request-limit-reached'
        | 'unsupported-method'
        | 'command-not-allowed'
        | 'execution-failed';
      readonly message: string;
    };

export interface LightTableMcpActivityEntry {
  readonly requestId: string;
  readonly method: string;
  readonly at: number;
  readonly outcome: 'completed' | 'rejected';
}

export interface AuthenticatedLightTableMcpAdapterOptions {
  readonly driver: LightTableAutomationDriver;
  readonly enabled: boolean;
  readonly token: string;
  readonly expiresAt: number;
  readonly now?: () => number;
  readonly requestLimit?: number;
}

const allowedCommands = new Set<LightTableCommandId>([
  'document.create',
  'view.setZoom',
  'layer.createRaster',
  'layer.placeArtifact',
  'layer.rename',
  'layer.setVisibility',
  'layer.setFillOpacity',
  'layer.style.setEnabled',
  'layer.effect.setEnabled',
  'file.exportNative',
  'file.exportPng',
  'history.undo',
  'history.redo'
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const safeTokenEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

/**
 * Authenticated, transport-neutral MCP boundary.
 *
 * This class deliberately opens no socket and installs no global. A desktop or
 * web host must explicitly create it and supply the transport after presenting
 * the user with its own enable/disable UI.
 */
export class AuthenticatedLightTableMcpAdapter {
  private readonly now: () => number;
  private readonly requestLimit: number;
  private readonly activityEntries: LightTableMcpActivityEntry[] = [];
  private requestCount = 0;
  private revoked = false;

  constructor(private readonly options: AuthenticatedLightTableMcpAdapterOptions) {
    this.now = options.now ?? Date.now;
    this.requestLimit = Math.min(Math.max(options.requestLimit ?? 1_000, 1), 10_000);
    if (options.token.length < 24) {
      throw new Error('The MCP capability token must contain at least 24 characters.');
    }
  }

  revoke(): void {
    this.revoked = true;
  }

  activity(): readonly LightTableMcpActivityEntry[] {
    return [...this.activityEntries];
  }

  async invoke(value: unknown): Promise<LightTableMcpResult> {
    const requestId = isRecord(value) && typeof value.requestId === 'string'
      ? value.requestId
      : 'invalid-request';
    const reject = (code: Extract<LightTableMcpResult, { status: 'rejected' }>['code'], message: string) => {
      this.record(requestId, isRecord(value) && typeof value.method === 'string' ? value.method : 'invalid', 'rejected');
      return { requestId, status: 'rejected' as const, code, message };
    };

    if (!this.options.enabled) return reject('adapter-disabled', 'External control is disabled.');
    if (!isRecord(value) || value.protocolVersion !== LIGHTTABLE_MCP_PROTOCOL_VERSION
      || typeof value.requestId !== 'string' || value.requestId.length < 1 || value.requestId.length > 128
      || typeof value.token !== 'string' || typeof value.method !== 'string'
      || (value.parameters !== undefined && !isRecord(value.parameters))) {
      return reject('invalid-request', 'The MCP request is malformed or uses an unsupported protocol version.');
    }
    if (this.revoked) return reject('session-revoked', 'The external-control session was revoked.');
    if (this.now() >= this.options.expiresAt) return reject('session-expired', 'The external-control session expired.');
    if (!safeTokenEqual(value.token, this.options.token)) {
      return reject('authentication-failed', 'The capability token is invalid.');
    }
    if (this.requestCount >= this.requestLimit) {
      return reject('request-limit-reached', 'The external-control request limit was reached.');
    }
    this.requestCount += 1;

    try {
      const result = await this.dispatch(value.method, value.parameters ?? {});
      if (result === undefined) return reject('unsupported-method', 'This MCP method is not available.');
      this.record(value.requestId, value.method, 'completed');
      return { requestId: value.requestId, status: 'completed', value: result };
    } catch (reason) {
      if (reason instanceof CommandNotAllowedError) {
        return reject('command-not-allowed', reason.message);
      }
      return reject('execution-failed', reason instanceof Error ? reason.message : String(reason));
    }
  }

  private async dispatch(method: string, parameters: Record<string, unknown>): Promise<unknown> {
    const documentId = parameters.documentId as DocumentSessionId;
    switch (method as LightTableMcpMethod) {
      case 'workspace.query': return this.options.driver.queryWorkspace();
      case 'document.query': return this.options.driver.queryDocument(documentId);
      case 'layer.list': return this.options.driver.queryLayers(documentId);
      case 'layer.effects': return this.options.driver.queryLayerEffects(documentId, parameters.layerId as LayerId);
      case 'command.capabilities': return this.options.driver.queryCapabilities(documentId);
      case 'task.query': return this.options.driver.queryTask(documentId, String(parameters.taskId ?? ''));
      case 'artifact.list': return this.options.driver.listArtifacts();
      case 'artifact.query': return this.options.driver.queryArtifact(String(parameters.artifactId ?? ''));
      case 'artifact.release': return this.options.driver.releaseArtifact(String(parameters.artifactId ?? ''));
      case 'gesture.begin': return this.options.driver.beginGesture(parameters);
      case 'gesture.update': return this.options.driver.updateGesture(
        String(parameters.gestureId ?? ''), parameters.samples
      );
      case 'gesture.finish': return this.options.driver.finishGesture(
        String(parameters.gestureId ?? ''), parameters.commit === true
      );
      case 'command.execute': {
        const command = parameters.command;
        if (typeof command !== 'string' || !allowedCommands.has(command as LightTableCommandId)) {
          throw new CommandNotAllowedError('This command is not exposed to external control.');
        }
        return this.options.driver.execute({
          protocolVersion: 1,
          requestId: String(parameters.commandRequestId ?? parameters.requestId ?? 'mcp-command'),
          command,
          ...(typeof parameters.documentId === 'string' ? { documentId: parameters.documentId } : {}),
          parameters: isRecord(parameters.commandParameters) ? parameters.commandParameters : {},
          ...(typeof parameters.expectedDocumentRevision === 'number'
            ? { expectedDocumentRevision: parameters.expectedDocumentRevision }
            : {}),
          ...(typeof parameters.expectedWorkspaceRevision === 'number'
            ? { expectedWorkspaceRevision: parameters.expectedWorkspaceRevision }
            : {})
        });
      }
      default: return undefined;
    }
  }

  private record(requestId: string, method: string, outcome: LightTableMcpActivityEntry['outcome']): void {
    this.activityEntries.push({ requestId, method, at: this.now(), outcome });
    if (this.activityEntries.length > 64) this.activityEntries.shift();
  }
}

class CommandNotAllowedError extends Error {}
