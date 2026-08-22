import type {
  PaintScene,
  PaintSceneCommand,
  PaintSceneFragment,
  PaintScenePath,
  PaintScenePathCommand
} from '@lighttable/paint-scene';
import type {
  VectorAnchor,
  VectorPath,
  VectorSubpath
} from '@lighttable/vector-core';
import {
  quantizeDocumentTolerance,
  realizeVectorPath,
  RevisionedResourceCache,
  type RealizedVectorGeometry
} from '@lighttable/vector-rendering';
import {
  VectorFillBackend,
  type VectorFillSurface,
  type VectorFillTarget
} from './VectorFillBackend';

const GEOMETRY_CACHE_BYTES = 64 * 1024 * 1024;

const anchor = (id: string, x: number, y: number): VectorAnchor => ({
  id, position: { x, y }, handleIn: null, handleOut: null, mode: 'corner'
});

const samePoint = (anchorValue: VectorAnchor, command: Extract<PaintScenePathCommand, { kind: 'cubic' }>) =>
  anchorValue.position.x === command.x && anchorValue.position.y === command.y;

/** Reconstructs exact cubic authority for the existing LT geometry realizer. */
export const paintScenePathToVectorPath = (
  definition: PaintScenePath,
  cacheNamespace = ''
): VectorPath => {
  const subpaths: VectorSubpath[] = [];
  let current: VectorSubpath | null = null;
  const finish = () => {
    if (current) subpaths.push(current);
    current = null;
  };

  definition.commands.forEach((command, commandIndex) => {
    if (command.kind === 'move') {
      finish();
      current = {
        id: `${definition.stableId}:subpath:${subpaths.length}`,
        closed: false,
        anchors: [anchor(`${definition.stableId}:anchor:${commandIndex}`, command.x, command.y)]
      };
      return;
    }
    if (!current) throw new Error(`Paint-scene path ${definition.stableId} starts without move.`);
    if (command.kind === 'close') {
      current.closed = true;
      finish();
      return;
    }
    if (command.kind === 'line') {
      current.anchors.push(anchor(`${definition.stableId}:anchor:${commandIndex}`, command.x, command.y));
      return;
    }

    const previous = current.anchors[current.anchors.length - 1];
    previous.handleOut = { x: command.control1X, y: command.control1Y };
    const first = current.anchors[0];
    const closesNext = definition.commands[commandIndex + 1]?.kind === 'close' && samePoint(first, command);
    if (closesNext) {
      first.handleIn = { x: command.control2X, y: command.control2Y };
    } else {
      const next = anchor(`${definition.stableId}:anchor:${commandIndex}`, command.x, command.y);
      next.handleIn = { x: command.control2X, y: command.control2Y };
      current.anchors.push(next);
    }
  });
  finish();

  return {
    id: `${cacheNamespace}${definition.stableId}@${definition.revisionKey}`,
    type: 'path',
    name: definition.stableId,
    subpaths,
    fillRule: 'nonzero',
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    style: { fill: null, stroke: null, opacity: 1 },
    geometryRevision: 0,
    transformRevision: 0,
    styleRevision: 0
  };
};

const commandPath = (
  geometry: VectorPath,
  command: PaintSceneCommand
): VectorPath => ({
  ...geometry,
  fillRule: command.kind === 'fill-path' ? command.fillRule : 'nonzero',
  transform: {
    a: command.transform[0], b: command.transform[1],
    c: command.transform[2], d: command.transform[3],
    tx: command.transform[4], ty: command.transform[5]
  },
  style: command.kind === 'fill-path' ? {
    fill: { type: 'solid', color: command.color }, stroke: null, opacity: 1
  } : {
    fill: null,
    stroke: {
      paint: { type: 'solid', color: command.color },
      width: command.stroke.width,
      alignment: 'center',
      cap: command.stroke.cap,
      join: command.stroke.join,
      miterLimit: command.stroke.miterLimit,
      dash: [...command.stroke.dash],
      dashOffset: command.stroke.dashOffset
    },
    opacity: 1
  }
});

export interface PaintSceneWebGpuEncodeMetrics {
  readonly fragmentCount: number;
  readonly pathCount: number;
  readonly commandCount: number;
  readonly encodedDrawCount: number;
}

/**
 * Current LightTable WebGPU consumer for the shared scene contract. It keeps
 * the existing stencil/fill backend and its behavior, while geometry cache
 * identity derives solely from path revision keys.
 */
export class PaintSceneWebGpuBackend {
  private readonly backend: VectorFillBackend;
  private readonly geometry: RevisionedResourceCache<{
    readonly path: VectorPath;
    readonly realized: RealizedVectorGeometry;
  }>;

  constructor(device: GPUDevice, geometryCacheBytes = GEOMETRY_CACHE_BYTES) {
    this.backend = new VectorFillBackend(device);
    this.geometry = new RevisionedResourceCache(geometryCacheBytes);
  }

  createSurface(
    width: number,
    height: number,
    format: GPUTextureFormat = 'rgba16float',
    antiAlias = true
  ): VectorFillSurface {
    return this.backend.createSurface(width, height, format, antiAlias);
  }

  encode(
    encoder: GPUCommandEncoder,
    scene: PaintScene,
    target: VectorFillTarget,
    requestedTolerance = 0.25
  ): PaintSceneWebGpuEncodeMetrics {
    const tolerance = quantizeDocumentTolerance(requestedTolerance);
    let pathCount = 0;
    let commandCount = 0;
    let encodedDrawCount = 0;

    for (const fragment of scene.fragments) {
      const paths = this.fragmentPaths(fragment, tolerance);
      pathCount += paths.size;
      for (const command of fragment.commands) {
        commandCount += 1;
        const cached = paths.get(command.pathId);
        if (!cached) throw new Error(
          `Paint-scene fragment ${fragment.stableId} references missing path ${command.pathId}.`
        );
        const path = commandPath(cached.path, command);
        const encoded = command.kind === 'fill-path'
          ? this.backend.encodeFill(encoder, path, cached.realized, target)
          : this.backend.encodeStroke(encoder, path, cached.realized, target);
        if (encoded) encodedDrawCount += 1;
      }
    }
    return {
      fragmentCount: scene.fragments.length,
      pathCount,
      commandCount,
      encodedDrawCount
    };
  }

  notifySubmitted() {
    return this.backend.notifySubmitted();
  }

  metrics() {
    return {
      geometry: this.geometry.metrics(),
      backend: this.backend.cacheMetrics()
    };
  }

  dispose() {
    this.geometry.clear();
    this.backend.dispose();
  }

  private fragmentPaths(fragment: PaintSceneFragment, tolerance: number) {
    const paths = new Map<string, { path: VectorPath; realized: RealizedVectorGeometry }>();
    for (const definition of fragment.paths) {
      const cacheKey = `${fragment.stableId}:${definition.stableId}:${definition.revisionKey}:${tolerance}`;
      const cached = this.geometry.get(cacheKey);
      if (cached) {
        paths.set(definition.stableId, cached);
        continue;
      }
      const path = paintScenePathToVectorPath(definition, `${fragment.stableId}:`);
      const realized = realizeVectorPath(path, tolerance);
      paths.set(definition.stableId, this.geometry.set(
        cacheKey,
        { path, realized },
        realized.estimatedBytes
      ));
    }
    return paths;
  }
}
