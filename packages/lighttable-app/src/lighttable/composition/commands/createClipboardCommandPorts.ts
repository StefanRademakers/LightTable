import type { LayerId } from '../../editor/document/documentTypes';
import type { DocumentLightTableCommandPorts } from '../../application/commands/lightTableCommandContract';

type ClipboardCommandPorts = Pick<DocumentLightTableCommandPorts,
  'copyPixels' | 'cutPixels' | 'pastePixels' | 'copyGrade' | 'pasteGrade' | 'placeArtifact'>;
type PasteCommand = Parameters<NonNullable<ClipboardCommandPorts['pastePixels']>>[1];
type MountedPasteCommand = Omit<PasteCommand, 'target'> & {
  readonly target?: Omit<NonNullable<PasteCommand['target']>, 'layerId'> & {
    readonly layerId?: LayerId;
  };
};

/** Adapts clipboard transports to mounted document owners without retaining UI state. */
export const createClipboardCommandPorts = ({
  settle,
  copyActive,
  copyMerged,
  cut,
  paste,
  copyGrade,
  pasteGrade,
  placeArtifact
}: {
  readonly settle: () => Promise<void>;
  readonly copyActive: () => ReturnType<NonNullable<ClipboardCommandPorts['copyPixels']>>;
  readonly copyMerged: () => ReturnType<NonNullable<ClipboardCommandPorts['copyPixels']>>;
  readonly cut: NonNullable<ClipboardCommandPorts['cutPixels']>;
  readonly paste: (file: File, command: MountedPasteCommand,
    fastPasteToken?: string) => unknown | Promise<unknown>;
  readonly copyGrade: NonNullable<ClipboardCommandPorts['copyGrade']>;
  readonly pasteGrade: NonNullable<ClipboardCommandPorts['pasteGrade']>;
  readonly placeArtifact: NonNullable<ClipboardCommandPorts['placeArtifact']>;
}): ClipboardCommandPorts => ({
  copyPixels: async source => {
    await settle();
    return source === 'active-layer' ? await copyActive() : await copyMerged();
  },
  cutPixels: cut,
  pastePixels: (file, command, fastPasteToken) => paste(file, {
    ...command,
    target: command.target ? {
      ...command.target,
      layerId: command.target.layerId as LayerId | undefined
    } : undefined
  }, fastPasteToken),
  copyGrade,
  pasteGrade,
  placeArtifact
});
