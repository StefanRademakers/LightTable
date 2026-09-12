import type { LightTableCommandService } from '../../commands/lightTableCommandService';
import type { DocumentSession } from '../../documents/documentSession';
import type { SelectionSessionDependencies } from './selectionSessionPorts';

type CommittedCommand<Key extends 'onShapeCommitted' | 'onMagicWandCommitted' | 'onPaintCommitted'> =
  Parameters<NonNullable<SelectionSessionDependencies[Key]>>[0];

/** Captured at input admission; observation must never resolve a later active document. */
export class SelectionCommandObservation {
  constructor(private readonly session: Pick<DocumentSession, 'id'> | undefined,
    private readonly commands: Pick<LightTableCommandService, 'recordObservedCommand'>,
    private readonly isCurrent: () => boolean) {}

  shape = (parameters: CommittedCommand<'onShapeCommitted'>) => {
    if (!this.session || !this.isCurrent()) return;
    this.commands.recordObservedCommand('selection.applyShape', this.session.id, parameters,
      { mode: parameters.mode, shape: parameters.shape,
        featherRadius: parameters.featherRadius, antiAlias: parameters.antiAlias });
  };
  magicWand = (parameters: CommittedCommand<'onMagicWandCommitted'>) => {
    if (!this.session || !this.isCurrent()) return;
    this.commands.recordObservedCommand('selection.applyMagicWand', this.session.id, parameters,
      { layerId: parameters.layerId, mode: parameters.mode, point: parameters.point, options: parameters.options });
  };
  paint = (parameters: CommittedCommand<'onPaintCommitted'>) => {
    if (!this.session || !this.isCurrent()) return;
    this.commands.recordObservedCommand('tool.commitGesture', this.session.id, {
      kind: 'selection-paint', parameters: { mode: parameters.mode, size: parameters.size,
        hardness: parameters.hardness, opacity: parameters.opacity, smooth: parameters.smooth },
      samples: parameters.samples.map(({ x, y, pressure }) => ({ x, y, pressure }))
    }, { kind: 'selection-paint', sampleCount: parameters.samples.length });
  };
}
