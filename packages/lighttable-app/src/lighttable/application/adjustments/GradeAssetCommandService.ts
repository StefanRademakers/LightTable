import type { LightTableGradeClipboardCapture } from '../commands/lightTableCommandContract';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import type { DocumentAssetId, ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import { parseCubeLut } from '../../processing/colorLookupCube';
import { pasteGradeSettings } from '../../lightTableGradeClipboard';
import { commitColorLookupAssetTransaction, type ColorLookupAssetTransactionInput,
  type ColorLookupRuntimePort } from './commitColorLookupAssetTransaction';

interface GradeAssetPorts {
  readonly mutations: Pick<DocumentMutationController, 'begin'>;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  getSession(): object | undefined;
  getDocument(): ImageDocument | null;
  getRenderer(): ColorLookupRuntimePort | null;
  finishAdjustment(): void;
  settleInteraction(): Promise<void>;
  getDocumentAdjustments(): BasicAdjustments;
  resolveTarget(document: ImageDocument): {
    identity: string; layerId: LayerId | null; adjustments: BasicAdjustments | null;
  };
  applyCanonicalProjection: ColorLookupAssetTransactionInput['applyCanonicalProjection'];
  pushHistoryEntry: ColorLookupAssetTransactionInput['pushHistoryEntry'];
  /** Synchronous existing adjustment owner; this service has already settled admission. */
  changeGrade(recipe: (current: BasicAdjustments) => BasicAdjustments): boolean;
}

type Purpose = 'photoshop-color-lookup' | 'grade-look';
type Opening = Awaited<ReturnType<GradeAssetCommandService['prepare']>>;

/** Import planning only. The existing asset transaction owns upload, rollback and history. */
export class GradeAssetCommandService {
  constructor(private readonly ports: GradeAssetPorts) {}

  private async prepare() {
    const p = this.ports;
    const scope = p.captureScope();
    const session = p.getSession();
    const initial = p.getDocument();
    const renderer = p.getRenderer();
    if (!initial || !renderer) throw new Error('Open a document before loading a LUT or Grade.');
    const identity = p.resolveTarget(initial).identity;
    p.finishAdjustment();
    await p.settleInteraction();
    scope.assertCurrent();
    const document = p.getDocument();
    if (!document || document.id !== initial.id || p.getSession() !== session
      || p.getRenderer() !== renderer || p.resolveTarget(document).identity !== identity) {
      throw new Error('The Grade target changed during interaction settlement.');
    }
    const target = p.resolveTarget(document);
    if (!target.adjustments) throw new Error('Select a Grade owner before loading a LUT or Grade.');
    const documentAdjustments = p.getDocumentAdjustments();
    const sessionIsCurrent = () => p.getSession() === session && p.getDocument()?.id === document.id;
    return { document, renderer, target, documentAdjustments,
      // Strict import admission is intentionally different from history replay:
      // replay may use a new renderer and inspect a different owner of this session.
      sessionIsCurrent,
      isCurrent: () => scope.isCurrent() && sessionIsCurrent() && p.getDocument() === document
        && p.resolveTarget(document).identity === identity
        && (target.layerId !== null || p.getDocumentAdjustments() === documentAdjustments)
    };
  }

  load = async (file: File, purpose: Purpose): Promise<{ name: string; size: number }> => {
    if (!/\.cube$/i.test(file.name)) throw new Error('Choose a 3D .cube LUT file.');
    if (file.size <= 0 || file.size > 32 * 1024 * 1024) {
      throw new Error('A .cube LUT must be between 1 byte and 32 MiB.');
    }
    const opening = await this.prepare();
    return this.import(opening, file, file.name, {
      type: purpose === 'grade-look' ? 'adjustment.grade-look' : 'adjustment.color-lookup',
      label: purpose === 'grade-look' ? 'Load Grade Look' : 'Load Color Lookup'
    }, assetId => {
      const before = cloneAdjustments(opening.target.adjustments!);
      return purpose === 'grade-look'
        ? { ...before, gradeLook: { ...before.gradeLook, assetId } }
        : { ...before, photoshopAdjustment: { ...before.photoshopAdjustment,
          kind: 'color-lookup', colorLookupPreset: 'none', colorLookupAssetId: assetId } };
    });
  };

  paste = async (capture: LightTableGradeClipboardCapture) => {
    const opening = await this.prepare();
    let settings = cloneAdjustments(capture.settings);
    const copiedId = settings.gradeLook.assetId;
    if (copiedId && !opening.document.assets.colorLookups.some(asset => asset.id === copiedId)) {
      if (capture.gradeLookAsset?.assetId === copiedId) {
        await this.import(opening, capture.gradeLookAsset.source, capture.gradeLookAsset.name,
          { type: 'adjustment.grade.paste', label: `Load ${capture.name}` }, assetId =>
            pasteGradeSettings(opening.target.adjustments!, {
              ...settings, gradeLook: { ...settings.gradeLook, assetId }
            }));
        return { name: capture.name, changed: true, hasLookAsset: true, importedLookAsset: true };
      }
      // A text-only clipboard cannot resolve a foreign binary. Its other Grade
      // settings remain explicitly usable; no placeholder GPU asset is invented.
      settings = { ...settings, gradeLook: { ...settings.gradeLook, assetId: null } };
    }
    if (!opening.isCurrent()) throw new Error('The Grade target changed before paste.');
    const changed = this.ports.changeGrade(current => pasteGradeSettings(current, settings));
    return { name: capture.name, changed, hasLookAsset: Boolean(capture.gradeLookAsset), importedLookAsset: false };
  };

  private async import(opening: Opening, source: Blob, sourceName: string,
    history: ColorLookupAssetTransactionInput['history'],
    project: (assetId: DocumentAssetId) => BasicAdjustments): Promise<{ name: string; size: number }> {
    if (!opening.isCurrent()) throw new Error('The LUT target changed before loading.');
    const p = this.ports;
    const transaction = p.mutations.begin(history.type, history, undefined, 'cancel');
    if (!transaction) throw new Error('Another document operation is still completing.');
    const assetId = `lut-${crypto.randomUUID()}` as DocumentAssetId;
    try {
      const parsed = parseCubeLut(await source.text());
      if (!transaction.active || !opening.isCurrent()) {
        throw new Error('The LUT target changed while the file was loading.');
      }
      const beforeDocument = opening.document;
      const name = parsed.title || sourceName;
      const withAsset: ImageDocument = {
        ...beforeDocument,
        assets: { ...beforeDocument.assets, colorLookups: [...beforeDocument.assets.colorLookups, {
          id: assetId, name, size: parsed.size, domainMin: parsed.domainMin,
          domainMax: parsed.domainMax, byteLength: source.size, revision: 0
        }] },
        revision: beforeDocument.revision + 1, modifiedAt: Date.now()
      };
      if (!transaction.stage(() => withAsset)) throw new Error('The LUT operation lost its document ownership.');
      await commitColorLookupAssetTransaction({ transaction, runtime: opening.renderer,
        source, assetId, beforeDocument,
        beforeDocumentAdjustments: cloneAdjustments(opening.documentAdjustments),
        nextEditorAdjustments: project(assetId), targetLayerId: opening.target.layerId, history,
        bindingIsCurrent: opening.isCurrent,
        documentIsActive: id => opening.sessionIsCurrent() && p.getDocument()?.id === id,
        applyCanonicalProjection: projection => {
          if (!opening.sessionIsCurrent()) throw new Error('LUT history belongs to another document session.');
          p.applyCanonicalProjection(projection);
        },
        pushHistoryEntry: p.pushHistoryEntry
      });
      return { name, size: parsed.size };
    } catch (error) {
      transaction.cancel();
      throw error;
    }
  }
}
