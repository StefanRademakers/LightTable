import {
  createPaintSceneCompileResult,
  PAINT_SCENE_SCHEMA_VERSION,
  type PaintSceneCapabilityIssue,
  type PaintSceneColor,
  type PaintSceneCommand,
  type PaintScene,
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
  transformPoint,
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
  /** Prevents canonical element IDs from colliding in cross-layer scenes. */
  readonly stableIdNamespace?: string;
  /** Optional canonical vector clip, expressed in the same layer space. */
  readonly clip?: {
    readonly stableId: string;
    readonly revisionKey: string;
    readonly elements: readonly VectorElement[];
  };
  /** Optional diagnostics hook. Omitted from interactive production renders. */
  readonly profile?: (
    phase: 'canonical-projection' | 'js-object-construction' | 'scene-validation',
    durationMs: number
  ) => void;
  readonly now?: () => number;
}

const matrix = (value: AffineMatrix): PaintSceneMatrix =>
  [value.a, value.b, value.c, value.d, value.tx, value.ty];

const transformedPathCommands = (
  commands: readonly PaintScenePathCommand[],
  transform: AffineMatrix
): PaintScenePathCommand[] => commands.map((command) => {
  if (command.kind === 'close') return command;
  if (command.kind === 'move' || command.kind === 'line') {
    const point = transformPoint(transform, command);
    return { kind: command.kind, x: point.x, y: point.y };
  }
  const control1 = transformPoint(transform, {
    x: command.control1X, y: command.control1Y
  });
  const control2 = transformPoint(transform, {
    x: command.control2X, y: command.control2Y
  });
  const point = transformPoint(transform, command);
  return {
    kind: 'cubic', control1X: control1.x, control1Y: control1.y,
    control2X: control2.x, control2Y: control2.y, x: point.x, y: point.y
  };
});

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
  const profileNow = options.profile ? options.now ?? Date.now : null;
  const parentTransform = options.parentTransform ?? identityAffineMatrix();
  const fragments = elements.map(element => {
    const projectionStartedAt = profileNow?.() ?? 0;
    const path = element.type === 'live-shape' ? realizeLiveShape(element) : element;
    const pathCommands = compileVectorPathCommands(path);
    const pathTransform = multiplyMatrices(parentTransform, path.transform);
    if (options.profile) {
      options.profile('canonical-projection', profileNow!() - projectionStartedAt);
    }
    const objectStartedAt = profileNow?.() ?? 0;
    const commands: PaintSceneCommand[] = [];
    const stableId = options.stableIdNamespace
      ? `${options.stableIdNamespace}:${element.id}`
      : element.id;
    const pathId = `${stableId}:path`;

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

    const fragment = {
      stableId,
      revisionKey: `${element.geometryRevision}:${element.transformRevision}:${element.styleRevision}`,
      paths: [{ stableId: pathId, revisionKey: String(element.geometryRevision), commands: pathCommands }],
      commands
    };
    if (options.profile) {
      options.profile('js-object-construction', profileNow!() - objectStartedAt);
    }
    return fragment;
  });

  const clipProjectionStartedAt = profileNow?.() ?? 0;
  const clipElement = options.clip?.elements.length === 1
    ? options.clip.elements[0]
    : null;
  const clipPath = clipElement
    ? (clipElement.type === 'live-shape' ? realizeLiveShape(clipElement) : clipElement)
    : null;
  const clipCommands = clipPath ? transformedPathCommands(
    compileVectorPathCommands(clipPath),
    multiplyMatrices(parentTransform, clipPath.transform)
  ) : [];
  if (options.profile) {
    options.profile('canonical-projection', profileNow!() - clipProjectionStartedAt);
  }
  const finalObjectsStartedAt = profileNow?.() ?? 0;
  if (options.clip && options.clip.elements.length !== 1) {
    issues.push({
      stableId: options.clip.stableId,
      feature: 'compound-vector-clip-union',
      reason: 'Multiple vector clip operands require an exact boolean union before rendering.',
      fallback: 'preserve-only'
    });
  } else if (options.clip && clipCommands.length === 0) {
    issues.push({
      stableId: options.clip.stableId,
      feature: 'empty-vector-clip',
      reason: 'The canonical vector clip contains no drawable contours.',
      fallback: 'preserve-only'
    });
  }
  const clipStableId = options.clip && options.stableIdNamespace
    ? `${options.stableIdNamespace}:${options.clip.stableId}`
    : options.clip?.stableId;
  const clips = options.clip && clipCommands.length ? [{
    stableId: clipStableId!,
    revisionKey: options.clip.revisionKey,
    path: {
      stableId: `${clipStableId}:path`,
      revisionKey: options.clip.revisionKey,
      commands: clipCommands
    },
    transform: matrix(identityAffineMatrix()),
    // Separate clip elements are a geometric union. Nonzero winding preserves
    // that union after the adapter bakes every child transform into one path.
    fillRule: clipPath?.fillRule ?? 'nonzero'
  }] : [];
  const flatComposition = fragments.map(({ stableId }) => ({
    kind: 'fragment' as const, stableId
  }));

  if (options.profile) {
    options.profile('js-object-construction', profileNow!() - finalObjectsStartedAt);
  }

  const validationStartedAt = profileNow?.() ?? 0;
  const result = createPaintSceneCompileResult({
    schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
    sourceId: options.sourceId,
    sourceRevision: options.sourceRevision,
    fragments,
    clips,
    composition: clips.length ? [{
      kind: 'clip' as const,
      stableId: clips[0]!.stableId,
      children: flatComposition
    }] : flatComposition
  }, issues);
  if (options.profile) {
    options.profile('scene-validation', profileNow!() - validationStartedAt);
  }
  return result;
};

export interface VectorPaintSceneIslandMember {
  readonly layerId: string;
  readonly sourceRevision: string;
  readonly elements: readonly VectorElement[];
  readonly parentTransform: AffineMatrix;
  readonly participates?: boolean;
  readonly clip?: CompileVectorPaintSceneOptions['clip'];
}

export interface CompileVectorPaintSceneIslandOptions {
  readonly profile?: CompileVectorPaintSceneOptions['profile'];
  readonly now?: CompileVectorPaintSceneOptions['now'];
  readonly clip?: CompileVectorPaintSceneOptions['clip'] & {
    readonly parentTransform: AffineMatrix;
    readonly stableIdNamespace: string;
  };
}

export interface CompiledVectorPaintSceneIslandMember {
  readonly member: VectorPaintSceneIslandMember;
  readonly result: PaintSceneCompileResult;
}

export const composeVectorPaintSceneParts = (
  sourceId: string,
  sourceRevision: string,
  parts: readonly PaintSceneCompileResult[],
  compiledClip: PaintSceneCompileResult | null = null
): PaintSceneCompileResult => {
  const composition = parts.flatMap(result => result.scene.composition);
  return createPaintSceneCompileResult({
    schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
    sourceId,
    sourceRevision,
    fragments: parts.flatMap(result => result.scene.fragments),
    clips: [
      ...parts.flatMap(result => result.scene.clips),
      ...(compiledClip?.scene.clips ?? [])
    ],
    composition: compiledClip?.scene.clips[0] ? [{
      kind: 'clip', stableId: compiledClip.scene.clips[0].stableId,
      children: composition
    }] : composition
  }, [
    ...parts.flatMap(result => result.issues),
    ...(compiledClip?.issues ?? [])
  ]);
};

export const compileVectorPaintSceneIslandMember = (
  sourceId: string,
  member: VectorPaintSceneIslandMember,
  options: Pick<CompileVectorPaintSceneIslandOptions, 'profile' | 'now'> = {}
): CompiledVectorPaintSceneIslandMember => ({
  member,
  result: compileVectorPaintScene(member.elements, {
    sourceId: `${sourceId}:${member.layerId}`,
    sourceRevision: member.sourceRevision,
    parentTransform: member.parentTransform,
    stableIdNamespace: member.layerId,
    ...(member.clip ? { clip: member.clip } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.now ? { now: options.now } : {})
  })
});

export const composeVectorPaintSceneIsland = (
  sourceId: string,
  sourceRevision: string,
  compiled: readonly CompiledVectorPaintSceneIslandMember[],
  compiledIslandClip: PaintSceneCompileResult | null = null
): PaintSceneCompileResult => {
  const flatComposition = compiled.flatMap(({ member, result }) => (
    member.participates === false ? [] : result.scene.composition
  ));
  const scene: PaintScene = {
    schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
    sourceId,
    sourceRevision,
    fragments: compiled.flatMap(({ result }) => result.scene.fragments),
    clips: [
      ...compiled.flatMap(({ result }) => result.scene.clips),
      ...(compiledIslandClip?.scene.clips ?? [])
    ],
    composition: compiledIslandClip?.scene.clips[0] ? [{
      kind: 'clip',
      stableId: compiledIslandClip.scene.clips[0].stableId,
      children: flatComposition
    }] : flatComposition
  };
  return createPaintSceneCompileResult(scene, [
    ...compiled.flatMap(({ result }) => result.issues),
    ...(compiledIslandClip?.issues ?? [])
  ]);
};

/**
 * Projects independently editable canonical layers into one retained scene.
 * Fragment IDs remain stable and layer-qualified; no canonical data is merged.
 */
export const compileVectorPaintSceneIsland = (
  sourceId: string,
  sourceRevision: string,
  members: readonly VectorPaintSceneIslandMember[],
  options: CompileVectorPaintSceneIslandOptions = {}
): PaintSceneCompileResult => {
  const compiled = members.map(member => compileVectorPaintSceneIslandMember(
    sourceId, member, options
  ));
  const compiledIslandClip = options.clip ? compileVectorPaintScene([], {
    sourceId: `${sourceId}:island-clip`,
    sourceRevision: options.clip.revisionKey,
    parentTransform: options.clip.parentTransform,
    stableIdNamespace: options.clip.stableIdNamespace,
    clip: options.clip,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.now ? { now: options.now } : {})
  }) : null;
  return composeVectorPaintSceneIsland(
    sourceId, sourceRevision, compiled, compiledIslandClip
  );
};
