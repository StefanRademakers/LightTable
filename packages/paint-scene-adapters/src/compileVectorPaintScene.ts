import {
  createPaintSceneCompileResult,
  PAINT_SCENE_SCHEMA_VERSION,
  type PaintSceneCapabilityIssue,
  type PaintSceneColor,
  type PaintSceneCommand,
  type PaintSceneCompileResult,
  type PaintSceneMatrix,
  type PaintScenePathCommand
} from '@lighttable/paint-scene';
import {
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
}

const matrix = (value: AffineMatrix): PaintSceneMatrix =>
  [value.a, value.b, value.c, value.d, value.tx, value.ty];

const isSolidPaint = (paint: VectorPaint): paint is SolidPaint => 'type' in paint && paint.type === 'solid';

const color = (paint: SolidPaint, opacity: number): PaintSceneColor => [
  paint.color[0], paint.color[1], paint.color[2], paint.color[3] * opacity
];

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
  reason: `The initial shared paint-scene slice does not encode ${target} gradients yet.`,
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
  const fragments = elements.map(element => {
    const path = element.type === 'live-shape' ? realizeLiveShape(element) : element;
    const pathCommands = compileVectorPathCommands(path);
    const commands: PaintSceneCommand[] = [];
    const stableId = element.id;
    const pathId = `${element.id}:path`;

    if (path.style.fill) {
      if (isSolidPaint(path.style.fill)) {
        commands.push({
          kind: 'fill-path', pathId, transform: matrix(path.transform),
          fillRule: path.fillRule, color: color(path.style.fill, path.style.opacity)
        });
      } else {
        unsupportedPaint(issues, stableId, 'fill');
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
          kind: 'stroke-path', pathId, transform: matrix(path.transform),
          color: color(
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
        unsupportedPaint(issues, stableId, 'stroke');
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
