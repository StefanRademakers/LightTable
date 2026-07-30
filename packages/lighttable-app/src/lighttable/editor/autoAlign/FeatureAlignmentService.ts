import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix, RasterRenderContract } from '../rendering/renderContract';
import { alignmentSpaceForContracts } from './alignmentMath';
import { ALIGNMENT_REPROJECT_WGSL } from './alignmentShaders';
import {
  estimateFeatureAlignment,
  type AlignmentRaster,
  type SimilarityTransform
} from './featureAlignment';
import type {
  TranslationAlignmentOptions,
  TranslationAlignmentResult
} from './alignmentTypes';

const V2_DEFAULT_ANALYSIS_SIZE = 512;

const alignedBytesPerRow = (width: number) => Math.ceil(width * 4 / 256) * 256;

const cleanZero = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;

const analysisTransformToDocument = (
  transform: SimilarityTransform,
  originX: number,
  originY: number,
  documentPixelsPerAnalysisPixel: number
): AffineMatrix => ({
  a: transform.a,
  b: transform.b,
  c: -transform.b,
  d: transform.a,
  tx: originX
    - transform.a * originX
    + transform.b * originY
    + transform.tx * documentPixelsPerAnalysisPixel,
  ty: originY
    - transform.b * originX
    - transform.a * originY
    + transform.ty * documentPixelsPerAnalysisPixel
});

export class FeatureAlignmentService {
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly reprojectPipeline: GPURenderPipeline;

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device;
    this.sampler = sampler;
    const fullscreen = device.createShaderModule({
      label: 'LightTable Auto Align V2 fullscreen vertex',
      code: FULLSCREEN_VERTEX_WGSL
    });
    this.reprojectPipeline = device.createRenderPipeline({
      label: 'LightTable Auto Align V2 source reprojection',
      layout: 'auto',
      vertex: { module: fullscreen, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: device.createShaderModule({
          label: 'LightTable Auto Align V2 luminance reprojection',
          code: `${FULLSCREEN_VERTEX_WGSL}\n${ALIGNMENT_REPROJECT_WGSL}`
        }),
        entryPoint: 'main',
        targets: [{ format: 'rgba8unorm' }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  async align(
    reference: RasterRenderContract,
    target: RasterRenderContract,
    suppliedOptions: Partial<TranslationAlignmentOptions> = {},
    signal?: AbortSignal
  ): Promise<TranslationAlignmentResult> {
    signal?.throwIfAborted();
    const analysisSize = suppliedOptions.analysisSize ?? V2_DEFAULT_ANALYSIS_SIZE;
    const space = alignmentSpaceForContracts(reference, target, analysisSize);
    if (!space) throw new Error('The selected layers do not overlap in document space.');
    if (space.analysisWidth * space.analysisHeight < 4096) {
      throw new Error('The selected layers have too little overlap to align reliably.');
    }

    const size: GPUExtent3D = [space.analysisWidth, space.analysisHeight];
    const usage = GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.TEXTURE_BINDING;
    const referenceTexture = this.device.createTexture({
      label: 'LightTable Auto Align V2 reference analysis',
      size,
      format: 'rgba8unorm',
      usage
    });
    const targetTexture = this.device.createTexture({
      label: 'LightTable Auto Align V2 target analysis',
      size,
      format: 'rgba8unorm',
      usage
    });
    const settingsBuffers: GPUBuffer[] = [];

    try {
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable Auto Align V2 prepare analysis'
      });
      this.encodeReproject(encoder, reference, referenceTexture, space, settingsBuffers);
      this.encodeReproject(encoder, target, targetTexture, space, settingsBuffers);
      this.device.queue.submit([encoder.finish()]);

      const [referenceRaster, targetRaster] = await Promise.all([
        this.readAnalysisRaster(referenceTexture, space.analysisWidth, space.analysisHeight),
        this.readAnalysisRaster(targetTexture, space.analysisWidth, space.analysisHeight)
      ]);
      signal?.throwIfAborted();

      const estimate = estimateFeatureAlignment(referenceRaster, targetRaster);
      signal?.throwIfAborted();
      const referenceToTarget = analysisTransformToDocument(
        estimate.transform,
        space.documentBounds.x,
        space.documentBounds.y,
        space.documentPixelsPerAnalysisPixel
      );
      const inverted = invertMatrix(referenceToTarget);
      if (!inverted) throw new Error('Auto Align produced a singular geometry correction.');
      const correctionMatrix: AffineMatrix = {
        a: cleanZero(inverted.a),
        b: cleanZero(inverted.b),
        c: cleanZero(inverted.c),
        d: cleanZero(inverted.d),
        tx: cleanZero(inverted.tx),
        ty: cleanZero(inverted.ty)
      };
      const evidence = estimate.evidence;

      return {
        model: evidence.model,
        referenceLayerId: reference.layerId,
        targetLayerId: target.layerId,
        correctionMatrix,
        confidence: estimate.confidence,
        overlap: evidence.overlap,
        residualError: evidence.medianResidual * space.documentPixelsPerAnalysisPixel,
        diagnostics: {
          bestError: evidence.medianResidual,
          secondBestError: evidence.p90Residual,
          identityError: evidence.identityMedianResidual,
          improvementFromIdentity: evidence.identityMedianResidual > 1e-6
            ? Math.max(0, 1 - evidence.medianResidual / evidence.identityMedianResidual)
            : 0,
          separation: evidence.inlierRatio,
          overlap: evidence.overlap,
          validPixelCount: evidence.inlierCount,
          estimatedScale: evidence.estimatedScale,
          estimatedRotationDegrees: evidence.estimatedRotationDegrees,
          estimatedOffsetX: estimate.transform.tx * space.documentPixelsPerAnalysisPixel,
          estimatedOffsetY: estimate.transform.ty * space.documentPixelsPerAnalysisPixel,
          algorithm: 'feature-v2',
          detectedReferenceFeatures: evidence.detectedReferenceFeatures,
          detectedTargetFeatures: evidence.detectedTargetFeatures,
          mutualMatches: evidence.mutualMatches,
          inlierCount: evidence.inlierCount,
          inlierRatio: evidence.inlierRatio,
          coverageCells: evidence.coverageCells,
          coverageRatio: evidence.coverageRatio,
          medianResidual: evidence.medianResidual,
          p90Residual: evidence.p90Residual
        }
      };
    } finally {
      referenceTexture.destroy();
      targetTexture.destroy();
      settingsBuffers.forEach((buffer) => buffer.destroy());
    }
  }

  private encodeReproject(
    encoder: GPUCommandEncoder,
    source: RasterRenderContract,
    destination: GPUTexture,
    space: NonNullable<ReturnType<typeof alignmentSpaceForContracts>>,
    settingsBuffers: GPUBuffer[]
  ) {
    const inverse = invertMatrix(source.transform);
    if (!inverse) throw new Error('A selected layer has a singular transform.');
    const settings = this.device.createBuffer({
      label: 'LightTable Auto Align V2 reprojection settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    settingsBuffers.push(settings);
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
      label: 'LightTable Auto Align V2 reproject layer',
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

  private async readAnalysisRaster(
    texture: GPUTexture,
    width: number,
    height: number
  ): Promise<AlignmentRaster> {
    const bytesPerRow = alignedBytesPerRow(width);
    const readBuffer = this.device.createBuffer({
      label: 'LightTable Auto Align V2 analysis readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable Auto Align V2 read analysis'
      });
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
        [width, height]
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(readBuffer.getMappedRange());
      const luma = new Float32Array(width * height);
      const valid = new Uint8Array(width * height);
      for (let y = 0; y < height; y += 1) {
        const row = y * bytesPerRow;
        for (let x = 0; x < width; x += 1) {
          const source = row + x * 4;
          const destination = y * width + x;
          luma[destination] = bytes[source] / 255;
          valid[destination] = bytes[source + 3] >= 128 ? 1 : 0;
        }
      }
      readBuffer.unmap();
      return { width, height, luma, valid };
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
    }
  }
}
