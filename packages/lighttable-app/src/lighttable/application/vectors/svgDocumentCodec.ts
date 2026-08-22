import { cloneVectorElement } from '@lighttable/vector-core';
import {
  exportSvgScene,
  importSvg,
  type SvgConversionReport,
  type SvgSceneNode
} from '@lighttable/vector-svg';
import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { materializeSvgImportPlan } from './materializeSvgImportPlan';
import { SVG_IMPORT_CODEC_LIMITS } from './svgImportLimits';
import { createSvgImportIdFactory } from './svgImportIds';
import { normalizeEditableSvgSource } from './normalizeEditableSvgSource';

export interface SemanticSvgImportCommand {
  readonly svg: string;
  readonly placement: 'document';
  readonly layerName?: string;
  /** Internal placement offset used by File > Place; public import remains document-addressed. */
  readonly x?: number;
  readonly y?: number;
}

export interface SvgImportCommandResult {
  readonly layerId: LayerId;
  readonly elementIds: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly report: SvgConversionReport;
}

export interface SvgImportDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
  /** Unit/host seam; production uses the locked-down reusable normalizer. */
  normalizeSvgSource?(source: string): Promise<string>;
}

export const executeSvgImport = async (
  command: SemanticSvgImportCommand,
  dependencies: SvgImportDependencies
): Promise<SvgImportCommandResult | null> => {
  const normalizedSvg = await (dependencies.normalizeSvgSource ?? normalizeEditableSvgSource)(command.svg);
  // Read authority after the asynchronous preparation. Import must never
  // overwrite edits made while normalization was running.
  const before = dependencies.getDocument();
  if (!before) return null;
  const plan = importSvg(normalizedSvg, {
    createId: createSvgImportIdFactory(),
    limits: SVG_IMPORT_CODEC_LIMITS
  });
  const materialized = materializeSvgImportPlan(
    before,
    plan,
    command.layerName?.trim() || 'Imported SVG',
    { x: command.x, y: command.y }
  );
  dependencies.applyDocument(materialized.document);
  dependencies.recordHistory(before, materialized.document);
  return {
    layerId: materialized.layerId,
    elementIds: materialized.elementIds,
    width: plan.width,
    height: plan.height,
    report: plan.report
  };
};

const exactSvgScene = (document: ImageDocument) => {
  const visible = document.layers.filter(({ visible }) => visible);
  if (!visible.length) throw new Error('SVG export requires at least one visible vector layer.');
  const convert = (layer: LayerNode): SvgSceneNode | null => {
    if (!layer.visible) return null;
    if (layer.fillOpacity !== 1 || layer.blendMode !== 'normal'
      || layer.clipping || layer.mask || layer.styleStack.effects.length) {
      throw new Error(
        `Vector layer “${layer.name}” has semantics that SVG export cannot represent exactly.`
      );
    }
    if (layer.type === 'group') {
      const children = layer.children
        .map(convert)
        .filter((node): node is SvgSceneNode => Boolean(node));
      return children.length ? {
        kind: 'group', name: layer.name, opacity: layer.opacity,
        transform: { ...layer.transform }, children
      } : null;
    }
    if (layer.type !== 'vector') {
      throw new Error(
        'SVG export supports documents whose visible content consists only of native vector layers and groups.'
      );
    }
    return {
      kind: 'group', name: layer.name, opacity: layer.opacity,
      transform: { ...layer.transform },
      children: layer.elements.map(source => ({
        kind: 'element' as const, element: cloneVectorElement(source)
      }))
    };
  };
  return visible.map(convert).filter((node): node is SvgSceneNode => Boolean(node));
};

export const exportSvgDocument = (document: ImageDocument, name: string) => {
  const svg = exportSvgScene(exactSvgScene(document), {
    width: document.width, height: document.height, title: document.name
  });
  return new File([svg], `${name.replace(/\.[^.]+$/u, '') || 'LightTable'}.svg`, {
    type: 'image/svg+xml'
  });
};
