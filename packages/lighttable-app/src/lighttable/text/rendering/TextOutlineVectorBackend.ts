import { transformedBounds, type Rect } from '@lighttable/vector-core';
import { VectorFillBackend, type VectorFillTarget } from '@lighttable/vector-webgpu';
import type { TextOutlineVectorDraw } from './prepareTextOutlineVectorDraws';

const DEFAULT_MAXIMUM_SOURCE_BYTES = 64 * 1024 * 1024;

export interface PreparedTextOutlineSurface {
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  readonly sourceBounds: Rect;
  readonly byteLength: number;
  dispose(): void;
}

interface TextOutlineVectorBackendOptions {
  readonly maximumTextureDimension: number;
  readonly maximumSourceBytes?: number;
  readonly antiAlias?: boolean;
}

type VectorBackendPort = Pick<VectorFillBackend,
  'createSurface' | 'encodeFill' | 'encodeStroke' | 'notifySubmitted' | 'cacheMetrics' | 'dispose'>;

const union = (left: Rect | null, right: Rect): Rect => left ? {
  x: Math.min(left.x, right.x),
  y: Math.min(left.y, right.y),
  width: Math.max(left.x + left.width, right.x + right.width) - Math.min(left.x, right.x),
  height: Math.max(left.y + left.height, right.y + right.height) - Math.min(left.y, right.y)
} : { ...right };

const maximumScale = (path: TextOutlineVectorDraw['path']) => {
  const { a, b, c, d } = path.transform;
  const sum = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  return Math.sqrt(Math.max(0, (sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2));
};

const intersect = (bounds: Rect, clip: Rect): Rect | null => {
  const x = Math.max(bounds.x, clip.x);
  const y = Math.max(bounds.y, clip.y);
  const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
  const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};

export const tightTextOutlineBounds = (
  draws: readonly TextOutlineVectorDraw[],
  fringe = 2
): Rect | null => {
  if (!Number.isFinite(fringe) || fringe < 0) {
    throw new TypeError('Text outline fringe must be finite and non-negative.');
  }
  let bounds: Rect | null = null;
  for (const draw of draws) {
    if (!draw.geometry.localBounds) continue;
    let glyphBounds = transformedBounds(draw.path.transform, draw.geometry.localBounds);
    const stroke = draw.path.style.stroke;
    if (stroke) {
      const expansion = stroke.width * maximumScale(draw.path)
        * Math.max(1, stroke.join === 'miter' ? stroke.miterLimit : 1) / 2;
      glyphBounds = {
        x: glyphBounds.x - expansion,
        y: glyphBounds.y - expansion,
        width: glyphBounds.width + expansion * 2,
        height: glyphBounds.height + expansion * 2
      };
    }
    if (draw.clip) {
      const clipped = intersect(glyphBounds, draw.clip);
      if (!clipped) continue;
      glyphBounds = clipped;
    }
    bounds = union(bounds, glyphBounds);
  }
  if (!bounds) return null;
  const x = Math.floor(bounds.x - fringe);
  const y = Math.floor(bounds.y - fringe);
  return {
    x, y,
    width: Math.ceil(bounds.x + bounds.width + fringe) - x,
    height: Math.ceil(bounds.y + bounds.height + fringe) - y
  };
};

/** Encodes scale-independent text outlines through the native vector WebGPU backend. */
export class TextOutlineVectorBackend {
  private readonly vector: VectorBackendPort;

  constructor(
    device: GPUDevice,
    private readonly options: TextOutlineVectorBackendOptions,
    vectorBackend?: VectorBackendPort
  ) {
    this.vector = vectorBackend ?? new VectorFillBackend(device);
  }

  encodeTight(
    encoder: GPUCommandEncoder,
    draws: readonly TextOutlineVectorDraw[]
  ): PreparedTextOutlineSurface | null {
    const sourceBounds = tightTextOutlineBounds(draws);
    if (!sourceBounds) return null;
    const width = Math.ceil(sourceBounds.width);
    const height = Math.ceil(sourceBounds.height);
    const antiAlias = this.options.antiAlias ?? true;
    const sampleCount = antiAlias ? 4 : 1;
    // Resolved rgba16float plus retained multisample color and depth/stencil.
    const byteLength = width * height * (8 + sampleCount * 12);
    const maximumBytes = this.options.maximumSourceBytes ?? DEFAULT_MAXIMUM_SOURCE_BYTES;
    if (width > this.options.maximumTextureDimension
      || height > this.options.maximumTextureDimension
      || byteLength > maximumBytes) {
      throw new RangeError('Tight outline text source exceeds the bounded GPU texture budget.');
    }
    const surface = this.vector.createSurface(width, height, 'rgba16float', antiAlias);
    try {
      const clear = encoder.beginRenderPass({
        label: 'Clear tight outline text source',
        colorAttachments: [{
          view: surface.renderColorView,
          resolveTarget: surface.sampleCount > 1 ? surface.colorView : undefined,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear', storeOp: 'store'
        }]
      });
      clear.end();
      for (const draw of draws) {
        const target: VectorFillTarget = {
          colorView: surface.renderColorView,
          resolveView: surface.sampleCount > 1 ? surface.colorView : null,
          stencilView: surface.stencilView,
          format: surface.format,
          sampleCount: surface.sampleCount,
          origin: { x: sourceBounds.x, y: sourceBounds.y },
          width, height,
          ...(draw.clip ? { clip: draw.clip } : {})
        };
        this.vector.encodeFill(encoder, draw.path, draw.geometry, target);
        this.vector.encodeStroke(encoder, draw.path, draw.geometry, target);
      }
      return {
        texture: surface.color, width, height, sourceBounds, byteLength,
        dispose: () => surface.dispose()
      };
    } catch (error) {
      surface.dispose();
      throw error;
    }
  }

  notifySubmitted() {
    return this.vector.notifySubmitted();
  }

  cacheMetrics() {
    return this.vector.cacheMetrics();
  }

  dispose() {
    this.vector.dispose();
  }
}
