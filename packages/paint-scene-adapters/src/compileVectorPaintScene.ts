import {
  createPaintSceneCompileResult,
  PAINT_SCENE_SCHEMA_VERSION,
  type PaintSceneCapabilityIssue,
  type PaintSceneColor,
  type PaintSceneCommand,
  type PaintSceneCompileResult,
  type PaintSceneGradientPaint,
  type PaintSceneMatrix,
  type PaintScenePaint,
  type PaintScenePathCommand
} from '@lighttable/paint-scene';
import {
  gradientPaintIsValid,
  sampleGradientAsset,
  type GradientPaintInstance
} from '@lighttable/paint-core';
import {
  identityAffineMatrix,
  multiplyMatrices,
  pathBounds,
  realizeLiveShape,
  type AffineMatrix,
  type SolidPaint,
  type VectorElement,
  type VectorPaint,
  type VectorPath,
  type VectorSubpath
} from '@lighttable/vector-core';

export interface CompileVectorPaintSceneOptions {
  readonly sourceId: string;
  /** Canonical document/layer revision, not a view or renderer revision. */
  readonly sourceRevision: string;
  /** Maps vector-layer coordinates into the backend-neutral scene. */
  readonly parentTransform?: AffineMatrix;
}

const matrix = (value: AffineMatrix): PaintSceneMatrix =>
  [value.a, value.b, value.c, value.d, value.tx, value.ty];

const isSolidPaint = (paint: VectorPaint): paint is SolidPaint => 'type' in paint && paint.type === 'solid';

const color = (paint: SolidPaint, opacity: number): PaintSceneColor => [
  paint.color[0], paint.color[1], paint.color[2], paint.color[3] * opacity
];

const solidPaint = (paint: SolidPaint, opacity: number): PaintScenePaint => ({
  kind: 'solid',
  color: color(paint, opacity)
});

const GRADIENT_RAMP_SAMPLES = 256;
const srgbToLinear = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

const gradientPaint = (
  paint: GradientPaintInstance,
  opacity: number,
  path: VectorPath,
  parentTransform: AffineMatrix,
  pathTransform: AffineMatrix
): PaintSceneGradientPaint | null => {
  if (!gradientPaintIsValid(paint) || paint.asset.type !== 'solid' || paint.shape === 'diamond') {
    return null;
  }
  const bounds = pathBounds(path);
  let sceneTransform: AffineMatrix;
  if (paint.coordinateSpace === 'object-bounds') {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    sceneTransform = multiplyMatrices(pathTransform, multiplyMatrices({
      a: bounds.width, b: 0, c: 0, d: bounds.height, tx: bounds.x, ty: bounds.y
    }, paint.transform));
  } else if (paint.coordinateSpace === 'layer') {
    sceneTransform = multiplyMatrices(parentTransform, paint.transform);
  } else {
    sceneTransform = paint.transform;
  }
  return {
    kind: 'gradient',
    shape: paint.shape,
    transform: matrix(sceneTransform),
    ...(paint.shape === 'radial' && paint.radialFocus
      ? { radialFocus: [paint.radialFocus.x, paint.radialFocus.y] as const }
      : {}),
    ...(paint.shape === 'radial' && paint.radialStartRadius !== undefined
      ? { radialStartRadius: paint.radialStartRadius }
      : {}),
    spread: paint.spread ?? 'pad',
    dither: paint.dither,
    stops: Array.from({ length: GRADIENT_RAMP_SAMPLES }, (_, index) => {
      const offset = index / (GRADIENT_RAMP_SAMPLES - 1);
      const sample = sampleGradientAsset(paint.asset, paint.reverse ? 1 - offset : offset);
      return {
        offset,
        color: [
          srgbToLinear(sample.r),
          srgbToLinear(sample.g),
          srgbToLinear(sample.b),
          sample.a * opacity
        ] as PaintSceneColor
      };
    })
  };
};

const appendSegment = (
  commands: PaintScenePathCommand[],
  start: VectorSubpath['anchors'][number],
  end: VectorSubpath['anchors'][number]
) => {
  if (start.handleOut || end.handleIn) {
    const control1 = start.handleOut ?? start.position;
    const control2 = end.handleIn ?? end.position;
    commands.push({
      kind: 'cubic',
      control1X: control1.x, control1Y: control1.y,
      control2X: control2.x, control2Y: control2.y,
      x: end.position.x, y: end.position.y
    });
  } else {
    commands.push({ kind: 'line', x: end.position.x, y: end.position.y });
  }
};

export const compileVectorPathCommands = (path: VectorPath): readonly PaintScenePathCommand[] => {
  const commands: PaintScenePathCommand[] = [];
  for (const subpath of path.subpaths) {
    const first = subpath.anchors[0];
    if (!first) continue;
    commands.push({ kind: 'move', x: first.position.x, y: first.position.y });
    for (let index = 1; index < subpath.anchors.length; index += 1) {
      appendSegment(commands, subpath.anchors[index - 1], subpath.anchors[index]);
    }
    if (subpath.closed) {
      const last = subpath.anchors[subpath.anchors.length - 1];
      // close supplies a straight final segment itself. Emit an explicit cubic
      // only when closing handles make that final segment curved.
      if (last !== first && (last.handleOut || first.handleIn)) {
        appendSegment(commands, last, first);
      }
      commands.push({ kind: 'close' });
    }
  }
  return commands;
};

const unsupportedPaint = (
  issues: PaintSceneCapabilityIssue[],
  stableId: string,
  target: 'fill' | 'stroke'
) => issues.push({
  stableId,
  feature: `gradient-${target}`,
  reason: `The gradient ${target} cannot be represented by the shared paint scene.`,
  fallback: 'current-backend'
});

/**
 * Compiles canonical vector elements without flattening curves. Unsupported
 * paint semantics are reported and omitted; the caller must select a fallback.
 */
export const compileVectorPaintScene = (
  elements: readonly VectorElement[],
  options: CompileVectorPaintSceneOptions
): PaintSceneCompileResult => {
  const issues: PaintSceneCapabilityIssue[] = [];
  const parentTransform = options.parentTransform ?? identityAffineMatrix();
  const fragments = elements.map(element => {
    const path = element.type === 'live-shape' ? realizeLiveShape(element) : element;
    const pathCommands = compileVectorPathCommands(path);
    const commands: PaintSceneCommand[] = [];
    const stableId = element.id;
    const pathId = `${element.id}:path`;
    const pathTransform = multiplyMatrices(parentTransform, path.transform);

    if (path.style.fill) {
      if (isSolidPaint(path.style.fill)) {
        commands.push({
          kind: 'fill-path', pathId, transform: matrix(pathTransform),
          fillRule: path.fillRule, paint: solidPaint(path.style.fill, path.style.opacity)
        });
      } else {
        const paint = gradientPaint(
          path.style.fill, path.style.opacity, path, parentTransform, pathTransform
        );
        if (paint) commands.push({
          kind: 'fill-path', pathId, transform: matrix(pathTransform),
          fillRule: path.fillRule, paint
        });
        else unsupportedPaint(issues, stableId, 'fill');
      }
    }

    if (path.style.stroke) {
      if ((path.style.stroke.alignment ?? 'center') !== 'center') {
        issues.push({
          stableId,
          feature: `stroke-alignment-${path.style.stroke.alignment}`,
          reason: 'The shared backend contract currently supports centered strokes only.',
          fallback: 'current-backend'
        });
      } else if (isSolidPaint(path.style.stroke.paint)) {
        commands.push({
          kind: 'stroke-path', pathId, transform: matrix(pathTransform),
          paint: solidPaint(
            path.style.stroke.paint,
            path.style.opacity * (path.style.stroke.opacity ?? 1)
          ),
          stroke: {
            width: path.style.stroke.width,
            cap: path.style.stroke.cap,
            join: path.style.stroke.join,
            miterLimit: path.style.stroke.miterLimit,
            dash: [...path.style.stroke.dash],
            dashOffset: path.style.stroke.dashOffset
          }
        });
      } else {
        const paint = gradientPaint(
          path.style.stroke.paint,
          path.style.opacity * (path.style.stroke.opacity ?? 1),
          path,
          parentTransform,
          pathTransform
        );
        if (paint) commands.push({
          kind: 'stroke-path', pathId, transform: matrix(pathTransform), paint,
          stroke: {
            width: path.style.stroke.width,
            cap: path.style.stroke.cap,
            join: path.style.stroke.join,
            miterLimit: path.style.stroke.miterLimit,
            dash: [...path.style.stroke.dash],
            dashOffset: path.style.stroke.dashOffset
          }
        });
        else unsupportedPaint(issues, stableId, 'stroke');
      }
    }

    return {
      stableId,
      revisionKey: `${element.geometryRevision}:${element.transformRevision}:${element.styleRevision}`,
      paths: [{ stableId: pathId, revisionKey: String(element.geometryRevision), commands: pathCommands }],
      commands
    };
  });

  return createPaintSceneCompileResult({
    schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
    sourceId: options.sourceId,
    sourceRevision: options.sourceRevision,
    fragments
  }, issues);
};
