import type { DocumentFontAsset, ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { textLayerFontResolutions } from '../../text/fonts/textLayerFontStatus';
import { textLayerSourceKey } from '../../text/rendering/TextLayerRenderer';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import type { MissingFontRecoveryRequest } from './textRecoveryRequest';

type Affinity = 'upstream' | 'downstream';
export interface TextEditingEntryPorts {
  getDocument(): ImageDocument | null;
  getTool(): string;
  getFontRegistry(): object;
  getFonts(): readonly DocumentFontAsset[];
  substitutionFamilies: readonly string[];
  captureScope(): ReturnType<typeof captureInteractionScope>;
  selectLayer(layerId: LayerId): Promise<unknown>;
  activateType(after: () => void): Promise<unknown>;
  cancelCreation(): void;
  beginEditing(layerId: LayerId, offset?: number, affinity?: Affinity): boolean;
  requestRecovery(request: MissingFontRecoveryRequest): void;
  showProperties(layerId: LayerId): void;
  closeReport(): void;
  reportFailure(error: unknown): void;
}

/** User entry/recovery policy only. Font replacement, editing and history retain their own owners. */
export class TextEditingEntry {
  private revision = 0;
  private pending: { tool: string; allowTypeActivation: boolean } | null = null;
  constructor(private readonly getPorts: () => TextEditingEntryPorts) {}
  cancel = () => { ++this.revision; this.pending = null; };
  observeTool = (tool: string) => {
    const pending = this.pending;
    if (!pending || pending.tool === tool) return;
    if (pending.allowTypeActivation && tool === 'text-point') {
      pending.tool = tool; pending.allowTypeActivation = false;
    } else this.cancel();
  };
  request = (layerId: LayerId, offset?: number, affinity: Affinity = 'downstream') => {
    this.cancel();
    return this.enter(layerId, offset, affinity);
  };
  private enter(layerId: LayerId, offset?: number, affinity: Affinity = 'downstream') {
    const p = this.getPorts(); const document = p.getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return false;
    // Derive from current authored runs/assets, not a React diagnostics snapshot.
    const resolutions = textLayerFontResolutions(layer, p.getFonts(), p.substitutionFamilies);
    const unresolved = resolutions.find(entry => entry.resolution.kind === 'missing')
      ?? resolutions.find(entry => entry.resolution.kind !== 'exact');
    if (unresolved) {
      const request = unresolved.request.replacement?.original ?? unresolved.request;
      p.requestRecovery({ layerId, sourceIdentity: unresolved.sourceIdentity,
        requestedFont: request.postScriptName ?? request.families.find(Boolean) ?? null,
        layerName: layer.name, offset, affinity,
        metricsChanged: resolutions.some(entry => entry.sourceIdentity === unresolved.sourceIdentity && entry.metricsChanged) });
      return false;
    }
    return p.beginEditing(layerId, offset, affinity);
  }
  selectAndEnter = async (layerId: LayerId, options: {
    offset?: number; affinity?: Affinity; closeReport?: boolean;
  } = {}) => {
    const revision = ++this.revision; const p = this.getPorts();
    const document = p.getDocument(); const layer = document ? findDocumentLayer(document, layerId) : null;
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
    const scope = p.captureScope(); const registry = p.getFontRegistry();
    const sourceKey = textLayerSourceKey(layer); const tool = p.getTool();
    const pending = { tool, allowTypeActivation: false }; this.pending = pending;
    const current = () => {
      const latest = this.getPorts(); const doc = latest.getDocument();
      const node = doc ? findDocumentLayer(doc, layerId) : null;
      return revision === this.revision && scope.isCurrent() && doc?.id === document?.id
        && latest.getFontRegistry() === registry && node?.type === 'text'
        && node.text.source.kind === 'flow' && textLayerSourceKey(node) === sourceKey;
    };
    let activating = false;
    try {
      await p.selectLayer(layerId);
      if (!current() || this.getPorts().getTool() !== tool
        || this.getPorts().getDocument()?.activeLayerId !== layerId) return;
      p.cancelCreation();
      activating = true;
      pending.allowTypeActivation = true;
      await p.activateType(() => {
        if (!current() || this.getPorts().getTool() !== 'text-point'
          || this.getPorts().getDocument()?.activeLayerId !== layerId) return;
        if (options.closeReport) p.closeReport();
        this.enter(layerId, options.offset, options.affinity);
        p.showProperties(layerId);
      });
    } catch (error) {
      const failureTool = this.getPorts().getTool();
      if (current() && (failureTool === tool || (activating && failureTool === 'text-point'))) p.reportFailure(error);
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  };
}
