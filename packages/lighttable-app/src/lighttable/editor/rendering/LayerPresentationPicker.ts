import {
  layerDerivedPreviewIsCurrent,
  type ImageDocument,
  type LayerId,
  type LayerNode
} from '../document/documentTypes';
import { findDocumentLayer, siblingLayers } from '../document/layerTree';
import { buildSceneTransformIndex } from '../document/sceneTransformGraph';
import type { SceneTransformIndex } from '../document/sceneTransformGraph';
import type { SelectionPoint } from '../selection/selectionTypes';
import {
  identityAffineMatrix,
  invertMatrix,
  multiplyMatrices,
  transformPoint
} from '../geometry/affine';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { LayerStyleRenderer } from './LayerStyleRenderer';
import type { TextLayerRenderer } from '../../text/rendering/TextLayerRenderer';
import type { TextLayerRenderCoordinator } from '../../text/rendering/TextLayerRenderCoordinator';

interface LayerPresentationPickerOptions {
  readonly device: GPUDevice;
  readonly layers: LayerRuntimeStore;
  readonly styles: LayerStyleRenderer;
  readonly texts: TextLayerRenderer;
  readonly textCoordinator: TextLayerRenderCoordinator;
}

/**
 * Point-only picking over retained presentation sources.
 *
 * No layer is re-rendered. Native vector hits arrive as `knownOpaqueLayerIds`;
 * retained raster, tight-text, imported-preview and styled sources contribute
 * direct one-texel copies. One submit/readback resolves the mixed visual order.
 */
export class LayerPresentationPicker {
  constructor(private readonly options: LayerPresentationPickerOptions) {}

  async pickTopLayerAtPoint(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    point: SelectionPoint,
    knownOpaqueLayerIds: ReadonlySet<LayerId> = new Set(),
    sceneTransforms?: SceneTransformIndex
  ): Promise<LayerId | null> {
    const transforms = sceneTransforms ?? buildSceneTransformIndex(document);
    const stride = 256;
    type CandidateSample = {
      readonly layerId: LayerId;
      sourceOffset: number | null;
      readonly maskOffsets: number[];
      maskRejected: boolean;
      cpuOpaque: boolean;
    };
    const samples: CandidateSample[] = [];
    const copies: Array<{
      texture: GPUTexture;
      x: number;
      y: number;
      alphaByteOffset: number;
      role: 'source' | 'mask';
      candidate: CandidateSample;
    }> = [];

    for (const layerId of layerIds) {
      const layer = findDocumentLayer(document, layerId);
      const resolved = transforms.get(layerId);
      if (!layer || !resolved || layer.type === 'group' || layer.type === 'adjustment') continue;
      const candidate: CandidateSample = {
        layerId,
        sourceOffset: null,
        maskOffsets: [],
        maskRejected: false,
        cpuOpaque: knownOpaqueLayerIds.has(layerId)
      };
      samples.push(candidate);

      let texture: GPUTexture | null = null;
      let dimensions: { width: number; height: number } | null = null;
      let sourceToDocument = resolved.localToDocument;
      const styled = this.options.styles.cachedPresentation(layer.id);
      if (styled) {
        texture = styled.texture;
        dimensions = { width: styled.bounds.width, height: styled.bounds.height };
        sourceToDocument = {
          a: 1, b: 0, c: 0, d: 1,
          tx: styled.bounds.x, ty: styled.bounds.y
        };
      } else if (layerDerivedPreviewIsCurrent(layer)) {
        const preview = this.options.layers.derivedPreview(layer.id);
        if (preview && layer.derivedPreview) {
          texture = preview.texture;
          dimensions = preview;
          const parentToDocument = resolved.parentId
            ? transforms.get(resolved.parentId)?.localToDocument ?? identityAffineMatrix()
            : identityAffineMatrix();
          sourceToDocument = multiplyMatrices(parentToDocument, layer.derivedPreview.transform);
        }
      } else if (layer.type === 'raster') {
        const raster = this.options.layers.raster(layer.id);
        if (raster) {
          texture = raster.texture;
          dimensions = raster;
        }
      } else if (layer.type === 'text') {
        const parentToDocument = resolved.parentId
          ? transforms.get(resolved.parentId)?.localToDocument ?? identityAffineMatrix()
          : identityAffineMatrix();
        const source = this.options.texts.resolvePresentation(layer, parentToDocument);
        if (source) {
          texture = source.texture;
          dimensions = source.dimensions;
          sourceToDocument = source.transform;
        }
      }

      const inverse = texture && dimensions ? invertMatrix(sourceToDocument) : null;
      const local = inverse ? transformPoint(inverse, point) : null;
      let sourceSampleScheduled = false;
      if (texture && dimensions && local) {
        const sourceX = Math.floor(local.x);
        const sourceY = Math.floor(local.y);
        if (sourceX >= 0 && sourceY >= 0
          && sourceX < dimensions.width && sourceY < dimensions.height) {
          copies.push({
            texture, x: sourceX, y: sourceY,
            alphaByteOffset: 6, role: 'source', candidate
          });
          sourceSampleScheduled = true;
        }
      }
      if (!texture && layer.type === 'text') {
        const editing = this.options.textCoordinator.editingLayout(layer.id);
        const documentToText = editing ? invertMatrix(editing.localToDocument) : null;
        const textPoint = documentToText ? transformPoint(documentToText, point) : null;
        const ink = editing?.layout.inkBounds;
        candidate.cpuOpaque = Boolean(textPoint && ink
          && textPoint.x >= ink.x && textPoint.y >= ink.y
          && textPoint.x <= ink.x + ink.width && textPoint.y <= ink.y + ink.height);
      }

      // A rejected source cannot become a hit through a mask. Avoid mask
      // transforms and GPU copies entirely for that candidate; masks only
      // reduce coverage and never create pixels outside source coverage.
      if (!sourceSampleScheduled && !candidate.cpuOpaque) continue;

      const maskedNodes: LayerNode[] = [layer];
      let parentId = resolved.parentId;
      while (parentId) {
        const parent = findDocumentLayer(document, parentId);
        if (!parent) break;
        maskedNodes.push(parent);
        parentId = transforms.get(parentId)?.parentId ?? null;
      }
      for (const maskedNode of maskedNodes) {
        if (!maskedNode.mask?.enabled
          || maskedNode.mask.density < 1
          || maskedNode.mask.feather > 0) continue;
        const mask = this.options.layers.maskTexture(maskedNode.id);
        if (!mask) continue;
        const documentToMask = invertMatrix(maskedNode.mask.transform);
        const maskPoint = documentToMask ? transformPoint(documentToMask, point) : null;
        const maskX = maskPoint ? Math.floor(maskPoint.x) : -1;
        const maskY = maskPoint ? Math.floor(maskPoint.y) : -1;
        if (maskPoint && maskX >= 0 && maskY >= 0
          && maskX < document.width && maskY < document.height) {
          copies.push({
            texture: mask, x: maskX, y: maskY,
            alphaByteOffset: 0, role: 'mask', candidate
          });
        } else {
          // A transformed mask is transparent outside its own document-sized
          // surface. Record that explicitly: an empty `maskOffsets` array would
          // otherwise pass `every()` and make the layer selectable there.
          candidate.maskRejected = true;
        }
      }
    }

    const resolveTopHit = (intrinsicHits: ReadonlyMap<LayerId, boolean>) => {
      for (const layerId of layerIds) {
        if (!intrinsicHits.get(layerId)) continue;
        const layer = findDocumentLayer(document, layerId);
        if (!layer?.clipping) return layerId;
        const siblings = siblingLayers(document, layerId);
        const index = siblings.findIndex(({ id }) => id === layerId);
        let baseIndex = index - 1;
        while (baseIndex >= 0 && siblings[baseIndex]?.clipping) baseIndex -= 1;
        const baseId = siblings[baseIndex]?.id;
        if (baseId && intrinsicHits.get(baseId)) return layerId;
      }
      return null;
    };
    if (!copies.length) {
      return resolveTopHit(new Map(samples.map(
        ({ layerId, cpuOpaque, maskRejected }) => [layerId, cpuOpaque && !maskRejected]
      )));
    }

    const readback = this.options.device.createBuffer({
      label: 'LightTable Move tool layer alpha samples',
      size: stride * copies.length,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.options.device.pushErrorScope('validation');
    let validationScopeOpen = true;
    try {
      const encoder = this.options.device.createCommandEncoder({
        label: 'LightTable Move tool layer picking'
      });
      copies.forEach((copy, index) => {
        if (copy.role === 'source') copy.candidate.sourceOffset = index;
        else copy.candidate.maskOffsets.push(index);
        encoder.copyTextureToBuffer(
          { texture: copy.texture, origin: { x: copy.x, y: copy.y } },
          { buffer: readback, offset: index * stride, bytesPerRow: stride, rowsPerImage: 1 },
          { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
      });
      this.options.device.queue.submit([encoder.finish()]);
      const validationError = await this.options.device.popErrorScope();
      validationScopeOpen = false;
      if (validationError) {
        throw new Error(`Move tool layer picking failed: ${validationError.message}`);
      }
      await readback.mapAsync(GPUMapMode.READ);
      const readView = new DataView(readback.getMappedRange());
      const intrinsicHits = new Map<LayerId, boolean>();
      for (const candidate of samples) {
        const masksPainted = !candidate.maskRejected && candidate.maskOffsets.every(
          (copyIndex) => readView.getUint8(copyIndex * stride) !== 0
        );
        const sourcePainted = candidate.cpuOpaque || (
          candidate.sourceOffset !== null
          && (readView.getUint16(
            candidate.sourceOffset * stride
              + copies[candidate.sourceOffset]!.alphaByteOffset,
            true
          ) & 0x7fff) !== 0
        );
        intrinsicHits.set(candidate.layerId, sourcePainted && masksPainted);
      }
      return resolveTopHit(intrinsicHits);
    } finally {
      if (validationScopeOpen) {
        await this.options.device.popErrorScope().catch(() => null);
      }
      if (readback.mapState === 'mapped') readback.unmap();
      readback.destroy();
    }
  }
}
