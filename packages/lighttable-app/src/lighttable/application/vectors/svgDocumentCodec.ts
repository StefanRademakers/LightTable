import { cloneVectorElement, multiplyMatrices, translationMatrix } from '@lighttable/vector-core';
import { exportSvg, importSvg, type SvgConversionReport } from '@lighttable/vector-svg';
import { createVectorLayer } from '../../editor/document/documentCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
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
  const offset = translationMatrix(command.x ?? 0, command.y ?? 0);
  const elements = plan.elements.map((source) => {
    const element = cloneVectorElement(source);
    element.transform = multiplyMatrices(offset, element.transform);
    return element;
  });
  const after = createVectorLayer(before, elements, command.layerName?.trim() || 'Imported SVG');
  const layerId = after.activeLayerId;
  if (!layerId) return null;
  dependencies.applyDocument(after);
  dependencies.recordHistory(before, after);
  return { layerId, elementIds: elements.map(({ id }) => id), width: plan.width,
    height: plan.height, report: plan.report };
};

const exactSvgElements = (document: ImageDocument) => {
  const visible = document.layers.filter(({ visible }) => visible);
  if (!visible.length) throw new Error('SVG export requires at least one visible vector layer.');
  if (visible.some((layer) => layer.type !== 'vector')) {
    throw new Error('SVG export supports documents whose visible content consists only of native vector layers.');
  }
  return visible.flatMap((layer) => {
    if (layer.type !== 'vector') return [];
    if (layer.opacity !== 1 || layer.fillOpacity !== 1 || layer.blendMode !== 'normal'
      || layer.clipping || layer.mask || layer.styleStack.effects.length) {
      throw new Error(`Vector layer “${layer.name}” has layer semantics that Pass 1 SVG export cannot represent exactly.`);
    }
    return layer.elements.map((source) => {
      const element = cloneVectorElement(source);
      element.transform = multiplyMatrices(layer.transform, element.transform);
      return element;
    });
  });
};

export const exportSvgDocument = (document: ImageDocument, name: string) => {
  const svg = exportSvg(exactSvgElements(document), {
    width: document.width, height: document.height, title: document.name
  });
  return new File([svg], `${name.replace(/\.[^.]+$/u, '') || 'LightTable'}.svg`, {
    type: 'image/svg+xml'
  });
};
