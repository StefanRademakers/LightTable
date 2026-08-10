/// <reference lib="webworker" />

import {
  AutoProcessor,
  RawImage,
  SamModel,
  type ProgressInfo,
  type Tensor
} from '@huggingface/transformers';
import type { SlimSamWorkerRequest } from './slimSamProtocol';
import { rankSubjectMask } from './smartSubjectRanking';

const MODEL_ID = 'Xenova/slimsam-77-uniform';

interface SamInputs {
  readonly pixel_values: Tensor;
  readonly original_sizes: readonly [number, number][];
  readonly reshaped_input_sizes: readonly [number, number][];
  readonly input_points?: Tensor;
  readonly input_labels?: Tensor;
  readonly input_boxes?: Tensor;
  readonly [key: string]: unknown;
}

interface PreparedState {
  readonly sourceId: string;
  readonly revision: number;
  readonly image: RawImage;
  readonly width: number;
  readonly height: number;
  readonly embeddings: {
    readonly image_embeddings: Tensor;
    readonly image_positional_embeddings: Tensor;
  };
}

type SamProcessorPort = ((image: RawImage, prompts?: Record<string, unknown>) => Promise<SamInputs>) & {
  post_process_masks(
    masks: Tensor,
    originalSizes: readonly [number, number][],
    reshapedInputSizes: readonly [number, number][],
    options: { binarize: boolean }
  ): Promise<Tensor[]>;
};

let model: SamModel | null = null;
let processor: SamProcessorPort | null = null;
let backend: 'webgpu' | 'wasm' | null = null;
let prepared: PreparedState | null = null;
let latestPromptRequestId = 0;
let operationChain: Promise<void> = Promise.resolve();

const disposePrepared = () => {
  prepared?.embeddings.image_embeddings.dispose();
  prepared?.embeddings.image_positional_embeddings.dispose();
  prepared = null;
};

const status = (requestId: number, message: string, progress?: number) => self.postMessage({
  type: 'status', requestId, status: 'preparing', message, progress
});

const loadRuntime = async (requestId: number): Promise<{ model: SamModel; processor: SamProcessorPort }> => {
  if (model && processor) return { model, processor };
  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'fp32' | 'q8' }> = [];
  if ('gpu' in navigator) attempts.push(
    { device: 'webgpu', dtype: 'fp16' },
    { device: 'webgpu', dtype: 'fp32' }
  );
  attempts.push({ device: 'wasm', dtype: 'q8' }, { device: 'wasm', dtype: 'fp32' });
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      status(requestId, `Loading Object Selection on ${attempt.device === 'webgpu' ? 'WebGPU' : 'CPU'}…`);
      const progress_callback = (event: ProgressInfo) => status(
        requestId,
        'file' in event ? `Loading ${event.file}` : 'Loading Object Selection…',
        'progress' in event && typeof event.progress === 'number'
          ? Math.max(0, Math.min(100, event.progress))
          : undefined
      );
      const [rawModel, rawProcessor] = await Promise.all([
        SamModel.from_pretrained(MODEL_ID, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback
        }),
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
      ]);
      const createdModel = rawModel as unknown as SamModel;
      const createdProcessor = rawProcessor as unknown as SamProcessorPort;
      model = createdModel;
      processor = createdProcessor;
      backend = attempt.device;
      return { model, processor };
    } catch (reason) {
      lastError = reason;
      await model?.dispose();
      model = null;
      processor = null;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Object Selection could not initialize.');
};

const processImage = async (
  activeProcessor: SamProcessorPort,
  image: RawImage,
  prompts?: Record<string, unknown>
) => await activeProcessor(image, prompts);

const prepareSource = async (request: Extract<SlimSamWorkerRequest, { type: 'prepare' }>) => {
  if (prepared?.sourceId === request.sourceId && prepared.revision === request.revision) {
    return prepared;
  }
  const runtime = await loadRuntime(request.requestId);
  status(request.requestId, `Preparing image on ${backend === 'webgpu' ? 'WebGPU' : 'CPU'}…`);
  const image = await RawImage.fromBlob(request.image);
  const inputs = await processImage(runtime.processor, image);
  const embeddings = await runtime.model.get_image_embeddings({ pixel_values: inputs.pixel_values });
  inputs.pixel_values.dispose();
  disposePrepared();
  prepared = {
    sourceId: request.sourceId,
    revision: request.revision,
    image,
    width: image.width,
    height: image.height,
    embeddings
  };
  return prepared;
};

const alphaMask = (
  logits: ArrayLike<number>,
  offset: number,
  length: number,
  hardEdge: boolean
) => {
  const output = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = logits[offset + index] ?? -100;
    output[index] = hardEdge
      ? value > 0 ? 255 : 0
      : Math.round(255 / (1 + Math.exp(-Math.max(-12, Math.min(12, value)))));
  }
  return output;
};

interface DecodedCandidate {
  readonly score: number;
  readonly data: Uint8Array;
}

const decodePrompt = async (
  runtime: { model: SamModel; processor: SamProcessorPort },
  prompts: Record<string, unknown>,
  hardEdge: boolean
) => {
  if (!prepared) throw new Error('The prepared Object Selection source is no longer available.');
  const inputs = await processImage(runtime.processor, prepared.image, prompts);
  const { pixel_values, original_sizes, reshaped_input_sizes, ...promptInputs } = inputs;
  try {
    const outputs = await runtime.model({ ...promptInputs, ...prepared.embeddings });
    try {
      const masks = await runtime.processor.post_process_masks(
        outputs.pred_masks,
        original_sizes,
        reshaped_input_sizes,
        { binarize: false }
      ) as Tensor[];
      try {
        const first = masks[0];
        if (!first) throw new Error('Object Selection produced no mask.');
        const width = first.dims[first.dims.length - 1];
        const height = first.dims[first.dims.length - 2];
        const pixels = width * height;
        const scores = Array.from(outputs.iou_scores.data as ArrayLike<number>);
        const channels = Math.min(scores.length, Math.floor(first.data.length / pixels));
        const ranked = Array.from({ length: channels }, (_, index) => index)
          .sort((left, right) => (scores[right] ?? 0) - (scores[left] ?? 0));
        return {
          width,
          height,
          candidates: ranked.map((channel): DecodedCandidate => ({
            score: scores[channel] ?? 0,
            data: alphaMask(first.data as ArrayLike<number>, channel * pixels, pixels, hardEdge)
          }))
        };
      } finally {
        for (const mask of masks) mask.dispose();
      }
    } finally {
      outputs.pred_masks.dispose();
      outputs.iou_scores.dispose();
    }
  } finally {
    pixel_values.dispose();
    inputs.input_points?.dispose();
    inputs.input_labels?.dispose();
    inputs.input_boxes?.dispose();
  }
};

const select = async (
  request: Extract<SlimSamWorkerRequest, { type: 'point' | 'box' | 'subject' }>
) => {
  if (!prepared || prepared.sourceId !== request.sourceId) {
    throw new Error('The prepared Object Selection source is no longer available.');
  }
  const runtime = await loadRuntime(request.requestId);
  let width = prepared.width;
  let height = prepared.height;
  let results: DecodedCandidate[];
  if (request.type === 'subject') {
    const proposals: DecodedCandidate[] = [];
    const positions = [0.22, 0.5, 0.78];
    for (const y of positions) {
      for (const x of positions) {
        const decoded = await decodePrompt(runtime, {
          input_points: [[[x * prepared.width, y * prepared.height]]]
        }, request.hardEdge);
        width = decoded.width;
        height = decoded.height;
        proposals.push(...decoded.candidates);
      }
    }
    results = proposals
      .map((candidate) => ({ ...candidate, score: rankSubjectMask(candidate, width, height) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
  } else {
    const prompts = request.type === 'point'
      ? { input_points: [[[request.point[0], request.point[1]]]] }
      : { input_boxes: [[[request.box[0], request.box[1], request.box[2], request.box[3]]]] };
    const decoded = await decodePrompt(runtime, prompts, request.hardEdge);
    width = decoded.width;
    height = decoded.height;
    results = decoded.candidates;
  }
  const transfers = results.map((result) => result.data.buffer);
  self.postMessage({
    type: 'candidates', requestId: request.requestId, sourceId: request.sourceId,
    width, height, masks: transfers, scores: results.map((result) => result.score)
  }, { transfer: transfers });
};

self.onmessage = (event: MessageEvent<SlimSamWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'point' || request.type === 'box' || request.type === 'subject') {
    latestPromptRequestId = request.requestId;
  }
  operationChain = operationChain.catch(() => undefined).then(async () => {
    if (request.type === 'dispose-source') {
      if (prepared?.sourceId === request.sourceId) disposePrepared();
      return;
    }
    if (request.type === 'dispose') {
      disposePrepared();
      await model?.dispose();
      model = null;
      processor = null;
      backend = null;
      return;
    }
    if (request.type === 'prepare') {
      const state = await prepareSource(request);
      self.postMessage({
        type: 'prepared', requestId: request.requestId, sourceId: state.sourceId,
        revision: state.revision, width: state.width, height: state.height
      });
      return;
    }
    if (request.requestId !== latestPromptRequestId) {
      self.postMessage({ type: 'superseded', requestId: request.requestId });
      return;
    }
    await select(request);
  }).catch((reason: unknown) => {
    if (!('requestId' in request)) return;
    self.postMessage({
      type: 'error', requestId: request.requestId,
      message: reason instanceof Error ? reason.message : 'Object Selection failed.'
    });
  });
};

export {};
