import type { DocumentSession } from '../../application/documents/documentSession';
import type { SemanticTextCommand } from '../../application/commands/semanticTextCommandContract';
import { executeSemanticTextCommand, type SemanticTextCommandDependencies } from '../../application/text/semanticTextCommandExecutor';

interface TextCommandHost<Renderer extends object> {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): Renderer | null;
  captureScope(): { assertCurrent(): void; isCurrent(): boolean };
  waitForExactRender(renderer: Renderer): Promise<boolean>;
  reportPendingRender(): void;
  reportRenderFailure(reason: unknown): void;
}

/** Registered adapters may change on ordinary rerender; concrete session/runtime ownership may not. */
export const createMountedTextCommandBinding = <Renderer extends object>(
  session: DocumentSession | undefined, renderer: Renderer | null,
  host: TextCommandHost<Renderer>, dependencies: Omit<SemanticTextCommandDependencies, 'getDocument' | 'assertCurrent'>
) => async (command: SemanticTextCommand, assertRequestCurrent: () => void) => {
  const scope = host.captureScope();
  const ownsContext = () => Boolean(session && renderer && host.getSession() === session && host.getRenderer() === renderer
    && session.getSnapshot().lifecycle === 'ready' && scope.isCurrent());
  const assertCurrent = () => {
    assertRequestCurrent(); scope.assertCurrent();
    if (!ownsContext()) throw new Error('The text command document renderer was retired.');
  };
  assertCurrent();
  const result = await executeSemanticTextCommand(command, { ...dependencies, assertCurrent,
    getDocument: () => session!.getSnapshot().document });
  if (!result) return null;
  // Publication is authoritative. Retired presentation must not veto or relabel the committed command.
  if (renderer && ownsContext()) {
    try {
      if (!await host.waitForExactRender(renderer) && ownsContext()) host.reportPendingRender();
    } catch (reason) { if (ownsContext()) host.reportRenderFailure(reason); }
  }
  return result;
};
