import type { TextEditingOverlay, TextEditingAffine } from '@lighttable/text-rendering';
import {
  TEXT_EDITING_OVERLAY_LINE_WGSL,
  TEXT_EDITING_OVERLAY_MARKER_WGSL,
  TEXT_EDITING_OVERLAY_QUAD_WGSL
} from './textEditingOverlayShader';

const SETTINGS_BYTES = 32;
const GEOMETRY_BYTES = 48;
const MARKER_BYTES = 16;

export interface TextEditingOverlayTarget {
  readonly colorView: GPUTextureView;
  readonly format: GPUTextureFormat;
  readonly width: number;
  readonly height: number;
  readonly documentToViewport: TextEditingAffine;
}

interface CachedGeometry {
  readonly quads: GPUBuffer | null;
  readonly caret: GPUBuffer | null;
  readonly lines: GPUBuffer | null;
  readonly markers: GPUBuffer | null;
  readonly quadCount: number;
  readonly caretCount: number;
  readonly lineCount: number;
  readonly markerCount: number;
}

interface PipelineBundle {
  readonly quads: GPURenderPipeline;
  readonly lines: GPURenderPipeline;
  readonly markers: GPURenderPipeline;
}

const createStorage = (device: GPUDevice, label: string, data: Float32Array<ArrayBuffer>) => {
  if (!data.byteLength) return null;
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

const quadData = (overlay: TextEditingOverlay) => new Float32Array(
  overlay.quads.flatMap(({ points, color }) => [...points.flatMap(({ x, y }) => [x, y]), ...color])
);

const lineData = (overlay: TextEditingOverlay, caret: boolean) => new Float32Array(
  overlay.lines.filter((line) => (line.role === 'caret') === caret).flatMap((line) => [
    line.start.x, line.start.y, line.end.x, line.end.y,
    line.widthPx, 0, 0, 0,
    ...line.color
  ])
);

const markerData = (overlay: TextEditingOverlay) => new Float32Array(
  overlay.markers.flatMap(({ role, point, sizePx }) => [
    point.x, point.y, sizePx, role === 'overflow-indicator' ? 1 : 0
  ])
);

/** GPU-only transient text selection/caret overlay; document textures are untouched. */
export class TextEditingOverlayBackend {
  private readonly layout: GPUBindGroupLayout;
  private readonly cache = new Map<string, CachedGeometry>();
  private readonly pipelines = new Map<GPUTextureFormat, PipelineBundle>();
  private pendingSettings: GPUBuffer[] = [];
  private disposed = false;

  constructor(private readonly device: GPUDevice, private readonly maximumEntries = 128) {
    this.layout = device.createBindGroupLayout({
      label: 'LightTable text editing overlay layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', minBindingSize: SETTINGS_BYTES } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
      ]
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    overlay: TextEditingOverlay,
    target: TextEditingOverlayTarget,
    caretVisible = true
  ) {
    if (this.disposed) throw new Error('Text editing overlay backend is disposed.');
    if (target.width <= 0 || target.height <= 0) return false;
    const geometry = this.prepare(overlay);
    if (!geometry.quads && !geometry.lines && !geometry.markers
      && (!caretVisible || !geometry.caret)) return false;
    const bundle = this.pipelineBundle(target.format);
    const settings = this.createSettings(target);
    const pass = encoder.beginRenderPass({
      label: 'LightTable text editing overlay',
      colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }]
    });
    if (geometry.quads) this.draw(pass, bundle.quads, settings, geometry.quads, geometry.quadCount);
    if (geometry.lines) this.draw(pass, bundle.lines, settings, geometry.lines, geometry.lineCount);
    if (geometry.markers) {
      this.draw(pass, bundle.markers, settings, geometry.markers, geometry.markerCount);
    }
    if (caretVisible && geometry.caret) {
      this.draw(pass, bundle.lines, settings, geometry.caret, geometry.caretCount);
    }
    pass.end();
    return true;
  }

  notifySubmitted() {
    const submitted = this.pendingSettings.splice(0);
    if (!submitted.length) return Promise.resolve();
    return this.device.queue.onSubmittedWorkDone().catch(() => undefined).then(() => {
      submitted.forEach((buffer) => buffer.destroy());
    });
  }

  cacheMetrics() { return { entries: this.cache.size }; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingSettings.forEach((buffer) => buffer.destroy());
    this.pendingSettings = [];
    for (const geometry of this.cache.values()) this.destroyGeometry(geometry);
    this.cache.clear();
    this.pipelines.clear();
  }

  private prepare(overlay: TextEditingOverlay) {
    const cached = this.cache.get(overlay.resourceKey);
    if (cached) return cached;
    const quads = quadData(overlay);
    const caret = lineData(overlay, true);
    const lines = lineData(overlay, false);
    const markers = markerData(overlay);
    const geometry = {
      quads: createStorage(this.device, `LightTable text overlay quads ${overlay.layerId}`, quads),
      caret: createStorage(this.device, `LightTable text overlay caret ${overlay.layerId}`, caret),
      lines: createStorage(this.device, `LightTable text overlay lines ${overlay.layerId}`, lines),
      markers: createStorage(this.device, `LightTable text overlay markers ${overlay.layerId}`, markers),
      quadCount: quads.byteLength / GEOMETRY_BYTES,
      caretCount: caret.byteLength / GEOMETRY_BYTES,
      lineCount: lines.byteLength / GEOMETRY_BYTES,
      markerCount: markers.byteLength / MARKER_BYTES
    };
    this.cache.set(overlay.resourceKey, geometry);
    while (this.cache.size > this.maximumEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.destroyGeometry(this.cache.get(oldest)!);
      this.cache.delete(oldest);
    }
    return geometry;
  }

  private createSettings(target: TextEditingOverlayTarget) {
    const buffer = this.device.createBuffer({
      label: 'LightTable text overlay settings',
      size: SETTINGS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const matrix = target.documentToViewport;
    this.device.queue.writeBuffer(buffer, 0, new Float32Array([
      matrix.a, matrix.b, matrix.c, matrix.d,
      matrix.tx, matrix.ty, target.width, target.height
    ]));
    this.pendingSettings.push(buffer);
    return buffer;
  }

  private draw(
    pass: GPURenderPassEncoder,
    pipeline: GPURenderPipeline,
    settings: GPUBuffer,
    geometry: GPUBuffer,
    count: number
  ) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({
      label: 'LightTable text overlay bind group',
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: settings } },
        { binding: 1, resource: { buffer: geometry } }
      ]
    }));
    pass.draw(6, count);
  }

  private pipelineBundle(format: GPUTextureFormat) {
    const cached = this.pipelines.get(format);
    if (cached) return cached;
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const target: GPUColorTargetState = {
      format,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
      }
    };
    const quadModule = this.device.createShaderModule({
      label: 'LightTable text editing quad shader', code: TEXT_EDITING_OVERLAY_QUAD_WGSL
    });
    const lineModule = this.device.createShaderModule({
      label: 'LightTable text editing line shader', code: TEXT_EDITING_OVERLAY_LINE_WGSL
    });
    const markerModule = this.device.createShaderModule({
      label: 'LightTable text editing marker shader', code: TEXT_EDITING_OVERLAY_MARKER_WGSL
    });
    const bundle = {
      quads: this.device.createRenderPipeline({
        label: 'LightTable text editing quads', layout: pipelineLayout,
        vertex: { module: quadModule, entryPoint: 'quadVertex' },
        fragment: { module: quadModule, entryPoint: 'overlayFragment', targets: [target] },
        primitive: { topology: 'triangle-list' }
      }),
      lines: this.device.createRenderPipeline({
        label: 'LightTable text editing lines', layout: pipelineLayout,
        vertex: { module: lineModule, entryPoint: 'lineVertex' },
        fragment: { module: lineModule, entryPoint: 'overlayFragment', targets: [target] },
        primitive: { topology: 'triangle-list' }
      }),
      markers: this.device.createRenderPipeline({
        label: 'LightTable text editing markers', layout: pipelineLayout,
        vertex: { module: markerModule, entryPoint: 'markerVertex' },
        fragment: { module: markerModule, entryPoint: 'markerFragment', targets: [target] },
        primitive: { topology: 'triangle-list' }
      })
    };
    this.pipelines.set(format, bundle);
    return bundle;
  }

  private destroyGeometry(geometry: CachedGeometry) {
    geometry.quads?.destroy(); geometry.caret?.destroy(); geometry.lines?.destroy();
    geometry.markers?.destroy();
  }
}
