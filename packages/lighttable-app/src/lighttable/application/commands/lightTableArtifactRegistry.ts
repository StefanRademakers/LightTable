import type { PsdExportCompatibilityFinding } from '../documents/psdExportProtocol';

export type LightTableArtifactKind =
  | 'input' | 'native-document' | 'png-export' | 'jpeg-export' | 'webp-export'
  | 'tiff-export' | 'psd-export' | 'render-preview'
  | 'svg-export'
  | 'pixel-clipboard' | 'grade-clipboard';

export interface LightTablePreviewArtifactContext {
  readonly documentId: string;
  readonly canonicalRevision: number;
  readonly width: number;
  readonly height: number;
  readonly maxEdge: number;
  readonly format?: 'png' | 'webp';
  readonly quality?: number;
  readonly target?: {
    readonly kind: 'layer';
    readonly layerId: string;
    readonly channel: 'pixels' | 'mask';
    readonly sourceToOutput: {
      readonly a: number; readonly b: number; readonly c: number;
      readonly d: number; readonly tx: number; readonly ty: number;
    };
  } | {
    readonly kind: 'region';
    readonly coordinateSpace: 'document-px';
    readonly bounds: { readonly x: number; readonly y: number;
      readonly width: number; readonly height: number };
  };
}

export interface LightTableArtifactMetadata {
  readonly id: string;
  readonly kind: LightTableArtifactKind;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly createdAt: number;
  readonly compatibilityFindings?: readonly PsdExportCompatibilityFinding[];
  readonly preview?: LightTablePreviewArtifactContext;
}

interface ArtifactRecord {
  readonly metadata: LightTableArtifactMetadata;
  readonly file: File;
}

export interface LightTableArtifactRegistryOptions {
  readonly maximumArtifacts?: number;
  readonly maximumArtifactBytes?: number;
  readonly maximumTotalBytes?: number;
}

/**
 * Bounded in-process storage for command payloads. Public command/query
 * contracts only carry opaque ids and metadata; Blob/File ownership stays at
 * the host boundary and never enters JSON, IPC or a future MCP result.
 */
export class LightTableArtifactRegistry {
  private readonly maximumArtifacts: number;
  private readonly maximumArtifactBytes: number;
  private readonly maximumTotalBytes: number;
  private readonly records = new Map<string, ArtifactRecord>();
  private totalBytes = 0;
  private sequence = 0;

  constructor(options: LightTableArtifactRegistryOptions = {}) {
    this.maximumArtifacts = options.maximumArtifacts ?? 32;
    this.maximumArtifactBytes = options.maximumArtifactBytes ?? 512 * 1024 * 1024;
    this.maximumTotalBytes = options.maximumTotalBytes ?? 512 * 1024 * 1024;
  }

  register(
    file: File,
    kind: LightTableArtifactKind,
    compatibilityFindings: readonly PsdExportCompatibilityFinding[] = []
  ): LightTableArtifactMetadata {
    if (file.size > this.maximumArtifactBytes) {
      throw new Error(`Artifact exceeds the ${this.maximumArtifactBytes}-byte limit.`);
    }
    this.makeRoom(file.size);
    const metadata: LightTableArtifactMetadata = Object.freeze({
      id: `artifact-${Date.now()}-${++this.sequence}`,
      kind,
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      byteLength: file.size,
      createdAt: Date.now(),
      ...(compatibilityFindings.length
        ? { compatibilityFindings: structuredClone(compatibilityFindings) }
        : {})
    });
    this.records.set(metadata.id, { metadata, file });
    this.totalBytes += file.size;
    return metadata;
  }

  registerPreview(file: File, preview: LightTablePreviewArtifactContext): LightTableArtifactMetadata {
    if (file.size > this.maximumArtifactBytes) {
      throw new Error(`Artifact exceeds the ${this.maximumArtifactBytes}-byte limit.`);
    }
    this.makeRoom(file.size);
    const metadata: LightTableArtifactMetadata = Object.freeze({
      id: `artifact-${Date.now()}-${++this.sequence}`,
      kind: 'render-preview',
      name: file.name,
      mediaType: file.type || 'image/png',
      byteLength: file.size,
      createdAt: Date.now(),
      preview: Object.freeze({ ...preview })
    });
    this.records.set(metadata.id, { metadata, file });
    this.totalBytes += file.size;
    return metadata;
  }

  query(id: string): LightTableArtifactMetadata | null {
    return this.records.get(id)?.metadata ?? null;
  }

  list(): readonly LightTableArtifactMetadata[] {
    return [...this.records.values()].map(({ metadata }) => metadata);
  }

  resolve(id: string): File | null {
    return this.records.get(id)?.file ?? null;
  }

  release(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    this.totalBytes -= record.file.size;
    return this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
    this.totalBytes = 0;
  }

  private makeRoom(byteLength: number): void {
    if (byteLength > this.maximumTotalBytes) {
      throw new Error(`Artifact exceeds the ${this.maximumTotalBytes}-byte registry budget.`);
    }
    while (this.records.size >= this.maximumArtifacts
      || this.totalBytes + byteLength > this.maximumTotalBytes) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.release(oldest);
    }
  }
}
