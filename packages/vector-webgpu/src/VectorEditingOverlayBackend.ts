import type { AffineMatrix } from '@lighttable/vector-core';
import {
  RevisionedResourceCache,
  type ResourceCacheMetrics,
  type VectorEditingOverlay,
  type VectorSelectionFrame
} from '@lighttable/vector-rendering';
import {
  VECTOR_EDITING_OVERLAY_LINE_WGSL,
  VECTOR_EDITING_OVERLAY_MARKER_WGSL
} from './shaders';

const SETTINGS_BYTES = 80;
const CUBIC_BYTES = 48;
const MARKER_BYTES = 32;
const CURVE_SUBDIVISIONS = 24;

interface CachedOverlayBuffers {
  curves: GPUBuffer | null;
  handles: GPUBuffer | null;
  markers: GPUBuffer | null;
  curveCount: number;
  handleCount: number;
  markerCount: number;
  bytes: number;
}

interface OverlayPipelines {
  lines: GPURenderPipeline;
  markers: GPURenderPipeline;
}

const ISOLATED_OVERLAY_COMPOSITE_WGSL = /* wgsl */`
struct Output {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
// A single vec4 keeps the uniform block exactly 16 bytes. A scalar followed
// by vec3 would align the vec3 at byte 16 and make the actual WGSL structure
// 32 bytes, invalidating the pipeline against its 16-byte bind-group layout.
struct Settings {
  opacity: vec4f,
};
@group(0) @binding(0) var overlayTexture: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var<uniform> settings: Settings;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)
  );
  let uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0)
  );
  let position: vec2f = positions[index];
  var output: Output;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4f {
  let color = textureSample(overlayTexture, overlaySampler, input.uv);
  return vec4f(color.rgb, color.a * settings.opacity.x);
}`;

export interface VectorEditingOverlayTarget {
  colorView: GPUTextureView;
  format: GPUTextureFormat;
  width: number;
  height: number;
  /** Maps document coordinates into target pixels. */
  documentToViewport: AffineMatrix;
}

export interface VectorEditingOverlayTheme {
  pathColor: readonly [number, number, number, number];
  handleColor: readonly [number, number, number, number];
  pathWidthPx: number;
  handleWidthPx: number;
  /** Screen-pixel dash pattern. Zero keeps the stroke solid. */
  dashLengthPx?: number;
  gapLengthPx?: number;
  /** Presentation-only dash phase; changing it never rebuilds geometry. */
  dashOffsetPx?: number;
  /** Optional solid backing stroke, useful for selection visibility. */
  underlayColor?: readonly [number, number, number, number];
  underlayWidthPx?: number;
  /** Straight utility axes can bypass curve subdivision and its segment seams. */
  curveSubdivisions?: number;
}

const DEFAULT_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.22, 0.64, 1, 1],
  handleColor: [0.78, 0.86, 0.96, 0.9],
  pathWidthPx: 1.5,
  handleWidthPx: 1
};

/** Static, low-attention locator for selected geometry with no visible paint. */
export const UNPAINTED_ELEMENT_OUTLINE_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.22, 0.64, 1, 0.78],
  handleColor: [0.22, 0.64, 1, 0.78],
  pathWidthPx: 1,
  handleWidthPx: 1,
  dashLengthPx: 5,
  gapLengthPx: 4
};

/** High-contrast, screen-space presentation for an editable gradient axis. */
export const GRADIENT_GIZMO_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.96, 0.97, 1, 1],
  handleColor: [0.18, 0.55, 1, 1],
  pathWidthPx: 1.25,
  handleWidthPx: 1,
  underlayColor: [0.04, 0.05, 0.07, 0.9],
  underlayWidthPx: 2.5,
  curveSubdivisions: 1
};

const SELECTION_FRAME_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.9, 0.94, 1, 0.95],
  handleColor: [0.9, 0.94, 1, 0.95],
  pathWidthPx: 1,
  handleWidthPx: 1
};

const TRANSFORM_FRAME_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.22, 0.64, 1, 1],
  handleColor: [0.94, 0.97, 1, 1],
  pathWidthPx: 1.25,
  handleWidthPx: 1
};

const SMART_GUIDE_FRAME_THEME: VectorEditingOverlayTheme = {
  pathColor: [1, 0.2, 0.72, 1],
  handleColor: [1, 0.2, 0.72, 1],
  pathWidthPx: 1,
  handleWidthPx: 1,
  curveSubdivisions: 1
};

const DOCUMENT_GUIDE_FRAME_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.18, 0.78, 1, 0.92],
  handleColor: [0.18, 0.78, 1, 0.92],
  pathWidthPx: 1,
  handleWidthPx: 1,
  curveSubdivisions: 1
};

const DOCUMENT_GRID_FRAME_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.58, 0.62, 0.67, 0.32],
  handleColor: [0.58, 0.62, 0.67, 0.32],
  pathWidthPx: 1,
  handleWidthPx: 1,
  curveSubdivisions: 1
};

export const SELECTION_OUTLINE_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.96, 0.97, 1, 1],
  handleColor: [0.96, 0.97, 1, 1],
  pathWidthPx: 1,
  handleWidthPx: 1,
  dashLengthPx: 5,
  gapLengthPx: 4,
  underlayColor: [0.04, 0.05, 0.06, 0.95],
  underlayWidthPx: 1
};

export const BRUSH_CURSOR_THEME: VectorEditingOverlayTheme = {
  pathColor: [0.96, 0.97, 1, 0.96],
  handleColor: [0.96, 0.97, 1, 0.96],
  pathWidthPx: 1,
  handleWidthPx: 1,
  underlayColor: [0.035, 0.04, 0.05, 0.9],
  underlayWidthPx: 2
};

const selectionFrameOverlay = (frame: VectorSelectionFrame): VectorEditingOverlay => ({
  pathId: 'selection-frame',
  resourceKey: frame.resourceKey,
  geometryRevision: 0,
  transformRevision: 0,
  cubics: frame.edges.map(({ start, end }, segmentIndex) => ({
    subpathId: 'selection-frame',
    segmentIndex,
    p0: start,
    p1: start,
    p2: end,
    p3: end
  })),
  anchors: [
    ...frame.handles.map(({ kind, point, markerSizePx }) => ({
      subpathId: 'selection-frame',
      anchorId: kind,
      point,
      markerSizePx,
      selected: true,
      active: false
    })),
    {
      subpathId: 'selection-frame',
      anchorId: 'pivot',
      point: frame.pivot,
      markerSizePx: 6,
      selected: false,
      active: true
    }
  ],
  handles: []
});

const createBuffer = (
  device: GPUDevice,
  label: string,
  data: Float32Array<ArrayBuffer>
) => {
  if (data.byteLength === 0) return null;
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

const cubicPoint = (
  cubic: VectorEditingOverlay['cubics'][number],
  t: number
) => {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * cubic.p0.x
      + 3 * inverse ** 2 * t * cubic.p1.x
      + 3 * inverse * t ** 2 * cubic.p2.x
      + t ** 3 * cubic.p3.x,
    y: inverse ** 3 * cubic.p0.y
      + 3 * inverse ** 2 * t * cubic.p1.y
      + 3 * inverse * t ** 2 * cubic.p2.y
      + t ** 3 * cubic.p3.y
  };
};

const approximateCubicLength = (cubic: VectorEditingOverlay['cubics'][number]) => {
  let length = 0;
  let previous = cubic.p0;
  for (let index = 1; index <= CURVE_SUBDIVISIONS; index += 1) {
    const point = cubicPoint(cubic, index / CURVE_SUBDIVISIONS);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
};

const cubicData = (overlay: VectorEditingOverlay) => {
  let accumulatedLength = 0;
  return new Float32Array(overlay.cubics.flatMap((cubic) => {
    const length = approximateCubicLength(cubic);
    const values = [
      cubic.p0.x, cubic.p0.y, cubic.p1.x, cubic.p1.y,
      cubic.p2.x, cubic.p2.y, cubic.p3.x, cubic.p3.y,
      accumulatedLength, length, 0, 0
    ];
    accumulatedLength += length;
    return values;
  }));
};

const handleData = (overlay: VectorEditingOverlay) => cubicData({
  ...overlay,
  cubics: overlay.handles.map(({ anchor, point }, segmentIndex) => ({
    subpathId: 'editing-handles',
    segmentIndex,
    p0: anchor,
    p1: anchor,
    p2: point,
    p3: point
  }))
});

const markerData = (overlay: VectorEditingOverlay) => new Float32Array([
  ...overlay.anchors.flatMap(({
    point, markerSizePx, markerKind = 'square', markerColor, selected, active
  }) => [
    point.x, point.y, markerSizePx,
    ({ square: 0, circle: 3, diamond: 6 })[markerKind] + (active ? 2 : selected ? 1 : 0),
    ...(markerColor ?? [0, 0, 0, -1])
  ]),
  ...overlay.handles.flatMap(({ point, markerSizePx }) => [
    point.x, point.y, markerSizePx, 3,
    0, 0, 0, -1
  ])
]);

/**
 * Dedicated WebGPU overlay backend for vector editing controls.
 *
 * Artwork and overlay resources are deliberately separate. Pan/zoom changes
 * only rewrite a tiny uniform buffer; path tessellation and raster caches stay
 * untouched. Curves are evaluated by the vertex shader rather than flattened
 * at the current zoom, keeping direct-selection outlines smooth at high zoom.
 */
export class VectorEditingOverlayBackend {
  private readonly resources: RevisionedResourceCache<CachedOverlayBuffers>;
  private readonly settingsLayout: GPUBindGroupLayout;
  private readonly pipelines = new Map<GPUTextureFormat, OverlayPipelines>();
  private readonly isolatedCompositePipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly isolatedCompositeLayout: GPUBindGroupLayout;
  private isolatedSampler: GPUSampler | null = null;
  private readonly isolatedOpacityBuffer: GPUBuffer;
  private isolatedTexture: GPUTexture | null = null;
  private isolatedTextureWidth = 0;
  private isolatedTextureHeight = 0;
  private isolatedTextureFormat: GPUTextureFormat | null = null;
  private pendingUniforms: GPUBuffer[] = [];
  private disposed = false;

  constructor(private readonly device: GPUDevice, cacheBudgetBytes = 16 * 1024 * 1024) {
    this.resources = new RevisionedResourceCache(cacheBudgetBytes, (resource) => {
      resource.curves?.destroy();
      resource.handles?.destroy();
      resource.markers?.destroy();
    });
    this.settingsLayout = device.createBindGroupLayout({
      label: 'LightTable vector editing overlay layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: SETTINGS_BYTES }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        }
      ]
    });
    this.isolatedCompositeLayout = device.createBindGroupLayout({
      label: 'LightTable isolated overlay composite layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 2, visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: 16 }
        }
      ]
    });
    this.isolatedOpacityBuffer = device.createBuffer({
      label: 'LightTable isolated overlay opacity', size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    overlay: VectorEditingOverlay,
    target: VectorEditingOverlayTarget,
    theme: VectorEditingOverlayTheme = DEFAULT_THEME
  ) {
    return this.encodeOverlay(encoder, overlay, target, theme, false);
  }

  /** Renders dense geometry once, then applies opacity once to the complete overlay. */
  encodeIsolated(
    encoder: GPUCommandEncoder,
    overlay: VectorEditingOverlay,
    target: VectorEditingOverlayTarget,
    theme: VectorEditingOverlayTheme,
    opacity: number
  ) {
    this.assertUsable();
    if (target.width <= 0 || target.height <= 0) return false;
    const texture = this.ensureIsolatedTexture(target);
    this.isolatedSampler ??= this.device.createSampler({
      label: 'LightTable isolated overlay sampler',
      magFilter: 'nearest', minFilter: 'nearest'
    });
    const opaqueTheme: VectorEditingOverlayTheme = {
      ...theme,
      pathColor: [...theme.pathColor.slice(0, 3), 1] as [number, number, number, number],
      handleColor: [...theme.handleColor.slice(0, 3), 1] as [number, number, number, number],
      underlayColor: theme.underlayColor
        ? [...theme.underlayColor.slice(0, 3), 1] as [number, number, number, number]
        : undefined
    };
    const encoded = this.encodeOverlay(encoder, overlay, {
      ...target, colorView: texture.createView()
    }, opaqueTheme, true);
    if (!encoded) return false;
    this.device.queue.writeBuffer(
      this.isolatedOpacityBuffer, 0,
      new Float32Array([Math.max(0, Math.min(1, opacity)), 0, 0, 0])
    );
    const pipeline = this.isolatedCompositePipeline(target.format);
    const pass = encoder.beginRenderPass({
      label: 'LightTable composite isolated vector overlay',
      colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({
      label: 'LightTable isolated overlay composite bind group',
      layout: this.isolatedCompositeLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.isolatedSampler },
        { binding: 2, resource: { buffer: this.isolatedOpacityBuffer } }
      ]
    }));
    pass.draw(3);
    pass.end();
    return true;
  }

  private encodeOverlay(
    encoder: GPUCommandEncoder,
    overlay: VectorEditingOverlay,
    target: VectorEditingOverlayTarget,
    theme: VectorEditingOverlayTheme,
    clear: boolean
  ) {
    this.assertUsable();
    if (target.width <= 0 || target.height <= 0) return false;
    const resource = this.prepare(overlay);
    if (!resource.curves && !resource.handles && !resource.markers) return false;
    const pipelines = this.pipelineBundle(target.format);
    const pass = encoder.beginRenderPass({
      label: 'LightTable vector editing overlay',
      colorAttachments: [{
        view: target.colorView,
        ...(clear ? { clearValue: { r: 0, g: 0, b: 0, a: 0 } } : {}),
        loadOp: clear ? 'clear' : 'load',
        storeOp: 'store'
      }]
    });

    if (resource.curves) this.drawLines(
      pass,
      resource.curves,
      resource.curveCount,
      theme.curveSubdivisions ?? CURVE_SUBDIVISIONS,
      theme.pathWidthPx,
      theme.pathColor,
      target,
      pipelines.lines,
      theme
    );
    if (resource.handles) this.drawLines(
      pass,
      resource.handles,
      resource.handleCount,
      1,
      theme.handleWidthPx,
      theme.handleColor,
      target,
      pipelines.lines,
      theme
    );
    if (resource.markers) {
      const settings = this.createSettings(target, 0, 0, theme.handleColor);
      pass.setPipeline(pipelines.markers);
      pass.setBindGroup(0, this.bindGroup(settings, resource.markers));
      pass.draw(6, resource.markerCount);
    }
    pass.end();
    return true;
  }

  /** Encodes one shared transform frame for the complete element selection. */
  encodeSelectionFrame(
    encoder: GPUCommandEncoder,
    frame: VectorSelectionFrame,
    target: VectorEditingOverlayTarget
  ) {
    return this.encode(encoder, selectionFrameOverlay(frame), target, SELECTION_FRAME_THEME);
  }

  /** Encodes the transform cage using the shared GPU editing-overlay path. */
  encodeTransformFrame(
    encoder: GPUCommandEncoder,
    frame: VectorSelectionFrame,
    target: VectorEditingOverlayTarget
  ) {
    return this.encode(encoder, selectionFrameOverlay(frame), target, TRANSFORM_FRAME_THEME);
  }

  /** Encodes non-printing Smart Guides through the same retained GPU overlay path. */
  encodeSmartGuideFrame(
    encoder: GPUCommandEncoder,
    frame: VectorSelectionFrame,
    target: VectorEditingOverlayTarget
  ) {
    return this.encode(encoder, selectionFrameOverlay(frame), target, SMART_GUIDE_FRAME_THEME);
  }

  encodeDocumentGuideFrame(encoder: GPUCommandEncoder, frame: VectorSelectionFrame, target: VectorEditingOverlayTarget) {
    return this.encode(encoder, selectionFrameOverlay(frame), target, DOCUMENT_GUIDE_FRAME_THEME);
  }

  encodeDocumentGridFrame(encoder: GPUCommandEncoder, frame: VectorSelectionFrame, target: VectorEditingOverlayTarget) {
    return this.encode(encoder, selectionFrameOverlay(frame), target, DOCUMENT_GRID_FRAME_THEME);
  }

  /** Call directly after queue.submit for command buffers encoded by this backend. */
  notifySubmitted() {
    this.assertUsable();
    const submitted = this.pendingUniforms.splice(0);
    if (!submitted.length) return Promise.resolve();
    return this.device.queue.onSubmittedWorkDone().catch(() => undefined).then(() => {
      for (const buffer of submitted) buffer.destroy();
    });
  }

  cacheMetrics(): ResourceCacheMetrics {
    return this.resources.metrics();
  }

  invalidatePath(pathId: string) {
    return this.resources.deleteWhere((key) => key.startsWith(`${pathId}:`));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.pendingUniforms) buffer.destroy();
    this.pendingUniforms = [];
    this.resources.clear();
    this.isolatedTexture?.destroy();
    this.isolatedTexture = null;
    this.isolatedOpacityBuffer.destroy();
    this.pipelines.clear();
    this.isolatedCompositePipelines.clear();
  }

  private ensureIsolatedTexture(target: VectorEditingOverlayTarget): GPUTexture {
    if (this.isolatedTexture
      && this.isolatedTextureWidth === target.width
      && this.isolatedTextureHeight === target.height
      && this.isolatedTextureFormat === target.format) return this.isolatedTexture;
    this.isolatedTexture?.destroy();
    this.isolatedTexture = this.device.createTexture({
      label: 'LightTable isolated vector overlay',
      size: [target.width, target.height],
      format: target.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.isolatedTextureWidth = target.width;
    this.isolatedTextureHeight = target.height;
    this.isolatedTextureFormat = target.format;
    return this.isolatedTexture;
  }

  private isolatedCompositePipeline(format: GPUTextureFormat): GPURenderPipeline {
    const cached = this.isolatedCompositePipelines.get(format);
    if (cached) return cached;
    const module = this.device.createShaderModule({
      label: 'LightTable isolated overlay composite shader',
      code: ISOLATED_OVERLAY_COMPOSITE_WGSL
    });
    const pipeline = this.device.createRenderPipeline({
      label: 'LightTable isolated overlay composite',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.isolatedCompositeLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: {
        module, entryPoint: 'fragmentMain', targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.isolatedCompositePipelines.set(format, pipeline);
    return pipeline;
  }

  private prepare(overlay: VectorEditingOverlay) {
    const cached = this.resources.get(overlay.resourceKey);
    if (cached) return cached;
    const curves = cubicData(overlay);
    const handles = handleData(overlay);
    const markers = markerData(overlay);
    const resource: CachedOverlayBuffers = {
      curves: createBuffer(this.device, `LightTable vector overlay curves ${overlay.pathId}`, curves),
      handles: createBuffer(this.device, `LightTable vector overlay handles ${overlay.pathId}`, handles),
      markers: createBuffer(this.device, `LightTable vector overlay markers ${overlay.pathId}`, markers),
      curveCount: curves.byteLength / CUBIC_BYTES,
      handleCount: handles.byteLength / CUBIC_BYTES,
      markerCount: markers.byteLength / MARKER_BYTES,
      bytes: curves.byteLength + handles.byteLength + markers.byteLength
    };
    return this.resources.set(overlay.resourceKey, resource, resource.bytes);
  }

  private drawLines(
    pass: GPURenderPassEncoder,
    buffer: GPUBuffer,
    curveCount: number,
    subdivisions: number,
    width: number,
    color: readonly [number, number, number, number],
    target: VectorEditingOverlayTarget,
    pipeline: GPURenderPipeline,
    theme: VectorEditingOverlayTheme
  ) {
    if (theme.underlayColor && (theme.underlayWidthPx ?? 0) > 0) {
      const underlaySettings = this.createSettings(
        target,
        theme.underlayWidthPx!,
        subdivisions,
        theme.underlayColor,
        0,
        0
      );
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.bindGroup(underlaySettings, buffer));
      pass.draw(6, curveCount * subdivisions);
    }
    const settings = this.createSettings(
      target,
      width,
      subdivisions,
      color,
      theme.dashLengthPx ?? 0,
      theme.gapLengthPx ?? 0,
      theme.dashOffsetPx ?? 0
    );
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup(settings, buffer));
    pass.draw(6, curveCount * subdivisions);
  }

  private createSettings(
    target: VectorEditingOverlayTarget,
    width: number,
    subdivisions: number,
    color: readonly [number, number, number, number],
    dashLength = 0,
    gapLength = 0,
    dashOffset = 0
  ) {
    const settings = this.device.createBuffer({
      label: 'LightTable vector overlay settings',
      size: SETTINGS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const matrix = target.documentToViewport;
    this.device.queue.writeBuffer(settings, 0, new Float32Array([
      matrix.a, matrix.b, matrix.c, matrix.d,
      matrix.tx, matrix.ty, target.width, target.height,
      width, subdivisions, dashLength, gapLength,
      ...color,
      dashOffset, 0, 0, 0
    ]));
    this.pendingUniforms.push(settings);
    return settings;
  }

  private bindGroup(settings: GPUBuffer, geometry: GPUBuffer) {
    return this.device.createBindGroup({
      label: 'LightTable vector overlay bind group',
      layout: this.settingsLayout,
      entries: [
        { binding: 0, resource: { buffer: settings } },
        { binding: 1, resource: { buffer: geometry } }
      ]
    });
  }

  private pipelineBundle(format: GPUTextureFormat) {
    const cached = this.pipelines.get(format);
    if (cached) return cached;
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.settingsLayout] });
    const lineModule = this.device.createShaderModule({
      label: 'LightTable vector editing overlay line shader',
      code: VECTOR_EDITING_OVERLAY_LINE_WGSL
    });
    const markerModule = this.device.createShaderModule({
      label: 'LightTable vector editing overlay marker shader',
      code: VECTOR_EDITING_OVERLAY_MARKER_WGSL
    });
    const fragmentTarget: GPUColorTargetState = {
      format,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
      }
    };
    const bundle = {
      lines: this.device.createRenderPipeline({
        label: 'LightTable vector editing overlay lines',
        layout,
        vertex: { module: lineModule, entryPoint: 'lineVertex' },
        fragment: { module: lineModule, entryPoint: 'lineFragment', targets: [fragmentTarget] },
        primitive: { topology: 'triangle-list' }
      }),
      markers: this.device.createRenderPipeline({
        label: 'LightTable vector editing overlay markers',
        layout,
        vertex: { module: markerModule, entryPoint: 'markerVertex' },
        fragment: { module: markerModule, entryPoint: 'markerFragment', targets: [fragmentTarget] },
        primitive: { topology: 'triangle-list' }
      })
    };
    this.pipelines.set(format, bundle);
    return bundle;
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Vector editing overlay backend is disposed.');
  }
}
