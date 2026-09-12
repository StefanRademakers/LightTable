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
import type { DocumentMutationController } from '../documents/useDocumentMutationController';

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
  captureScope(): { isCurrent(): boolean };
  changeDocument: DocumentMutationController['change'];
  /** Unit/host seam; production uses the locked-down reusable normalizer. */
  normalizeSvgSource?(source: string): Promise<string>;
}

export const executeSvgImport = async (
  command: SemanticSvgImportCommand,
  dependencies: SvgImportDependencies
): Promise<SvgImportCommandResult | null> => {
  const scope = dependencies.captureScope();
  const assertCurrent = () => {
    if (!scope.isCurrent()) throw new Error('The SVG import document scope is no longer current.');
  };
  assertCurrent();
  const normalizedSvg = await (dependencies.normalizeSvgSource ?? normalizeEditableSvgSource)(command.svg);
  assertCurrent();
  let sourcePlan: ReturnType<typeof importSvg> | null = null;
  try {
    sourcePlan = importSvg(command.svg, {
      createId: createSvgImportIdFactory(),
      limits: SVG_IMPORT_CODEC_LIMITS
    });
  } catch {
    // The locked-down normalizer remains authoritative for SVG features that
    // the editable source parser cannot safely or exactly interpret itself.
  }
  const sourceLostRenderableSemantics = sourcePlan?.report.warnings.some(({ code }) => (
    code === 'ignored-unsupported-attribute'
      || code === 'ignored-unsupported-element'
      || code === 'ignored-unsupported-style'
      || code === 'ignored-foreign-element'
  ));
  const plan = sourcePlan && !sourceLostRenderableSemantics ? sourcePlan : importSvg(normalizedSvg, {
    createId: createSvgImportIdFactory(),
    limits: SVG_IMPORT_CODEC_LIMITS
  });
  let result: SvgImportCommandResult | null = null;
  const accepted = dependencies.changeDocument((current) => {
    assertCurrent();
    const materialized = materializeSvgImportPlan(
      current, plan, command.layerName?.trim() || 'Imported SVG',
      { x: command.x, y: command.y }
    );
    result = {
      layerId: materialized.layerId, elementIds: materialized.elementIds,
      width: plan.width, height: plan.height, report: plan.report
    };
    return materialized.document;
  }, true, { label: 'Import SVG', type: 'vector.importSvg' });
  return accepted ? result : null;
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
      if (layer.vectorClip?.enabled && layer.vectorClip.inverted) {
        throw new Error(`Vector clip “${layer.vectorClip.name}” is inverted and cannot be exported exactly to SVG.`);
      }
      const children = layer.children
        .map(convert)
        .filter((node): node is SvgSceneNode => Boolean(node));
      return children.length ? {
        kind: 'group', name: layer.name, opacity: layer.opacity,
        transform: { ...layer.transform },
        ...(layer.vectorClip?.enabled ? {
          clipPath: {
            id: layer.vectorClip.id,
            name: layer.vectorClip.name,
            elements: layer.vectorClip.elements.map(cloneVectorElement)
          }
        } : {}),
        children
      } : null;
    }
    if (layer.type !== 'vector') {
      throw new Error(
        'SVG export supports documents whose visible content consists only of native vector layers and groups.'
      );
    }
    if (layer.vectorClip?.enabled && layer.vectorClip.inverted) {
      throw new Error(`Vector clip “${layer.vectorClip.name}” is inverted and cannot be exported exactly to SVG.`);
    }
    return {
      kind: 'group', name: layer.name, opacity: layer.opacity,
      transform: { ...layer.transform },
      ...(layer.vectorClip?.enabled ? {
        clipPath: {
          id: layer.vectorClip.id,
          name: layer.vectorClip.name,
          elements: layer.vectorClip.elements.map(cloneVectorElement)
        }
      } : {}),
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
