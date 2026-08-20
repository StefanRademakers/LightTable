import { parseSemanticWarpStrokeCommand, type SemanticWarpStrokeCommand
} from './semanticWarpCommandContract';

type WarpDispatchFailure = {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};
type WarpDispatchResult = { readonly ok: true; readonly value: unknown } | WarpDispatchFailure;

/** Command-family validation/execution kept behind the central service publication contract. */
export const dispatchSemanticWarpStroke = async (
  parameters: unknown,
  execute: ((command: SemanticWarpStrokeCommand) => unknown | Promise<unknown>) | undefined
): Promise<WarpDispatchResult> => {
  const command = parseSemanticWarpStrokeCommand(parameters);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (!execute) return { ok: false, code: 'command-unavailable',
    message: 'Warp stroke commands are unavailable in this host.' };
  try {
    const value = await execute(command);
    return value
      ? { ok: true, value }
      : { ok: false, code: 'execution-failed', message: 'The Warp stroke did not change the document.' };
  } catch (reason) {
    return { ok: false, code: 'execution-failed',
      message: reason instanceof Error ? reason.message : String(reason) };
  }
};
