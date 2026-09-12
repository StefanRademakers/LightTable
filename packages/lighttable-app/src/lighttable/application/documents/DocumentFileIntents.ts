import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandService } from '../commands/lightTableCommandService';
import { commandDocumentTarget } from '../commands/commandRequestScope';
import type { DocumentSession } from './documentSession';
import { prepareDocumentFileIntent, type DocumentFilePreparationParticipants } from './prepareDocumentFileIntent';
import { resolveAcceptedCommandArtifact } from '../commands/resolveAcceptedCommandArtifact';
import type { CapturedTextCreationPrerequisite } from '../text/TextCreationInteraction';
import type { FileTextCreationPrerequisite } from '../commands/DocumentCommandExecutionQueue';

export interface DocumentFileIntentPorts extends Omit<DocumentFilePreparationParticipants, 'assertCurrent'> {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): object | null;
  captureScope(): { isCurrent(): boolean };
  commands: Pick<LightTableCommandService, 'execute' | 'queryTask' | 'resolveArtifact'>;
  nextRequestId(documentId: string): string;
  captureTextCreation(): CapturedTextCreationPrerequisite;
  save(): Promise<void>;
  exportJpeg(): Promise<void>;
  exportWebp(): Promise<void>;
  exportTiff(): Promise<void>;
  exportPsd(): Promise<void>;
  exportPsdMaximumAppearance(): Promise<void>;
  exportSvg(): Promise<void>;
  deliverExportFile(file: File): Promise<void>;
  reportError(message: string): void;
}

export interface PreparedDocumentFileScope {
  readonly session: DocumentSession;
  readonly renderer: object;
  isCurrent(): boolean;
  assertCurrent(): void;
}

/** UI file requests finish named owners before entering any semantic command queue. */
export class DocumentFileIntents {
  constructor(private readonly resolve: () => DocumentFileIntentPorts) {}

  private capture() {
    const ports = this.resolve();
    const session = ports.getSession();
    const renderer = ports.getRenderer();
    const presentation = ports.captureScope();
    const isCurrent = () => Boolean(session && renderer && ports.getSession() === session
      && ports.getRenderer() === renderer && session.getSnapshot().lifecycle === 'ready'
      && presentation.isCurrent());
    const assertCurrent = () => {
      if (!isCurrent()) throw new DOMException('The file target document renderer was retired.', 'AbortError');
    };
    return { ports, session, renderer, isCurrent, assertCurrent };
  }

  private async prepare(captured: ReturnType<DocumentFileIntents['capture']>): Promise<PreparedDocumentFileScope> {
    const { ports, session, renderer, isCurrent, assertCurrent } = captured;
    assertCurrent();
    await prepareDocumentFileIntent({ ...ports, assertCurrent });
    assertCurrent();
    return { session: session!, renderer: renderer!, isCurrent, assertCurrent };
  }

  /** Strict prerequisite for an outside-command export/preflight owner; errors belong to its UI boundary. */
  prepareForUi = (): Promise<PreparedDocumentFileScope> => this.prepare(this.capture());

  /** The active file runner may consume only the exact creation captured before other terminals. */
  prepareForCommand = async (expectedSession: DocumentSession | null | undefined,
    prerequisite: FileTextCreationPrerequisite): Promise<void> => {
    const { ports, session, assertCurrent } = this.capture();
    if (!session || session !== expectedSession) throw new Error('The file command document session was retired.');
    assertCurrent();
    const creation = ports.captureTextCreation();
    await prepareDocumentFileIntent({ ...ports, assertCurrent,
      finishTextCreation: async () => {
        creation.assertCurrent();
        const command = await creation.prepare();
        assertCurrent(); creation.assertCurrent();
        if (command) {
          const result = await prerequisite.consume(command);
          if (result.status !== 'completed') throw new Error(result.status === 'rejected' ? result.message : 'Text creation did not complete.');
        }
        assertCurrent(); creation.assertCurrent();
      } });
  };

  private async run(operation: (ports: DocumentFileIntentPorts, session: DocumentSession,
    assertCurrent: () => void) => Promise<void>): Promise<void> {
    const captured = this.capture();
    const { ports, session, isCurrent, assertCurrent } = captured;
    try {
      await this.prepare(captured);
      await operation(ports, session!, assertCurrent);
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) {
        ports.reportError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  save = () => this.run(ports => ports.save());
  exportJpeg = () => this.run(ports => ports.exportJpeg());
  exportWebp = () => this.run(ports => ports.exportWebp());
  exportTiff = () => this.run(ports => ports.exportTiff());
  exportPsd = () => this.run(ports => ports.exportPsd());
  exportPsdMaximumAppearance = () => this.run(ports => ports.exportPsdMaximumAppearance());
  exportSvg = () => this.run(ports => ports.exportSvg());
  exportPng = () => this.run(async (ports, session, assertCurrent) => {
    const command = 'file.exportPng';
    const result = await ports.commands.execute({ protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId: ports.nextRequestId(session.id), command,
      ...commandDocumentTarget(command, session.id), parameters: {} });
    assertCurrent();
    const { file } = await resolveAcceptedCommandArtifact(ports.commands, session.id, result,
      { timeoutMs: 30_000, assertCurrent });
    assertCurrent();
    await ports.deliverExportFile(file);
  });
}
