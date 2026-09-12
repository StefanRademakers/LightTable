import type { DocumentSession } from '../documents/documentSession';
import type { ImageDocument, DocumentAssetId } from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import { cloneAdjustments } from '../../types';
import type { LightTableCommandService } from '../commands/lightTableCommandService';
import type { LightTableCommandResult, LightTableGradeClipboardCapture,
  PreparedGradeClipboardCopy } from '../commands/lightTableCommandContract';
import type { GradeAssetCommandService } from './GradeAssetCommandService';
import { associateLightTableGradeArtifact, copyLightTableGrade, readLightTableGrade } from '../../lightTableGradeClipboard';

interface GradeClipboardRenderer {
  getColorLookupAssetSource(documentId: ImageDocument['id'], assetId: DocumentAssetId): Blob | null;
}
interface Ports {
  readonly session: DocumentSession | undefined;
  readonly renderer: GradeClipboardRenderer | null;
  getSession(): DocumentSession | undefined;
  getRenderer(): GradeClipboardRenderer | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  getContextualSettings(document: ImageDocument): BasicAdjustments | null;
  getTargetIdentity(document: ImageDocument): string | null;
  readonly assets: Pick<GradeAssetCommandService, 'paste'>;
  readonly commands: Pick<LightTableCommandService, 'resolveGradeClipboardArtifact' | 'releaseArtifact'>;
  execute(command: 'grade.copy' | 'grade.paste', parameters: unknown,
    reportError: null): Promise<LightTableCommandResult>;
  setStatus(message: string): void;
  reportError(message: string): void;
}

/** Shared clipboard intent/source mapping, not another clipboard or Grade mutation owner. */
export const createGradeClipboardBinding = (ports: Ports) => {
  const { session, renderer } = ports;
  const scope = ports.captureScope();
  const ownsContext = () => scope.isCurrent() && ports.getSession() === session
    && ports.getRenderer() === renderer;
  const read = () => {
    const state = session?.getSnapshot();
    if (!ownsContext() || !renderer || !state?.document || state.lifecycle !== 'ready'
      || ports.getProjectedDocument()?.id !== state.document.id) {
      throw new Error('The Grade clipboard belongs to an unavailable document renderer.');
    }
    return { ...state, document: state.document };
  };
  const prepareCopy = (): PreparedGradeClipboardCopy => {
    const state = read();
    const target = ports.getTargetIdentity(state.document);
    const settings = cloneAdjustments(ports.getContextualSettings(state.document) ?? state.processing.adjustments);
    const assetId = settings.gradeLook.assetId;
    const metadata = assetId ? state.document.assets.colorLookups.find(asset => asset.id === assetId) : null;
    const source = assetId ? renderer!.getColorLookupAssetSource(state.document.id, assetId as DocumentAssetId) : null;
    const capture: LightTableGradeClipboardCapture = {
      name: state.document.name, settings,
      ...(source && metadata ? { gradeLookAsset: { assetId: metadata.id, name: metadata.name, source } } : {})
    };
    const assertCurrent = () => {
      const current = read();
      if (current.documentRevision !== state.documentRevision
        || ports.getTargetIdentity(current.document) !== target) {
        throw new Error('The Grade source changed before it could be copied.');
      }
    };
    return { capture, assertCurrent, publish: association => {
      assertCurrent();
      copyLightTableGrade(capture.settings, capture.name, capture.gradeLookAsset, association);
      if (ownsContext()) ports.setStatus('Grade copied');
    } };
  };
  const paste = async (capture: LightTableGradeClipboardCapture) => {
    read();
    const result = await ports.assets.paste(capture);
    // A successful mutation remains successful after retirement; only feedback expires.
    if (ownsContext()) ports.setStatus(`Loaded ${capture.name}`);
    return result;
  };
  const runUi = async (action: () => Promise<LightTableCommandResult> | null) => {
    try {
      read();
      const result = await action();
      if (result?.status === 'rejected' && ownsContext()) ports.reportError(result.message);
    } catch (reason) {
      if (ownsContext()) ports.reportError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return {
    prepareCopy, paste,
    copyCurrentGrade: () => runUi(() => ports.execute('grade.copy', {}, null)),
    pasteCurrentGrade: () => runUi(() => {
      const clipboard = readLightTableGrade();
      if (!clipboard) return null;
      const resolved = ports.commands.resolveGradeClipboardArtifact(clipboard, clipboard.artifactAssociation);
      let associated = false;
      try {
        read();
        associated = associateLightTableGradeArtifact(clipboard, resolved.association);
        if (!associated) throw new Error('The Grade clipboard changed before it could be pasted.');
      } finally {
        if (!associated && resolved.created) ports.commands.releaseArtifact(resolved.artifact.id);
      }
      return ports.execute('grade.paste', { artifactId: resolved.artifact.id }, null);
    })
  };
};
