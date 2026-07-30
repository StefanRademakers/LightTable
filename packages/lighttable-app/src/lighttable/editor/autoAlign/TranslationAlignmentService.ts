import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix, RasterRenderContract } from '../rendering/renderContract';
import { alignmentSpaceForContracts, chooseBestAlignment } from './alignmentMath';
import {
  DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS,
  type AlignmentCandidateScore,
  type TranslationAlignmentOptions,
  type TranslationAlignmentResult
} from './alignmentTypes';
import {
  ALIGNMENT_GRADIENT_WGSL,
  ALIGNMENT_REPROJECT_WGSL,
  ALIGNMENT_SCORE_TRANSLATION_WGSL
} from './alignmentShaders';

const SCORE_STRIDE = 16;
const CANDIDATE_STRIDE = 32;

interface TransformCandidate {
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  matrix: AffineMatrix;
}

interface ScoredCandidates {
  scores: AlignmentCandidateScore[];
  referenceValidPixels: number;
}

const candidateTransform = (
  width: number,
  height: number,
  dx: number,
  dy: number,
  scale = 1,
  rotation = 0
): TransformCandidate => {
  const centerX = width / 2;
  const centerY = height / 2;
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  return {
    dx,
    dy,
    scale,
    rotation,
    matrix: {
      a: cosine,
      b: sine,
      c: -sine,
      d: cosine,
      tx: centerX + dx - cosine * centerX + sine * centerY,
      ty: centerY + dy - sine * centerX - cosine * centerY
    }
  };
};

const bestUsableScore = (
  scores: AlignmentCandidateScore[],
  referenceValidPixels: number,
  minimumOverlap: number
) => {
  const maximumEvidence = scores.reduce(
    (maximum, score) => Math.max(maximum, score.weightSum),
    0
  );
  if (maximumEvidence <= 1e-8) return null;
  const safeReferenceCount = Math.max(1, referenceValidPixels);
  const ranked = scores
    .filter((score) => {
      const overlap = score.validPixelCount / safeReferenceCount;
      const evidence = score.weightSum / maximumEvidence;
      // Do not let a transform win by matching a tiny, convenient collection
      // of similarly oriented edges while moving most evidence out of view.
      return score.weightSum > 1e-8
        && overlap >= minimumOverlap
        && evidence >= 0.4;
    })
    .map((score) => {
      const overlap = Math.min(1, score.validPixelCount / safeReferenceCount);
      const evidence = Math.min(1, score.weightSum / maximumEvidence);
      return {
        score,
        // Edge-direction error remains the primary objective. The small
        // coverage terms make broad, well-supported matches beat accidental
        // low-error crops in repetitive images.
        rank: score.errorSum / score.weightSum
          + (1 - overlap) * 0.035
          + (1 - evidence) * 0.035
      };
    })
    .sort((left, right) => left.rank - right.rank);
  return ranked[0]?.score ?? null;
};

const uniqueSorted = (values: number[]) => [...new Set(values.map((value) => value.toFixed(8)))]
  .map(Number)
  .sort((left, right) => left - right);

export class TranslationAlignmentService {
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly reprojectPipeline: GPURenderPipeline;
  private readonly gradientPipeline: GPURenderPipeline;
  private readonly scorePipeline: GPUComputePipeline;

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device;
    this.sampler = sampler;
    const fullscreen = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
    this.reprojectPipeline = device.createRenderPipeline({
      label: 'LightTable alignment source reprojection',
      layout: 'auto',
      vertex: { module: fullscreen, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${ALIGNMENT_REPROJECT_WGSL}` }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.gradientPipeline = device.createRenderPipeline({
      label: 'LightTable alignment gradient analysis',
      layout: 'auto',
      vertex: { module: fullscreen, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${ALIGNMENT_GRADIENT_WGSL}` }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.scorePipeline = device.createComputePipeline({
      label: 'LightTable similarity alignment scoring',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: ALIGNMENT_SCORE_TRANSLATION_WGSL }),
        entryPoint: 'main'
      }
    });
  }

  async align(
    reference: RasterRenderContract,
    target: RasterRenderContract,
    suppliedOptions: Partial<TranslationAlignmentOptions> = {},
    signal?: AbortSignal
  ): Promise<TranslationAlignmentResult> {
    const options = { ...DEFAULT_TRANSLATION_ALIGNMENT_OPTIONS, ...suppliedOptions };
    signal?.throwIfAborted();
    const space = alignmentSpaceForContracts(reference, target, options.analysisSize);
    if (!space) throw new Error('The selected layers do not overlap in document space.');
    const analysisPixels = space.analysisWidth * space.analysisHeight;
    if (analysisPixels < 256) throw new Error('The selected layers have too little overlap to align reliably.');

    const maxOffset = Math.max(
      1,
      Math.min(48, Math.ceil(options.maxTranslationPixels / space.documentPixelsPerAnalysisPixel))
    );
    const textureSize: GPUExtent3D = [space.analysisWidth, space.analysisHeight];
    const analysisUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const referenceLuminance = this.device.createTexture({
      label: 'LightTable alignment reference luminance',
      size: textureSize,
      format: 'rgba16float',
      usage: analysisUsage
    });
    const targetLuminance = this.device.createTexture({
      label: 'LightTable alignment target luminance',
      size: textureSize,
      format: 'rgba16float',
      usage: analysisUsage
    });
    const referenceGradient = this.device.createTexture({
      label: 'LightTable alignment reference gradient',
      size: textureSize,
      format: 'rgba16float',
      usage: analysisUsage
    });
    const targetGradient = this.device.createTexture({
      label: 'LightTable alignment target gradient',
      size: textureSize,
      format: 'rgba16float',
      usage: analysisUsage
    });
    const temporaryBuffers: GPUBuffer[] = [];

    try {
      const analysisEncoder = this.device.createCommandEncoder({ label: 'LightTable alignment analysis' });
      this.encodeReproject(analysisEncoder, reference, referenceLuminance, space, temporaryBuffers);
      this.encodeReproject(analysisEncoder, target, targetLuminance, space, temporaryBuffers);
      this.encodeGradient(analysisEncoder, referenceLuminance, referenceGradient);
      this.encodeGradient(analysisEncoder, targetLuminance, targetGradient);
      this.device.queue.submit([analysisEncoder.finish()]);

      // Stage 1: find the broad translation without assuming scale or rotation.
      const translationCandidates: TransformCandidate[] = [];
      for (let dy = -maxOffset; dy <= maxOffset; dy += 1) {
        for (let dx = -maxOffset; dx <= maxOffset; dx += 1) {
          translationCandidates.push(candidateTransform(space.analysisWidth, space.analysisHeight, dx, dy));
        }
      }
      const translation = await this.scoreCandidates(
        referenceGradient,
        targetGradient,
        translationCandidates,
        signal
      );
      const initial = bestUsableScore(
        translation.scores,
        translation.referenceValidPixels,
        Math.min(options.minimumOverlap, 0.15)
      );
      if (!initial) throw new Error('Auto Align could not find enough shared image content.');

      // Stage 2: logarithmic scale search around the broad translation. The
      // default motion model intentionally keeps rotation fixed: an extra
      // degree of freedom can create convincing but false minima in repeated
      // textures. Rotation remains available to an explicit future mode.
      const minimumScale = Math.max(0.25, Math.min(options.minimumScale, options.maximumScale));
      const maximumScale = Math.max(minimumScale, options.maximumScale);
      const scaleSteps = 24;
      const logMinimum = Math.log(minimumScale);
      const logMaximum = Math.log(maximumScale);
      const scales = uniqueSorted([
        1,
        ...Array.from({ length: scaleSteps + 1 }, (_, index) =>
          Math.exp(logMinimum + (logMaximum - logMinimum) * index / scaleSteps)
        )
      ]);
      const maximumRotation = Math.max(0, options.maximumRotationDegrees) * Math.PI / 180;
      const rotationStep = Math.PI / 180;
      const rotationSteps = Math.floor(maximumRotation / rotationStep);
      const rotations = uniqueSorted([
        0,
        ...Array.from(
          { length: rotationSteps * 2 + 1 },
          (_, index) => (index - rotationSteps) * rotationStep
        )
      ]);
      const similarityCandidates = scales.flatMap((scale) => rotations.map((rotation) =>
        candidateTransform(
          space.analysisWidth,
          space.analysisHeight,
          initial.dx,
          initial.dy,
          scale,
          rotation
        )
      ));
      const similarity = await this.scoreCandidates(
        referenceGradient,
        targetGradient,
        similarityCandidates,
        signal
      );
      const coarseSimilarity = bestUsableScore(
        similarity.scores,
        similarity.referenceValidPixels,
        options.minimumOverlap
      ) ?? initial;

      // Stage 3: solve translation again with the selected scale/rotation.
      // A scale mismatch can bias the translation-only starting point by many
      // pixels, so a tiny local refinement here is not sufficient.
      const translationStride = Math.max(1, Math.floor(maxOffset / 24));
      const similarityTranslationCandidates: TransformCandidate[] = [];
      for (let dy = -maxOffset; dy <= maxOffset; dy += translationStride) {
        for (let dx = -maxOffset; dx <= maxOffset; dx += translationStride) {
          similarityTranslationCandidates.push(candidateTransform(
            space.analysisWidth,
            space.analysisHeight,
            dx,
            dy,
            coarseSimilarity.scale ?? 1,
            coarseSimilarity.rotation ?? 0
          ));
        }
      }
      const similarityTranslation = await this.scoreCandidates(
        referenceGradient,
        targetGradient,
        similarityTranslationCandidates,
        signal
      );
      const translatedSimilarity = bestUsableScore(
        similarityTranslation.scores,
        similarityTranslation.referenceValidPixels,
        options.minimumOverlap
      ) ?? coarseSimilarity;

      // Stage 4: refine scale and rotation locally between the coarse samples.
      const coarseLogStep = (logMaximum - logMinimum) / scaleSteps;
      const refinedSimilarityCandidates: TransformCandidate[] = [];
      const refinementRotationOffsets = maximumRotation > 0
        ? [-2, -1, 0, 1, 2].map((index) => index * rotationStep / 4)
        : [0];
      for (let scaleIndex = -2; scaleIndex <= 2; scaleIndex += 1) {
        const scale = Math.max(
          minimumScale,
          Math.min(
            maximumScale,
            (translatedSimilarity.scale ?? 1) * Math.exp(scaleIndex * coarseLogStep / 4)
          )
        );
        for (const rotationOffset of refinementRotationOffsets) {
          const rotation = Math.max(
            -maximumRotation,
            Math.min(maximumRotation, (translatedSimilarity.rotation ?? 0) + rotationOffset)
          );
          refinedSimilarityCandidates.push(candidateTransform(
            space.analysisWidth,
            space.analysisHeight,
            translatedSimilarity.dx,
            translatedSimilarity.dy,
            scale,
            rotation
          ));
        }
      }
      const refinedSimilarity = await this.scoreCandidates(
        referenceGradient,
        targetGradient,
        refinedSimilarityCandidates,
        signal
      );
      const similarityBest = bestUsableScore(
        refinedSimilarity.scores,
        refinedSimilarity.referenceValidPixels,
        options.minimumOverlap
      ) ?? translatedSimilarity;

      // Stage 5: subpixel translation refinement with the selected similarity.
      const refinedTranslationCandidates: TransformCandidate[] = [];
      for (let dy = -3; dy <= 3.001; dy += 0.5) {
        for (let dx = -3; dx <= 3.001; dx += 0.5) {
          refinedTranslationCandidates.push(candidateTransform(
            space.analysisWidth,
            space.analysisHeight,
            similarityBest.dx + dx,
            similarityBest.dy + dy,
            similarityBest.scale ?? 1,
            similarityBest.rotation ?? 0
          ));
        }
      }
      const refinedTranslation = await this.scoreCandidates(
        referenceGradient,
        targetGradient,
        refinedTranslationCandidates,
        signal
      );
      const referenceValidPixels = Math.max(
        translation.referenceValidPixels,
        similarity.referenceValidPixels,
        similarityTranslation.referenceValidPixels,
        refinedSimilarity.referenceValidPixels,
        refinedTranslation.referenceValidPixels
      );
      // The final refinement contains the selected model and its local
      // alternatives. Do not reintroduce unrelated coarse candidates here:
      // those were only initialization hypotheses at lower precision.
      const identityScore = translation.scores.find((score) =>
        score.dx === 0
        && score.dy === 0
        && Math.abs((score.scale ?? 1) - 1) < 1e-6
        && Math.abs(score.rotation ?? 0) < 1e-6
      );
      const eligibleScores = [
        ...refinedTranslation.scores,
        ...(identityScore ? [identityScore] : [])
      ];
      const maximumEligibleEvidence = eligibleScores.reduce(
        (maximum, score) => Math.max(maximum, score.weightSum),
        0
      );
      const supportedScores = eligibleScores.filter((score) =>
        score.validPixelCount / Math.max(1, referenceValidPixels) >= options.minimumOverlap
        && (
          maximumEligibleEvidence <= 1e-8
          || score.weightSum / maximumEligibleEvidence >= 0.4
        )
      );
      const result = chooseBestAlignment(
        supportedScores,
        referenceValidPixels,
        reference.layerId,
        target.layerId,
        space
      );
      if (!result || result.overlap < options.minimumOverlap) {
        throw new Error('Auto Align could not find enough shared image content.');
      }
      // A low-confidence result is still useful as a non-destructive preview.
      // The editor leaves Apply/Cancel to the user instead of hiding the
      // estimated transform behind a hard threshold.
      return result;
    } finally {
      referenceLuminance.destroy();
      targetLuminance.destroy();
      referenceGradient.destroy();
      targetGradient.destroy();
      temporaryBuffers.forEach((buffer) => buffer.destroy());
    }
  }

  private async scoreCandidates(
    referenceGradient: GPUTexture,
    targetGradient: GPUTexture,
    candidates: TransformCandidate[],
    signal?: AbortSignal
  ): Promise<ScoredCandidates> {
    signal?.throwIfAborted();
    if (!candidates.length) return { scores: [], referenceValidPixels: 0 };
    if (candidates.length > this.device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error('The requested Auto Align search range is too large for this GPU.');
    }
    const candidateBuffer = this.device.createBuffer({
      label: 'LightTable alignment transform candidates',
      size: candidates.length * CANDIDATE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const candidateValues = new Float32Array(candidates.length * 8);
    candidates.forEach((candidate, index) => {
      const { matrix } = candidate;
      candidateValues.set([
        matrix.a, matrix.c, matrix.tx, 0,
        matrix.b, matrix.d, matrix.ty, 0
      ], index * 8);
    });
    this.device.queue.writeBuffer(candidateBuffer, 0, candidateValues);

    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable alignment score settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const settingsValues = new Uint32Array([
      referenceGradient.width,
      referenceGradient.height,
      candidates.length,
      0
    ]);
    this.device.queue.writeBuffer(settingsBuffer, 0, settingsValues);
    const scoreBuffer = this.device.createBuffer({
      label: 'LightTable alignment candidate scores',
      size: candidates.length * SCORE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    const readBuffer = this.device.createBuffer({
      label: 'LightTable alignment score readback',
      size: candidates.length * SCORE_STRIDE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    try {
      const bindGroup = this.device.createBindGroup({
        layout: this.scorePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: referenceGradient.createView() },
          { binding: 1, resource: targetGradient.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: { buffer: candidateBuffer } },
          { binding: 5, resource: { buffer: scoreBuffer } }
        ]
      });
      const encoder = this.device.createCommandEncoder({ label: 'LightTable alignment candidate scoring' });
      const pass = encoder.beginComputePass({ label: 'Score LightTable similarity candidates' });
      pass.setPipeline(this.scorePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(candidates.length);
      pass.end();
      encoder.copyBufferToBuffer(scoreBuffer, 0, readBuffer, 0, candidates.length * SCORE_STRIDE);
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      signal?.throwIfAborted();
      const mapped = readBuffer.getMappedRange();
      const floats = new Float32Array(mapped);
      const integers = new Uint32Array(mapped);
      let referenceValidPixels = 0;
      const scores = candidates.map((candidate, index): AlignmentCandidateScore => {
        const base = index * 4;
        referenceValidPixels = Math.max(referenceValidPixels, integers[base + 3]);
        return {
          dx: candidate.dx,
          dy: candidate.dy,
          scale: candidate.scale,
          rotation: candidate.rotation,
          errorSum: floats[base],
          weightSum: floats[base + 1],
          validPixelCount: integers[base + 2]
        };
      });
      readBuffer.unmap();
      return { scores, referenceValidPixels };
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      candidateBuffer.destroy();
      settingsBuffer.destroy();
      scoreBuffer.destroy();
      readBuffer.destroy();
    }
  }

  private encodeReproject(
    encoder: GPUCommandEncoder,
    source: RasterRenderContract,
    destination: GPUTexture,
    space: NonNullable<ReturnType<typeof alignmentSpaceForContracts>>,
    temporaryBuffers: GPUBuffer[]
  ) {
    const inverse = invertMatrix(source.transform);
    if (!inverse) throw new Error('A selected layer has a singular transform.');
    const settings = this.device.createBuffer({
      label: 'LightTable alignment reprojection settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    temporaryBuffers.push(settings);
    this.device.queue.writeBuffer(settings, 0, new Float32Array([
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      source.dimensions.width, source.dimensions.height,
      space.documentBounds.width, space.documentBounds.height,
      space.documentBounds.x, space.documentBounds.y,
      space.documentBounds.width, space.documentBounds.height
    ]));
    const bindGroup = this.device.createBindGroup({
      layout: this.reprojectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: settings } }
      ]
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: destination.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.reprojectPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private encodeGradient(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    destination: GPUTexture
  ) {
    const bindGroup = this.device.createBindGroup({
      layout: this.gradientPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source.createView() }]
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: destination.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.gradientPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
