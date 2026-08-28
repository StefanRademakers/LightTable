import type {
  GenAiAssetPayload,
  GenAiAssetReference,
  GenAiGenerationRequest
} from '@lighttable/genai-core';
import type {
  LocalAiBinaryInput,
  LocalAiImageJobRequestV1,
  LocalAiJobResultV1,
  LocalAiJobStatusV1
} from '@lighttable/genai-local';
import { LocalAiConnectionController } from './localAiConnectionController';

export interface LocalAiResolvedInput {
  readonly reference: GenAiAssetReference;
  readonly payload: GenAiAssetPayload;
}

/**
 * Provider-specific request conversion for the standalone local service.
 *
 * This class deliberately knows nothing about projects, React, Agent Access or
 * MCP. The desktop generation coordinator resolves durable assets before
 * calling it and stores returned bytes afterwards.
 */
export class LocalAiGenerationController {
  constructor(private readonly connection: LocalAiConnectionController) {}

  async submit(
    request: GenAiGenerationRequest,
    resolved: readonly LocalAiResolvedInput[]
  ): Promise<LocalAiJobStatusV1> {
    const { request: localRequest, inputs } = buildLocalAiRequest(request, resolved);
    return this.connection.clientInstance().submit(localRequest, inputs);
  }

  status(providerJobId: string, signal?: AbortSignal): Promise<LocalAiJobStatusV1> {
    return signal
      ? this.connection.clientInstance().status(providerJobId, signal)
      : this.connection.clientInstance().status(providerJobId);
  }

  async result(providerJobId: string, signal?: AbortSignal): Promise<{
    readonly metadata: LocalAiJobResultV1;
    readonly images: readonly { readonly bytes: Uint8Array; readonly mediaType: string; readonly width: number; readonly height: number }[];
  }> {
    const metadata = await (signal
      ? this.connection.clientInstance().result(providerJobId, signal)
      : this.connection.clientInstance().result(providerJobId));
    const images = await Promise.all(metadata.images.map(async (image, index) => ({
      bytes: await (signal
        ? this.connection.clientInstance().downloadResult(metadata, index, signal)
        : this.connection.clientInstance().downloadResult(metadata, index)),
      mediaType: image.mimeType,
      width: image.width,
      height: image.height
    })));
    return { metadata, images };
  }

  cancel(providerJobId: string): Promise<LocalAiJobStatusV1> {
    return this.connection.clientInstance().cancel(providerJobId);
  }
}

export const buildLocalAiRequest = (
  request: GenAiGenerationRequest,
  resolved: readonly LocalAiResolvedInput[]
): { readonly request: LocalAiImageJobRequestV1; readonly inputs: readonly LocalAiBinaryInput[] } => {
  const operation = request.operation
    ?? (request.workflowId.endsWith(':image.create') ? 'image.create' : 'image.edit');
  if (operation !== 'image.create' && operation !== 'image.edit' && operation !== 'image.inpaint') {
    throw new Error(`Local AI does not support ${operation} generation.`);
  }
  const dimensions = outputDimensions(request.output?.aspectRatio, request.output?.size);
  const inputById = new Map(resolved.map((entry) => [entry.reference.id, entry]));
  const ordered = request.references.map((reference) => {
    const entry = inputById.get(reference.id);
    if (!entry) throw new Error(`Local AI input ${reference.label} is unavailable.`);
    return entry;
  });
  if (operation !== 'image.create' && !ordered.length) {
    throw new Error('Local image editing requires a base image.');
  }
  const selection = request.selection ? inputById.get(request.selection.assetId) : undefined;
  if (request.selection && !selection) throw new Error('The local AI selection mask is unavailable.');
  const base = operation === 'image.create'
    ? undefined
    : request.baseImageAssetId
      ? inputById.get(request.baseImageAssetId)
      : ordered.find((entry) => entry.reference.id !== request.selection?.assetId);
  if (operation !== 'image.create' && !base) throw new Error('The local AI base image is unavailable.');
  const visualReferences = ordered.filter((entry) => entry !== base && entry !== selection);
  const inputs: LocalAiBinaryInput[] = [];
  const binary = (entry: LocalAiResolvedInput, field: string): LocalAiBinaryInput => ({
    field,
    name: entry.payload.name,
    mediaType: entry.payload.mediaType,
    bytes: entry.payload.bytes
  });
  if (base) inputs.push(binary(base, 'base-image'));
  if (selection) inputs.push(binary(selection, 'selection-mask'));
  visualReferences.forEach((entry, index) => inputs.push(binary(entry, `reference-${index}`)));

  return {
    request: {
      operation,
      intent: request.intent ?? (operation === 'image.create' ? 'general-create' : 'general-edit'),
      modelId: request.modelId,
      prompt: request.providerPrompt || request.prompt,
      output: {
        ...dimensions,
        count: request.output?.count ?? 1,
        mimeType: 'image/png',
        includeAlpha: false
      },
      ...(base ? { baseImage: { field: 'base-image', mimeType: base.payload.mediaType } } : {}),
      ...(selection && request.selection ? {
        selection: {
          mask: { field: 'selection-mask', mimeType: selection.payload.mediaType },
          format: request.selection.format,
          interpretation: request.selection.interpretation,
          ...(request.selection.featherRadiusPx === undefined
            ? {}
            : { featherRadiusPx: request.selection.featherRadiusPx })
        }
      } : {}),
      ...(visualReferences.length ? {
        references: visualReferences.map((entry, index) => ({
          id: entry.reference.id,
          image: { field: `reference-${index}`, mimeType: entry.payload.mediaType },
          role: 'visual' as const
        }))
      } : {}),
      modelSettings: request.fields
    },
    inputs
  };
};

const outputDimensions = (ratio = '1:1', size = '2K'): { readonly width: number; readonly height: number } => {
  const [rawWidth, rawHeight] = ratio.split(':').map(Number);
  const ratioWidth = rawWidth && rawWidth > 0 ? rawWidth : 1;
  const ratioHeight = rawHeight && rawHeight > 0 ? rawHeight : 1;
  const longEdge = size.toLocaleUpperCase('en-US') === '1K' ? 1024 : 2048;
  const scale = longEdge / Math.max(ratioWidth, ratioHeight);
  const multiple = 16;
  return {
    width: Math.max(256, Math.round((ratioWidth * scale) / multiple) * multiple),
    height: Math.max(256, Math.round((ratioHeight * scale) / multiple) * multiple)
  };
};
