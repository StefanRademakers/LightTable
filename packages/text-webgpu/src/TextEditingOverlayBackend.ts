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

interface BufferSlot {
  readonly buffer: GPUBuffer | null;
  readonly capacity: number;
}

interface CachedGeometry {
  quads: BufferSlot;
  caret: BufferSlot;
  lines: BufferSlot;
  markers: BufferSlot;
  quadCount: number;
  caretCount: number;
  lineCount: number;
  markerCount: number;
}

interface PipelineBundle {
  readonly quads: GPURenderPipeline;
  readonly lines: GPURenderPipeline;
  readonly markers: GPURenderPipeline;
}

const storageCapacity = (required: number) => {
  let capacity = 256;
  while (capacity < required) capacity *= 2;
  return capacity;
};

const createStorage = (
  device: GPUDevice,
  label: string,
  data: Float32Array<ArrayBuffer>
): BufferSlot => {
  if (!data.byteLength) return { buffer: null, capacity: 0 };
  const capacity = storageCapacity(data.byteLength);
  const buffer = device.createBuffer({
    label,
    size: capacity,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(buffer, 0, data);
  return { buffer, capacity };
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
  private readonly layerKeys = new Map<string, string>();
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
    if (!geometry.quadCount && !geometry.lineCount && !geometry.markerCount
      && (!caretVisible || !geometry.caretCount)) return false;
    const bundle = this.pipelineBundle(target.format);
    const settings = this.createSettings(target);
    const pass = encoder.beginRenderPass({
      label: 'LightTable text editing overlay',
      colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }]
    });
    if (geometry.quadCount) {
      this.draw(pass, bundle.quads, settings, geometry.quads.buffer!, geometry.quadCount);
    }
    if (geometry.lineCount) {
      this.draw(pass, bundle.lines, settings, geometry.lines.buffer!, geometry.lineCount);
    }
    if (geometry.markerCount) {
      this.draw(pass, bundle.markers, settings, geometry.markers.buffer!, geometry.markerCount);
    }
    if (caretVisible && geometry.caretCount) {
      this.draw(pass, bundle.lines, settings, geometry.caret.buffer!, geometry.caretCount);
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
    this.layerKeys.clear();
    this.pipelines.clear();
  }

  private prepare(overlay: TextEditingOverlay) {
    const cached = this.cache.get(overlay.resourceKey);
    if (cached) return cached;
    const quads = quadData(overlay);
    const caret = lineData(overlay, true);
    const lines = lineData(overlay, false);
    const markers = markerData(overlay);
    const previousKey = this.layerKeys.get(overlay.layerId);
    const previous = previousKey ? this.cache.get(previousKey) : undefined;
    if (previousKey) this.cache.delete(previousKey);
    const geometry = previous ?? {
      quads: { buffer: null, capacity: 0 },
      caret: { buffer: null, capacity: 0 },
      lines: { buffer: null, capacity: 0 },
      markers: { buffer: null, capacity: 0 },
      quadCount: 0,
      caretCount: 0,
      lineCount: 0,
      markerCount: 0
    };
    geometry.quads = this.writeGeometry(
      geometry.quads, `LightTable text overlay quads ${overlay.layerId}`, quads
    );
    geometry.caret = this.writeGeometry(
      geometry.caret, `LightTable text overlay caret ${overlay.layerId}`, caret
    );
    geometry.lines = this.writeGeometry(
      geometry.lines, `LightTable text overlay lines ${overlay.layerId}`, lines
    );
    geometry.markers = this.writeGeometry(
      geometry.markers, `LightTable text overlay markers ${overlay.layerId}`, markers
    );
    geometry.quadCount = quads.byteLength / GEOMETRY_BYTES;
    geometry.caretCount = caret.byteLength / GEOMETRY_BYTES;
    geometry.lineCount = lines.byteLength / GEOMETRY_BYTES;
    geometry.markerCount = markers.byteLength / MARKER_BYTES;
    this.cache.set(overlay.resourceKey, geometry);
    this.layerKeys.set(overlay.layerId, overlay.resourceKey);
    while (this.cache.size > this.maximumEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      const evicted = this.cache.get(oldest)!;
      this.destroyGeometry(evicted);
      this.cache.delete(oldest);
      for (const [layerId, key] of this.layerKeys) {
        if (key === oldest) this.layerKeys.delete(layerId);
      }
    }
    return geometry;
  }

  private writeGeometry(
    slot: BufferSlot,
    label: string,
    data: Float32Array<ArrayBuffer>
  ): BufferSlot {
    if (!data.byteLength) return slot;
    if (slot.buffer && slot.capacity >= data.byteLength) {
      this.device.queue.writeBuffer(slot.buffer, 0, data);
      return slot;
    }
    slot.buffer?.destroy();
    return createStorage(this.device, label, data);
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
    geometry.quads.buffer?.destroy(); geometry.caret.buffer?.destroy();
    geometry.lines.buffer?.destroy(); geometry.markers.buffer?.destroy();
  }
}
