import type { TextToolSettings } from '../../editor/session/editorSession';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import { executeAtomicCommandBatch } from './atomicCommandBatchExecutor';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';

type AutomationCommandPorts = Pick<DocumentLightTableCommandPorts,
  'executeBackgroundRemoval' | 'executeAutoAlign' | 'executeAtomicBatch'>;

/** Owns task-style automation command adapters and exact-render completion policy. */
export const createAutomationCommandPorts = ({
  executeBackgroundRemoval,
  executeAutoAlign,
  fontRegistry,
  documentMutations,
  getTextSettings,
  getForegroundColor,
  waitForExactRender,
  reportPendingRender
}: {
  readonly executeBackgroundRemoval: NonNullable<AutomationCommandPorts['executeBackgroundRemoval']>;
  readonly executeAutoAlign: NonNullable<AutomationCommandPorts['executeAutoAlign']>;
  readonly fontRegistry: DocumentFontRegistry;
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
  readonly getTextSettings: () => TextToolSettings;
  readonly getForegroundColor: () => string;
  readonly waitForExactRender: (signal: AbortSignal) => Promise<boolean>;
  readonly reportPendingRender: () => void;
}): AutomationCommandPorts => ({
  executeBackgroundRemoval,
  executeAutoAlign,
  executeAtomicBatch: async (batch, signal, report) => {
    const result = await executeAtomicCommandBatch(batch, {
      fontRegistry,
      documentMutations,
      getTextSettings,
      getForegroundColor
    }, signal, report);
    if (!await waitForExactRender(signal)) reportPendingRender();
    return result;
  }
});
