import type { LightTableArtifactMetadata } from './lightTableArtifactRegistry';
import type { DocumentSessionId } from '../documents/documentSession';
import type {
  LightTableCommandPorts, LightTablePixelClipboardCapture
} from './lightTableCommandContract';
import {
  parseSemanticCopyPixelsCommand,
  parseSemanticPastePixelsCommand,
  type SemanticCopyPixelsCommand,
  type SemanticPastePixelsCommand
} from './semanticPixelClipboardCommandContract';

type DispatchFailure = {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};
type DispatchSuccess = { readonly ok: true; readonly value: unknown };
type DispatchResult = DispatchSuccess | DispatchFailure;

export interface PixelClipboardArtifactStore {
  register(file: File, kind: 'pixel-clipboard'): LightTableArtifactMetadata;
  query(id: string): LightTableArtifactMetadata | null;
  resolve(id: string): File | null;
}

/** Owns discrete pixel-clipboard validation and private renderer fast-path tokens. */
export class SemanticPixelClipboardCommandHandler {
  private readonly fastPasteTokens = new WeakMap<File, string>();
  private latestClipboardCopy: {
    readonly sourceDocumentId: DocumentSessionId;
    readonly bounds: LightTablePixelClipboardCapture['bounds'];
    readonly artifact: LightTableArtifactMetadata;
  } | null = null;

  constructor(private readonly artifacts: PixelClipboardArtifactStore) {}

  register(file: File): LightTableArtifactMetadata {
    return this.artifacts.register(file, 'pixel-clipboard');
  }

  matchingCopyArtifact(sourceDocumentId: string, bounds: LightTablePixelClipboardCapture['bounds']) {
    const copy = this.latestClipboardCopy;
    if (!copy || copy.sourceDocumentId !== sourceDocumentId
      || copy.bounds.x !== bounds.x || copy.bounds.y !== bounds.y
      || copy.bounds.width !== bounds.width || copy.bounds.height !== bounds.height
      || this.artifacts.query(copy.artifact.id)?.kind !== 'pixel-clipboard') return null;
    return copy.artifact;
  }

  async dispatch(command: 'selection.copyPixels' | 'selection.cutPixels' | 'selection.pastePixels', parameters: unknown,
    documentId: DocumentSessionId, ports: LightTableCommandPorts): Promise<DispatchResult & {
      readonly mutated?: boolean
    }> {
    if (command === 'selection.copyPixels') return this.copy(parameters, documentId,
      ports.copyPixels ? (value) => ports.copyPixels!(documentId, value) : undefined);
    if (command === 'selection.cutPixels') {
      if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)
        || Object.keys(parameters).length !== 0) {
        return { ok: false, code: 'invalid-parameters', message: 'Cut Pixels does not accept parameters.' };
      }
      const result = await this.copy({ source: 'active-layer' }, documentId,
        ports.cutPixels ? () => ports.cutPixels!(documentId) : undefined);
      return result.ok ? { ...result, mutated: true } : result;
    }
    const result = await this.paste(parameters, ports.pastePixels
      ? (file, value, token) => ports.pastePixels!(documentId, file, value, token)
      : undefined);
    return result.ok ? { ...result, mutated: true } : result;
  }

  async copy(parameters: unknown, documentId: DocumentSessionId,
    execute: ((command: SemanticCopyPixelsCommand) =>
    LightTablePixelClipboardCapture | null | Promise<LightTablePixelClipboardCapture | null>) | undefined
  ): Promise<DispatchResult> {
    const command = parseSemanticCopyPixelsCommand(parameters);
    if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
    if (!execute) return { ok: false, code: 'command-unavailable',
      message: 'Pixel copy is unavailable in the target document.' };
    try {
      const capture = await execute(command);
      if (!capture) return { ok: false, code: 'command-unavailable',
        message: 'Pixel copy requires a non-empty selection and a compatible raster source.' };
      const { bounds, file } = capture;
      const validBounds = [bounds.x, bounds.y, bounds.width, bounds.height]
        .every((entry) => Number.isFinite(entry) && Math.abs(entry) <= 10_000_000)
        && bounds.width > 0 && bounds.height > 0;
      if (!validBounds || !['image/png', 'image/webp'].includes(file.type)
        || file.size < 1 || file.size > 512 * 1024 * 1024) {
        return { ok: false, code: 'execution-failed',
          message: 'Pixel copy produced an invalid bounded image artifact.' };
      }
      const artifact = this.register(file);
      if (capture.fastPasteToken) this.fastPasteTokens.set(file, capture.fastPasteToken);
      this.latestClipboardCopy = { sourceDocumentId: documentId, bounds, artifact };
      return { ok: true, value: { source: command.source, bounds, artifact } };
    } catch (reason) {
      return { ok: false, code: 'execution-failed',
        message: reason instanceof Error ? reason.message : String(reason) };
    }
  }

  async paste(parameters: unknown, execute: ((file: File, command: SemanticPastePixelsCommand,
    fastPasteToken?: string) => unknown | Promise<unknown>) | undefined): Promise<DispatchResult> {
    const command = parseSemanticPastePixelsCommand(parameters);
    if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
    if (!execute) return { ok: false, code: 'command-unavailable',
      message: 'Pixel paste is unavailable in the target document.' };
    const metadata = this.artifacts.query(command.artifactId);
    const file = this.artifacts.resolve(command.artifactId);
    if (!file || metadata?.kind !== 'pixel-clipboard') return { ok: false,
      code: 'command-unavailable', message: 'The pixel clipboard artifact does not exist.' };
    if (!['image/png', 'image/webp'].includes(file.type) || file.size < 1
      || file.size > 512 * 1024 * 1024) {
      return { ok: false, code: 'invalid-parameters',
        message: 'Paste Pixels supports bounded PNG and WebP clipboard artifacts.' };
    }
    try {
      const value = await execute(file, command, this.fastPasteTokens.get(file));
      return value ? { ok: true, value } : { ok: false, code: 'execution-failed',
        message: 'The copied pixels could not be pasted.' };
    } catch (reason) {
      return { ok: false, code: 'execution-failed',
        message: reason instanceof Error ? reason.message : String(reason) };
    }
  }
}
