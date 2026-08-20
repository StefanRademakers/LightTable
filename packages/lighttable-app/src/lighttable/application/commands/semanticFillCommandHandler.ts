import { parseSemanticFillCommand, type SemanticFillCommand } from './semanticFillCommandContract';

type FillDispatchResult = { readonly ok: true; readonly value: unknown } | {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};

export const dispatchSemanticFill = async (
  parameters: unknown,
  execute: ((command: SemanticFillCommand) => unknown | Promise<unknown>) | undefined
): Promise<FillDispatchResult> => {
  const command = parseSemanticFillCommand(parameters);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (!execute) return { ok: false, code: 'command-unavailable',
    message: 'Fill commands are unavailable in this host.' };
  try {
    const value = await execute(command);
    return value ? { ok: true, value } : { ok: false, code: 'execution-failed',
      message: 'The Fill operation did not change the target.' };
  } catch (reason) {
    return { ok: false, code: 'execution-failed',
      message: reason instanceof Error ? reason.message : String(reason) };
  }
};
