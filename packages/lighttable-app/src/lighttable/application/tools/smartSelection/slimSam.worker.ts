/// <reference lib="webworker" />

import {
  AutoProcessor,
  RawImage,
  SamModel,
  Sam2Model,
  VitMatteForImageMatting,
  type ProgressInfo,
  type Tensor
} from '@huggingface/transformers';
import type { SlimSamWorkerRequest, SlimSamWorkerResponse } from './slimSamProtocol';
import { rankSubjectMask } from './smartSubjectRanking';
import { SAM2_SMALL_PROFILE, SLIMSAM_PROFILE } from './smartSelectionModels';
import { selectionMaskFromLogits } from './smartSelectionMask';
import { refineMatteFromLogits, type MatteRefinementQuality } from './matteRefinement';
import {
  refineMatteWithNeuralRuntime,
  type NeuralMatteModelPort,
  type NeuralMatteProcessorPort
} from './neuralMatteRefinement';

type ModelProfile = 'slimsam' | 'sam2-small';

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
  readonly embeddings: Record<string, Tensor>;
}

interface SamOutputPort {
  readonly pred_masks: Tensor;
  readonly iou_scores: Tensor;
  readonly object_score_logits?: Tensor;
}

interface SamModelPort {
  get_image_embeddings(inputs: { pixel_values: Tensor }): Promise<Record<string, Tensor>>;
  _call(inputs: Record<string, unknown>): Promise<SamOutputPort>;
  dispose(): Promise<void>;
}

type SamProcessorPort = ((image: RawImage, prompts?: Record<string, unknown>) => Promise<SamInputs>) & {
  post_process_masks(
    masks: Tensor,
    originalSizes: readonly [number, number][],
    reshapedInputSizes: readonly [number, number][],
    options: { binarize: boolean }
  ): Promise<Tensor[]>;
};

let model: SamModelPort | null = null;
let processor: SamProcessorPort | null = null;
let backend: 'webgpu' | 'wasm' | null = null;
let activeProfile: ModelProfile | null = null;
let prepared: PreparedState | null = null;
let latestPromptRequestId = 0;
let operationChain: Promise<void> = Promise.resolve();
let matteModel: NeuralMatteModelPort | null = null;
let matteProcessor: NeuralMatteProcessorPort | null = null;

const VITMATTE_MODEL = {
  id: 'Xenova/vitmatte-small-distinctions-646',
  revision: '358d428c452e5e0cd52955011a8b51944731d28e'
} as const;

const disposePrepared = () => {
  for (const embedding of Object.values(prepared?.embeddings ?? {})) embedding.dispose();
  prepared = null;
};

const status = (requestId: number, message: string, progress?: number) => self.postMessage({
  type: 'status', requestId, status: 'preparing', message, progress
});

const metric = (
  requestId: number,
  phase: Extract<SlimSamWorkerResponse, { type: 'metric' }>['phase'],
  startedAt: number
) => self.postMessage({
  type: 'metric', requestId, phase, durationMs: performance.now() - startedAt,
  backend: backend ?? undefined
});

const loadRuntime = async (requestId: number, profile: ModelProfile): Promise<{ model: SamModelPort; processor: SamProcessorPort }> => {
  if (model && processor) return { model, processor };
  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'fp32' | 'q8' }> = [];
  if (profile === 'sam2-small') {
    if ('gpu' in navigator) attempts.push({ device: 'webgpu', dtype: 'fp16' });
  } else {
    if ('gpu' in navigator) attempts.push(
      { device: 'webgpu', dtype: 'fp16' },
      { device: 'webgpu', dtype: 'fp32' }
    );
    attempts.push({ device: 'wasm', dtype: 'q8' }, { device: 'wasm', dtype: 'fp32' });
  }
  if (attempts.length === 0) {
    throw new Error('SAM 2.1 Small FP16 requires WebGPU; the balanced backend will use its SlimSAM fallback.');
  }
  let lastError: unknown = null;
  for (const attempt of attempts) {
    const startedAt = performance.now();
    try {
      status(requestId, `Loading Object Selection on ${attempt.device === 'webgpu' ? 'WebGPU' : 'CPU'}…`);
      const progress_callback = (event: ProgressInfo) => status(
        requestId,
        'file' in event ? `Loading ${event.file}` : 'Loading Object Selection…',
        'progress' in event && typeof event.progress === 'number'
          ? Math.max(0, Math.min(100, event.progress))
          : undefined
      );
      const selected = profile === 'sam2-small' ? SAM2_SMALL_PROFILE : SLIMSAM_PROFILE;
      const Model = profile === 'sam2-small' ? Sam2Model : SamModel;
      const [rawModel, rawProcessor] = await Promise.all([
        Model.from_pretrained(selected.modelId, {
          revision: selected.artifactRevision,
          device: attempt.device,
          dtype: profile === 'sam2-small' ? 'fp16' : attempt.dtype,
          progress_callback
        }),
        AutoProcessor.from_pretrained(selected.modelId, {
          revision: selected.artifactRevision, progress_callback
        })
      ]);
      const createdModel = rawModel as unknown as SamModelPort;
      const createdProcessor = rawProcessor as unknown as SamProcessorPort;
      model = createdModel;
      processor = createdProcessor;
      backend = attempt.device;
      activeProfile = profile;
      metric(requestId, 'model-load', startedAt);
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

const loadMatteRuntime = async (requestId: number) => {
  if (matteModel && matteProcessor) return { model: matteModel, processor: matteProcessor };
  const startedAt = performance.now();
  status(requestId, 'Loading local edge-refinement model…');
  try {
    const progress_callback = (event: ProgressInfo) => status(
      requestId,
      'file' in event ? `Loading ${event.file}` : 'Loading local edge-refinement model…',
      'progress' in event && typeof event.progress === 'number'
        ? Math.max(0, Math.min(100, event.progress)) : undefined
    );
    const device = 'gpu' in navigator ? 'webgpu' : 'wasm';
    const [createdModel, createdProcessor] = await Promise.all([
      VitMatteForImageMatting.from_pretrained(VITMATTE_MODEL.id, {
        revision: VITMATTE_MODEL.revision,
        device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback
      }),
      AutoProcessor.from_pretrained(VITMATTE_MODEL.id, {
        revision: VITMATTE_MODEL.revision,
        progress_callback
      })
    ]);
    matteModel = createdModel as unknown as NeuralMatteModelPort;
    matteProcessor = createdProcessor as unknown as NeuralMatteProcessorPort;
    metric(requestId, 'matte-model-load', startedAt);
    return { model: matteModel, processor: matteProcessor };
  } catch (reason) {
    matteModel = null;
    matteProcessor = null;
    const detail = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`The local edge-refinement model is unavailable (${detail}). Choose Fast quality or retry the model download.`);
  }
};

const prepareSource = async (request: Extract<SlimSamWorkerRequest, { type: 'prepare' }>) => {
  if (prepared?.sourceId === request.sourceId && prepared.revision === request.revision) {
    return prepared;
  }
  const profile = request.profile ?? 'slimsam';
  if (activeProfile && activeProfile !== profile) throw new Error('The selection worker model profile cannot change while active.');
  const runtime = await loadRuntime(request.requestId, profile);
  status(request.requestId, `Preparing image on ${backend === 'webgpu' ? 'WebGPU' : 'CPU'}…`);
  const imageDecodeStartedAt = performance.now();
  const image = await RawImage.fromBlob(request.image);
  metric(request.requestId, 'image-decode', imageDecodeStartedAt);
  const preprocessStartedAt = performance.now();
  const inputs = await processImage(runtime.processor, image);
  metric(request.requestId, 'image-preprocess', preprocessStartedAt);
  const encodeStartedAt = performance.now();
  const embeddings = await runtime.model.get_image_embeddings({ pixel_values: inputs.pixel_values });
  metric(request.requestId, 'image-encode', encodeStartedAt);
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

interface DecodedCandidate {
  readonly score: number;
  readonly data: Uint8Array;
}

const decodePrompt = async (
  runtime: { model: SamModelPort; processor: SamProcessorPort },
  prompts: Record<string, unknown>,
  maximumCandidates = 3
) => {
  if (!prepared) throw new Error('The prepared Object Selection source is no longer available.');
  const preprocessStartedAt = performance.now();
  const inputs = await processImage(runtime.processor, prepared.image, prompts);
  metric(0, 'prompt-preprocess', preprocessStartedAt);
  const { pixel_values, original_sizes, reshaped_input_sizes, ...promptInputs } = inputs;
  try {
    const decodeStartedAt = performance.now();
    const outputs = await runtime.model._call({ ...promptInputs, ...prepared.embeddings });
    metric(0, 'prompt-decode', decodeStartedAt);
    try {
      const postprocessStartedAt = performance.now();
      const masks = await runtime.processor.post_process_masks(
        outputs.pred_masks,
        original_sizes,
        reshaped_input_sizes,
        { binarize: false }
      ) as Tensor[];
      metric(0, 'mask-postprocess', postprocessStartedAt);
      try {
        const first = masks[0];
        if (!first) throw new Error('Object Selection produced no mask.');
        const width = first.dims[first.dims.length - 1];
        const height = first.dims[first.dims.length - 2];
        const pixels = width * height;
        const scores = Array.from(outputs.iou_scores.data as ArrayLike<number>);
        const channels = Math.min(scores.length, Math.floor(first.data.length / pixels));
        const rankedChannels = Array.from({ length: channels }, (_, channel) => channel)
          .sort((left, right) => (scores[right] ?? 0) - (scores[left] ?? 0));
        return {
          width,
          height,
          candidates: rankedChannels.slice(0, maximumCandidates).map((channel): DecodedCandidate => ({
            score: scores[channel] ?? 0,
            data: selectionMaskFromLogits(
              first.data as ArrayLike<number>, channel * pixels, width, height, true
            )
          }))
        };
      } finally {
        for (const mask of masks) mask.dispose();
      }
    } finally {
      outputs.pred_masks.dispose();
      outputs.iou_scores.dispose();
      outputs.object_score_logits?.dispose();
    }
  } finally {
    pixel_values.dispose();
    inputs.input_points?.dispose();
    inputs.input_labels?.dispose();
    inputs.input_boxes?.dispose();
  }
};

const binaryMaskAsLogits = (mask: Uint8Array) => {
  const logits = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    logits[index] = mask[index] >= 128 ? 8 : -8;
  }
  return logits;
};

/**
 * Refinement is deliberately applied only after prompt candidates have been ranked.
 * Select Subject evaluates nine prompts; refining inside decodePrompt would run the
 * expensive matte model up to 27 times and make the interaction appear stalled.
 */
const refineWinningCandidate = async (
  requestId: number,
  candidate: DecodedCandidate,
  width: number,
  height: number,
  quality: MatteRefinementQuality
): Promise<DecodedCandidate> => {
  if (!prepared) throw new Error('The prepared Object Selection source is no longer available.');
  const logits = binaryMaskAsLogits(candidate.data);
  if (quality === 'fast') {
    return {
      ...candidate,
      data: refineMatteFromLogits(logits, 0, width, height, prepared.image, quality)
    };
  }
  const matteRuntime = await loadMatteRuntime(requestId);
  if (requestId !== latestPromptRequestId) return candidate;
  const matteStartedAt = performance.now();
  const data = await refineMatteWithNeuralRuntime(
    matteRuntime, logits, 0, width, height, prepared.image, quality
  );
  metric(requestId, 'matte-inference', matteStartedAt);
  return { ...candidate, data };
};

const select = async (
  request: Extract<SlimSamWorkerRequest, { type: 'points' | 'box' | 'subject' }>
) => {
  if (!prepared || prepared.sourceId !== request.sourceId) {
    throw new Error('The prepared Object Selection source is no longer available.');
  }
  if (!activeProfile) throw new Error('The selection model was not prepared.');
  const runtime = await loadRuntime(request.requestId, activeProfile);
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
        });
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
    const prompts = request.type === 'points'
      ? {
          input_points: [[request.points]],
          input_labels: [[request.labels]],
          ...(request.box ? { input_boxes: [[request.box]] } : {})
        }
      : { input_boxes: [[request.box]] };
    // Normal pointer/box interaction only consumes the best candidate. Keeping
    // the mask document-sized preserves quality while avoiding two redundant
    // full-resolution JS conversions and worker transfers per pointer update.
    const decoded = await decodePrompt(runtime, prompts, 1);
    width = decoded.width;
    height = decoded.height;
    results = decoded.candidates;
  }
  if (request.refineEdges && results[0]) {
    results[0] = await refineWinningCandidate(
      request.requestId, results[0], width, height, request.refinementQuality
    );
  }
  if (request.requestId !== latestPromptRequestId) {
    self.postMessage({ type: 'superseded', requestId: request.requestId });
    return;
  }
  const transfers = results.map((result) => result.data.buffer);
  self.postMessage({
    type: 'candidates', requestId: request.requestId, sourceId: request.sourceId,
    width, height, masks: transfers, scores: results.map((result) => result.score)
  }, { transfer: transfers });
};

self.onmessage = (event: MessageEvent<SlimSamWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'points' || request.type === 'box' || request.type === 'subject') {
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
    await (matteModel as { dispose?: () => Promise<void> } | null)?.dispose?.();
    model = null;
    processor = null;
    matteModel = null;
    matteProcessor = null;
      backend = null;
      activeProfile = null;
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
