import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';

type RasterAuthoringCommandPorts = Pick<DocumentLightTableCommandPorts,
  'executeFillCommand' | 'executeRasterGradientCommand' | 'executeRasterInvert'>;

/** Ensures discrete raster commands settle presentation-owned pixels first. */
export const createRasterAuthoringCommandPorts = ({
  settle,
  fill,
  gradient,
  invert
}: {
  readonly settle: () => Promise<void>;
  readonly fill: NonNullable<RasterAuthoringCommandPorts['executeFillCommand']>;
  readonly gradient: NonNullable<RasterAuthoringCommandPorts['executeRasterGradientCommand']>;
  readonly invert: (layerId: Parameters<NonNullable<RasterAuthoringCommandPorts['executeRasterInvert']>>[0]['layerId'],
    channel: Parameters<NonNullable<RasterAuthoringCommandPorts['executeRasterInvert']>>[0]['channel']) => boolean;
}): RasterAuthoringCommandPorts => ({
  executeFillCommand: async command => {
    await settle();
    return fill(command);
  },
  executeRasterGradientCommand: async command => {
    await settle();
    return gradient(command);
  },
  executeRasterInvert: async command => {
    await settle();
    return invert(command.layerId, command.channel) ? command : null;
  }
});
