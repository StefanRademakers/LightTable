import type { DocumentSession } from '../documents/documentSession';
import type { DocumentFileIntents } from '../documents/DocumentFileIntents';
import type { FileTextCreationPrerequisite } from './DocumentCommandExecutionQueue';
import type { LightTableCommandId } from './lightTableCommandService';

const FILE_COMMANDS = new Set<LightTableCommandId>([
  'file.exportNative',
  'file.exportPng',
  'file.exportBitmap',
  'file.exportPsd',
  'file.exportSvg'
]);

export interface MountedCommandSettlementParticipants {
  readonly session: DocumentSession | null | undefined;
  readonly files: Pick<DocumentFileIntents, 'prepareForCommand'>;
  settleInteraction(): Promise<void>;
}

/** Owns the single admission policy from mounted command execution into document mutation. */
export class MountedCommandSettlement {
  constructor(private readonly participants: MountedCommandSettlementParticipants) {}

  readonly settle = async (
    command: LightTableCommandId,
    textPrerequisite?: FileTextCreationPrerequisite
  ): Promise<void> => {
    if (command === 'view.setZoom') return;
    if (FILE_COMMANDS.has(command)) {
      if (!textPrerequisite) {
        throw new Error('The file command runner did not supply its text prerequisite ownership.');
      }
      await this.participants.files.prepareForCommand(this.participants.session, textPrerequisite);
      return;
    }
    await this.participants.settleInteraction();
  };
}
