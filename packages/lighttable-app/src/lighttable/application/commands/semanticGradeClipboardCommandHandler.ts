import { gradeClipboardSettings } from '../../lightTableGradeClipboard';
import { cloneAdjustments } from '../../types';
import type { DocumentSessionId } from '../documents/documentSession';
import type { LightTableArtifactMetadata } from './lightTableArtifactRegistry';
import type {
  LightTableCommandPorts,
  LightTableGradeClipboardCapture
} from './lightTableCommandContract';
import {
  parseSemanticCopyGradeCommand,
  parseSemanticPasteGradeCommand
} from './semanticGradeClipboardCommandContract';

const GRADE_CLIPBOARD_MEDIA_TYPE = 'application/vnd.lighttable.grade-clipboard';
const MAX_RECIPE_BYTES = 2 * 1024 * 1024;
const MAX_LOOK_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_OVERHEAD_BYTES = 64;

type DispatchFailure = {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};
type DispatchSuccess = { readonly ok: true; readonly value: unknown; readonly mutated?: boolean };
type DispatchResult = DispatchSuccess | DispatchFailure;

export interface GradeClipboardArtifactStore {
  register(file: File, kind: 'grade-clipboard'): LightTableArtifactMetadata;
  query(id: string): LightTableArtifactMetadata | null;
  resolve(id: string): File | null;
}

const safeName = (name: string) => {
  const normalized = name.trim().replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\\/:*?"<>|]/gu, '-').slice(0, 255).trim();
  return normalized || 'Copied grade';
};

/**
 * Owns the session-scoped Grade recipe artifact. The bounded registry File is
 * the opaque transport package; its parsed recipe and LUT Blob stay in a
 * WeakMap so neither is inlined into command JSON, recorded Actions or MCP
 * calls. Explicit artifact transfer remains a separate bounded operation.
 */
export class SemanticGradeClipboardCommandHandler {
  private readonly captures = new WeakMap<File, LightTableGradeClipboardCapture>();

  constructor(private readonly artifacts: GradeClipboardArtifactStore) {}

  register(capture: LightTableGradeClipboardCapture,
    options: { readonly requireCompleteLook?: boolean } = {}): LightTableArtifactMetadata {
    const name = safeName(capture.name);
    const settings = gradeClipboardSettings(capture.settings);
    const look = capture.gradeLookAsset;
    if (options.requireCompleteLook && settings.gradeLook.assetId && !look) {
      throw new Error('The active Grade Look could not be captured with its LUT bytes.');
    }
    if (look && (look.assetId !== settings.gradeLook.assetId
      || look.source.size < 1 || look.source.size > MAX_LOOK_BYTES)) {
      throw new Error('The copied Grade Look is missing, mismatched or exceeds 32 MiB.');
    }
    const header = JSON.stringify({
      type: 'lighttable-grade-clipboard',
      version: 1,
      name,
      settings,
      gradeLookAsset: look ? {
        assetId: look.assetId,
        name: safeName(look.name),
        byteLength: look.source.size
      } : null
    });
    const headerBytes = new TextEncoder().encode(header).byteLength;
    if (headerBytes < 1 || headerBytes > MAX_RECIPE_BYTES) {
      throw new Error('The copied Grade recipe exceeds the 2 MiB recipe limit.');
    }
    // The package is a real bounded binary artifact: a one-line JSON manifest
    // followed by raw LUT bytes. No Base64 expansion or filesystem path occurs.
    const file = new File(
      [`LTGRADE1\n${header}\n`, ...(look ? [look.source] : [])],
      `${name}.ltgrade-clipboard`,
      { type: GRADE_CLIPBOARD_MEDIA_TYPE }
    );
    const stored: LightTableGradeClipboardCapture = {
      name,
      settings: cloneAdjustments(settings),
      ...(look ? { gradeLookAsset: {
        assetId: look.assetId,
        name: safeName(look.name),
        source: look.source
      } } : {})
    };
    const artifact = this.artifacts.register(file, 'grade-clipboard');
    this.captures.set(file, stored);
    return artifact;
  }

  async dispatch(
    command: 'grade.copy' | 'grade.paste',
    parameters: unknown,
    documentId: DocumentSessionId,
    ports: LightTableCommandPorts
  ): Promise<DispatchResult> {
    return command === 'grade.copy'
      ? this.copy(parameters, documentId, ports)
      : this.paste(parameters, documentId, ports);
  }

  private async copy(parameters: unknown, documentId: DocumentSessionId,
    ports: LightTableCommandPorts): Promise<DispatchResult> {
    const command = parseSemanticCopyGradeCommand(parameters);
    if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
    if (!ports.copyGrade) return { ok: false, code: 'command-unavailable',
      message: 'Copy Grade is unavailable in the target document.' };
    try {
      const capture = await ports.copyGrade(documentId);
      if (!capture) return { ok: false, code: 'command-unavailable',
        message: 'The current Global Grade could not be copied.' };
      const artifact = this.register(capture, { requireCompleteLook: true });
      return { ok: true, value: {
        name: safeName(capture.name),
        hasLookAsset: Boolean(capture.gradeLookAsset),
        artifact
      } };
    } catch (reason) {
      return { ok: false, code: 'execution-failed',
        message: reason instanceof Error ? reason.message : String(reason) };
    }
  }

  private async paste(parameters: unknown, documentId: DocumentSessionId,
    ports: LightTableCommandPorts): Promise<DispatchResult> {
    const command = parseSemanticPasteGradeCommand(parameters);
    if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
    if (!ports.pasteGrade) return { ok: false, code: 'command-unavailable',
      message: 'Paste Grade is unavailable in the target document.' };
    const metadata = this.artifacts.query(command.artifactId);
    const file = this.artifacts.resolve(command.artifactId);
    const capture = file ? this.captures.get(file) : undefined;
    if (!file || metadata?.kind !== 'grade-clipboard' || !capture) {
      return { ok: false, code: 'command-unavailable',
        message: 'The Grade clipboard artifact does not exist in this session.' };
    }
    if (file.type !== GRADE_CLIPBOARD_MEDIA_TYPE || file.size < 1
      || file.size > MAX_RECIPE_BYTES + MAX_LOOK_BYTES + MAX_PACKAGE_OVERHEAD_BYTES) {
      return { ok: false, code: 'invalid-parameters',
        message: 'The Grade clipboard artifact exceeds its bounded format.' };
    }
    try {
      const result = await ports.pasteGrade(documentId, {
        name: capture.name,
        settings: cloneAdjustments(capture.settings),
        ...(capture.gradeLookAsset ? { gradeLookAsset: capture.gradeLookAsset } : {})
      });
      if (!result) return { ok: false, code: 'execution-failed',
        message: 'The copied Grade could not be pasted.' };
      return { ok: true, value: result, mutated: result.changed };
    } catch (reason) {
      return { ok: false, code: 'execution-failed',
        message: reason instanceof Error ? reason.message : String(reason) };
    }
  }
}
