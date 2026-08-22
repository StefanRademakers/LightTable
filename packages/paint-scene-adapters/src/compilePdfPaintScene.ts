import {
  createPaintSceneCompileResult,
  PAINT_SCENE_SCHEMA_VERSION,
  type PaintSceneCapabilityIssue,
  type PaintSceneColor,
  type PaintSceneCommand,
  type PaintSceneCompileResult,
  type PaintScenePathCommand
} from '@lighttable/paint-scene';
import type {
  PdfPagePaintSnapshot,
  PdfPageScene,
  PdfPaint,
  PdfPathData
} from '@lighttable/pdf-core';

export interface CompilePdfPaintSceneOptions {
  /** Source-byte or normalized-display-list revision, never a view revision. */
  readonly sourceRevision: string;
}

const pathCommands = (path: PdfPathData): readonly PaintScenePathCommand[] => path.commands.map(command => {
  switch (command.kind) {
    case 'move': return { kind: 'move', x: command.point.x, y: command.point.y };
    case 'line': return { kind: 'line', x: command.point.x, y: command.point.y };
    case 'cubic': return {
      kind: 'cubic',
      control1X: command.control1.x, control1Y: command.control1.y,
      control2X: command.control2.x, control2Y: command.control2.y,
      x: command.point.x, y: command.point.y
    };
    case 'close': return { kind: 'close' };
  }
});

const supportedColor = (paint: PdfPaint, alpha: number): PaintSceneColor | null => {
  if (paint.kind === 'device-gray') return [paint.gray, paint.gray, paint.gray, alpha];
  if (paint.kind === 'device-rgb') return [paint.r, paint.g, paint.b, alpha];
  return null;
};

const blockingStateFeature = (state: PdfPagePaintSnapshot): string | null => {
  if (state.clips.length > 0) return 'clip';
  if (state.softMaskResourceId) return 'soft-mask';
  if (state.transparencyGroups.length > 0) return 'transparency-group';
  if (state.blendMode !== 'normal') return `blend-${state.blendMode}`;
  return null;
};

const addIssue = (
  issues: PaintSceneCapabilityIssue[],
  stableId: string,
  feature: string,
  reason: string,
  fallback: PaintSceneCapabilityIssue['fallback'] = 'current-backend'
) => issues.push({ stableId, feature, reason, fallback });

/**
 * Compiles the exact PDF subset shared by both vector backends. PDF-specific
 * authority (color spaces, text, forms, masks and preserved operators) stays in
 * PdfPageScene and is never normalized away here.
 */
export const compilePdfPaintScene = (
  page: PdfPageScene,
  options: CompilePdfPaintSceneOptions
): PaintSceneCompileResult => {
  const issues: PaintSceneCapabilityIssue[] = [];
  const fragments = page.items.map((item, index) => {
    const stableId = item.sourceObjectId ?? `page-${page.pageIndex}:item-${index}`;
    const commands: PaintSceneCommand[] = [];
    const blockingFeature = blockingStateFeature(item.paintState);
    if (blockingFeature) {
      addIssue(
        issues, stableId, blockingFeature,
        `PDF ${blockingFeature} semantics are preserved but not represented by the initial shared scene.`
      );
      return { stableId, revisionKey: `${options.sourceRevision}:${index}`, commands };
    }

    if (item.kind !== 'path') {
      addIssue(
        issues, stableId, `pdf-${item.kind}`,
        `PDF ${item.kind} content remains in the PDF scene until the shared scene supports it.`
      );
      return { stableId, revisionKey: `${options.sourceRevision}:${index}`, commands };
    }

    const path = pathCommands(item.path);
    if (item.paint === 'fill' || item.paint === 'fill-stroke') {
      const fill = supportedColor(item.paintState.fillPaint, item.paintState.fillAlpha);
      if (fill) {
        commands.push({
          kind: 'fill-path', path, transform: item.localToPage,
          fillRule: item.fillRule, color: fill
        });
      } else {
        addIssue(
          issues, stableId, `paint-${item.paintState.fillPaint.kind}`,
          'PDF color-space semantics must be converted by a color-managed backend.', 'preserve-only'
        );
      }
    }
    if (item.paint === 'stroke' || item.paint === 'fill-stroke') {
      const stroke = supportedColor(item.paintState.strokePaint, item.paintState.strokeAlpha);
      if (stroke) {
        commands.push({
          kind: 'stroke-path', path, transform: item.localToPage, color: stroke,
          stroke: {
            width: item.paintState.stroke.width,
            cap: item.paintState.stroke.cap,
            join: item.paintState.stroke.join,
            miterLimit: item.paintState.stroke.miterLimit,
            dash: [...item.paintState.stroke.dash],
            dashOffset: item.paintState.stroke.dashPhase
          }
        });
      } else {
        addIssue(
          issues, stableId, `paint-${item.paintState.strokePaint.kind}`,
          'PDF color-space semantics must be converted by a color-managed backend.', 'preserve-only'
        );
      }
    }
    return { stableId, revisionKey: `${options.sourceRevision}:${index}`, commands };
  });

  page.preservedUnsupported.forEach((operation, index) => addIssue(
    issues,
    operation.sourceObjectId ?? `page-${page.pageIndex}:unsupported-${index}`,
    `pdf-operator-${operation.operator}`,
    operation.reason,
    'preserve-only'
  ));

  return createPaintSceneCompileResult({
    schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
    sourceId: page.sourceObjectId,
    sourceRevision: options.sourceRevision,
    fragments
  }, issues);
};
