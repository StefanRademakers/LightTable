import type { AffineMatrix } from '../../../editor/tools/transform/transformTypes';
import type { LayerId } from '../../../editor/document/documentTypes';
import type { DocumentSession } from '../../documents/documentSession';
import type { FixedTransformOperation } from './fixedTransformCommands';
import type { FixedTransformTarget } from './useTransformSessionController';

export interface FixedTransformCommandBindingPorts {
  getSession(): DocumentSession | null | undefined;
  applyFixed(operation: FixedTransformOperation): Promise<FixedTransformTarget | null>;
  recordCommitted(layerId: LayerId, transform: AffineMatrix): void;
}

/** Pins one-shot transform result inference and observation suppression to its opening session. */
export class FixedTransformCommandBinding {
  private running = false;

  constructor(private readonly ports: FixedTransformCommandBindingPorts) {}

  readonly observeCommitted = (layerId: LayerId, transform: AffineMatrix): void => {
    if (!this.running) this.ports.recordCommitted(layerId, transform);
  };

  readonly execute = async (operation: FixedTransformOperation): Promise<unknown> => {
    if (this.running) return null;
    const session = this.ports.getSession();
    const before = session?.getSnapshot().document;
    if (!session || !before) return null;
    this.running = true;
    try {
      const target = await this.ports.applyFixed(operation);
      const after = session.getSnapshot().document;
      return target && after && after.id === before.id && after.revision !== before.revision
        ? { operation, target, documentRevision: after.revision }
        : null;
    } finally {
      this.running = false;
    }
  };
}
