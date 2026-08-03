import {
  CoverageAtlasCache,
  TEXT_RENDERER_BAKEOFF_LIMITS,
  TextRendererResourceLimitError,
  type CoverageAtlasCacheMetrics,
  type CoverageAtlasGlyphKey,
  type CoverageAtlasPlacement
} from '@lighttable/text-rendering';
import { COVERAGE_ATLAS_WGSL } from './coverageShader';

const INSTANCE_FLOATS = 16;
const SETTINGS_BYTES = 16;

export interface CoverageGlyphRaster {
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
  readonly pixels: Uint8Array;
}

export interface PreparedCoverageGlyph {
  readonly placement: CoverageAtlasPlacement;
  readonly bearingX: number;
  readonly bearingY: number;
}

export interface CoverageAtlasDrawCommand {
  readonly glyph: PreparedCoverageGlyph;
  readonly x: number;
  readonly y: number;
  /** Premultiplied linear RGBA in the document working space. */
  readonly color: readonly [number, number, number, number];
  readonly transform?: readonly [number, number, number, number];
}

export interface CoverageAtlasRenderTarget {
  readonly view: GPUTextureView;
  /** Canonical compositor working target: linear-light, premultiplied RGBA. */
  readonly format: 'rgba16float';
  readonly width: number;
  readonly height: number;
  readonly loadOp?: GPULoadOp;
}

export interface CoverageAtlasBackendMetrics extends CoverageAtlasCacheMetrics {
  readonly drawBatches: number;
  readonly uploadDurationMs: number;
}

interface PageResource {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
}

const align = (value: number) => Math.ceil(value / 256) * 256;
const assertFinite = (values: readonly number[], message: string) => {
  if (!values.every(Number.isFinite)) throw new TypeError(message);
};

/**
 * Production R8 page owner and instanced solid-text encoder.
 *
 * Layout/raster work remains in the text worker. This class only accepts
 * validated dedicated R8 masks and never owns canonical document text.
 */
export class CoverageAtlasBackend {
  private readonly cache: CoverageAtlasCache;
  private readonly pages = new Map<number, PageResource>();
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private pendingBuffers: GPUBuffer[] = [];
  private drawBatches = 0;
  private uploadDurationMs = 0;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    pageDimension = 1024,
    maximumPages = 8
  ) {
    this.cache = new CoverageAtlasCache(pageDimension, maximumPages, 1);
  }

  prepareGlyph(key: CoverageAtlasGlyphKey, raster: CoverageGlyphRaster): PreparedCoverageGlyph {
    this.assertUsable();
    if (raster.pixels.byteLength !== raster.width * raster.height) {
      throw new TypeError('Coverage raster must contain one R8 byte per pixel.');
    }
    assertFinite([raster.bearingX, raster.bearingY], 'Coverage raster bearings must be finite.');
    const reservation = this.cache.reserve(
      key, raster.width, raster.height, raster.bearingX, raster.bearingY
    );
    const { placement } = reservation;
    if (!reservation.created) {
      return { placement, bearingX: placement.bearingX, bearingY: placement.bearingY };
    }
    if (reservation.created && !placement.empty) {
      try {
        if (reservation.evictedPageId !== null) {
          const stalePage = this.pages.get(reservation.evictedPageId);
          stalePage?.texture.destroy();
          this.pages.delete(reservation.evictedPageId);
        }
        const page = this.ensurePage(placement.pageId);
        const startedAt = performance.now();
        const bytesPerRow = align(raster.width);
        const upload = new Uint8Array(bytesPerRow * raster.height);
        for (let row = 0; row < raster.height; row += 1) {
          upload.set(
            raster.pixels.subarray(row * raster.width, (row + 1) * raster.width),
            row * bytesPerRow
          );
        }
        this.device.queue.writeTexture(
          { texture: page.texture, origin: { x: placement.x, y: placement.y } },
          upload,
          { bytesPerRow, rowsPerImage: raster.height },
          { width: raster.width, height: raster.height }
        );
        this.uploadDurationMs += performance.now() - startedAt;
        this.cache.recordUpload(placement, raster.pixels.byteLength);
      } catch (error) {
        this.cache.discardReservation(placement);
        throw error;
      }
    }
    return { placement, bearingX: raster.bearingX, bearingY: raster.bearingY };
  }

  /** Checks resident mask metadata without requiring worker rasterization. */
  lookupGlyph(key: CoverageAtlasGlyphKey): PreparedCoverageGlyph | null {
    this.assertUsable();
    const placement = this.cache.lookup(key, false);
    return placement
      ? { placement, bearingX: placement.bearingX, bearingY: placement.bearingY }
      : null;
  }

  encode(
    encoder: GPUCommandEncoder,
    target: CoverageAtlasRenderTarget,
    draws: readonly CoverageAtlasDrawCommand[]
  ) {
    this.assertUsable();
    if (!Number.isInteger(target.width) || target.width <= 0
      || !Number.isInteger(target.height) || target.height <= 0) {
      throw new TypeError('Coverage target dimensions must be positive integers.');
    }
    const batches: Array<{ pageId: number; commands: CoverageAtlasDrawCommand[] }> = [];
    for (const draw of draws) {
      if (!this.cache.isCurrent(draw.glyph.placement)) {
        throw new Error('Coverage draw references a stale atlas placement.');
      }
      if (draw.glyph.placement.empty) continue;
      const [red, green, blue, alpha] = draw.color;
      assertFinite([draw.x, draw.y, ...draw.color, ...(draw.transform ?? [])], 'Coverage draw values must be finite.');
      if ([red, green, blue, alpha].some((value) => value < 0 || value > 1)
        || red > alpha || green > alpha || blue > alpha) {
        throw new TypeError('Coverage color must be premultiplied linear RGBA.');
      }
      const pageId = draw.glyph.placement.pageId;
      const previous = batches.at(-1);
      if (previous?.pageId === pageId) previous.commands.push(draw);
      else batches.push({ pageId, commands: [draw] });
    }
    if (batches.length === 0) return 0;
    if (batches.length > TEXT_RENDERER_BAKEOFF_LIMITS.maximumDrawBatches) {
      throw new TextRendererResourceLimitError('Coverage draw exceeds the bounded batch limit.');
    }
    const pipeline = this.pipeline(target.format);
    const prepared: Array<{
      commands: CoverageAtlasDrawCommand[];
      settingsBuffer: GPUBuffer;
      instanceBuffer: GPUBuffer;
      bindGroup: GPUBindGroup;
    }> = [];
    try {
      for (const { pageId, commands } of batches) {
        const page = this.pages.get(pageId);
        if (!page) throw new Error('Coverage atlas page texture is unavailable.');
        const values = new Float32Array(commands.length * INSTANCE_FLOATS);
        commands.forEach((draw, index) => {
          const placement = draw.glyph.placement;
          const basis = draw.transform ?? [1, 0, 0, 1];
          values.set([
            draw.x + basis[0] * draw.glyph.bearingX - basis[2] * draw.glyph.bearingY,
            draw.y + basis[1] * draw.glyph.bearingX - basis[3] * draw.glyph.bearingY,
            placement.width, placement.height,
            ...basis,
            placement.x, placement.y, placement.width, placement.height,
            ...draw.color
          ], index * INSTANCE_FLOATS);
        });
        const settings = new Float32Array([
          target.width, target.height, this.cache.pageDimension, this.cache.pageDimension
        ]);
        const settingsBuffer = this.device.createBuffer({
          label: 'LightTable text atlas batch settings',
          size: SETTINGS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        let instanceBuffer: GPUBuffer | null = null;
        try {
          instanceBuffer = this.device.createBuffer({
            label: 'LightTable text atlas batch instances',
            size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
          });
          this.device.queue.writeBuffer(settingsBuffer, 0, settings);
          this.device.queue.writeBuffer(instanceBuffer, 0, values);
          const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: settingsBuffer } },
              { binding: 1, resource: page.view },
              { binding: 2, resource: this.sampler() },
              { binding: 3, resource: { buffer: instanceBuffer } }
            ]
          });
          prepared.push({ commands, settingsBuffer, instanceBuffer, bindGroup });
        } catch (error) {
          settingsBuffer.destroy();
          instanceBuffer?.destroy();
          throw error;
        }
      }
    } catch (error) {
      prepared.forEach(({ settingsBuffer, instanceBuffer }) => {
        settingsBuffer.destroy();
        instanceBuffer.destroy();
      });
      throw error;
    }
    try {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: target.view,
          loadOp: target.loadOp ?? 'load',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }]
      });
      for (const { commands, bindGroup } of prepared) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(6, commands.length);
      }
      pass.end();
    } catch (error) {
      prepared.forEach(({ settingsBuffer, instanceBuffer }) => {
        settingsBuffer.destroy();
        instanceBuffer.destroy();
      });
      throw error;
    }
    prepared.forEach(({ settingsBuffer, instanceBuffer }) => {
      this.pendingBuffers.push(settingsBuffer, instanceBuffer);
    });
    this.drawBatches += batches.length;
    return batches.length;
  }

  async retireSubmittedResources() {
    const submitted = this.pendingBuffers;
    this.pendingBuffers = [];
    if (!submitted.length) return;
    try {
      await this.device.queue.onSubmittedWorkDone();
    } catch {
      // Device loss rejects this promise; ownership still ends here and the
      // engine's device-loss path replaces the complete backend.
    } finally {
      submitted.forEach((buffer) => buffer.destroy());
    }
  }

  /** A lost GPUDevice is never reused; construct a new backend for recovery. */
  invalidateForDeviceLoss() {
    if (this.disposed) return;
    this.releaseResources();
    this.disposed = true;
  }

  private releaseResources() {
    this.pages.forEach((page) => page.texture.destroy());
    this.pages.clear();
    this.pendingBuffers.forEach((buffer) => buffer.destroy());
    this.pendingBuffers = [];
    this.pipelines.clear();
    this.samplerValue = null;
    this.cache.resetForDeviceLoss();
  }

  metrics(): CoverageAtlasBackendMetrics {
    return { ...this.cache.metrics(), drawBatches: this.drawBatches, uploadDurationMs: this.uploadDurationMs };
  }

  dispose() {
    if (this.disposed) return;
    this.releaseResources();
    this.disposed = true;
  }

  private ensurePage(pageId: number) {
    const existing = this.pages.get(pageId);
    if (existing) return existing;
    const texture = this.device.createTexture({
      label: `LightTable text coverage atlas page ${pageId}`,
      size: { width: this.cache.pageDimension, height: this.cache.pageDimension },
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    try {
      const resource = { texture, view: texture.createView() };
      this.pages.set(pageId, resource);
      return resource;
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  private samplerValue: GPUSampler | null = null;
  private sampler() {
    this.samplerValue ??= this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    return this.samplerValue;
  }

  private pipeline(format: GPUTextureFormat) {
    const existing = this.pipelines.get(format);
    if (existing) return existing;
    const module = this.device.createShaderModule({ label: 'LightTable production text atlas', code: COVERAGE_ATLAS_WGSL });
    const pipeline = this.device.createRenderPipeline({
      label: `LightTable production text atlas ${format}`,
      layout: 'auto',
      vertex: { module, entryPoint: 'coverageVertex' },
      fragment: { module, entryPoint: 'coverageFragment', targets: [{
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }] },
      primitive: { topology: 'triangle-list' }
    });
    this.pipelines.set(format, pipeline);
    return pipeline;
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Coverage atlas backend is disposed.');
  }
}
