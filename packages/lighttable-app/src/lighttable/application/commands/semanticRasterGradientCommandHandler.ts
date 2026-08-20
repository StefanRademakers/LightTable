import { parseSemanticRasterGradientCommand, type SemanticRasterGradientCommand
} from './semanticRasterGradientCommandContract';

type RasterGradientDispatch = { readonly ok: true; readonly value: unknown } | {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};

export const dispatchSemanticRasterGradient = async (
  parameters: unknown,
  execute: ((command: SemanticRasterGradientCommand) => unknown | Promise<unknown>) | undefined
): Promise<RasterGradientDispatch> => {
  const command = parseSemanticRasterGradientCommand(parameters);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (!execute) return { ok: false, code: 'command-unavailable',
    message: 'Raster-gradient commands are unavailable in this host.' };
  try {
    const value = await execute(command);
    return value ? { ok: true, value } : { ok: false, code: 'execution-failed',
      message: 'The raster gradient did not change the target.' };
  } catch (reason) {
    return { ok: false, code: 'execution-failed',
      message: reason instanceof Error ? reason.message : String(reason) };
  }
};
