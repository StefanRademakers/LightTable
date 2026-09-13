import type { ImageDocument } from '../../../editor/document/documentTypes';

type SelectionModifyParameters =
  | { readonly kind: 'modify'; readonly operation: 'all' | 'clear' | 'invert' }
  | { readonly kind: 'modify'; readonly operation: 'similar'; readonly layerId: NonNullable<ImageDocument['activeLayerId']>;
      readonly tolerance: number; readonly antiAlias: boolean; readonly sampleAllLayers: boolean }
  | { readonly kind: 'modify'; readonly operation: 'feather'; readonly radius: number;
      readonly applyAtCanvasBounds: boolean }
  | { readonly kind: 'modify'; readonly operation: 'border'; readonly width: number }
  | { readonly kind: 'modify'; readonly operation: 'smooth' | 'expand' | 'contract'; readonly radius: number;
      readonly applyAtCanvasBounds: boolean };

export interface SelectionMenuIntentPorts {
  runAfterAdmission(action: () => void): unknown;
  execute(parameters: SelectionModifyParameters): void;
  getDocument(): ImageDocument | null;
  hasActiveSelection(): boolean;
  getMagicWand(): { readonly tolerance: number; readonly antiAlias: boolean; readonly sampleAllLayers: boolean };
  reportError(message: string): void;
}

/** Owns selection menu/dialog intent mapping; mutation remains in the semantic command. */
export class SelectionMenuIntents {
  constructor(private readonly ports: SelectionMenuIntentPorts) {}

  readonly selectAll = (): void => this.run({ kind: 'modify', operation: 'all' });
  readonly clear = (): void => this.run({ kind: 'modify', operation: 'clear' });
  readonly invert = (): void => this.run({ kind: 'modify', operation: 'invert' });

  readonly selectSimilar = (): void => {
    this.ports.runAfterAdmission(() => {
      const document = this.ports.getDocument();
      if (!document?.activeLayerId) return;
      try {
        if (!this.ports.hasActiveSelection()) return;
      } catch (reason) {
        this.ports.reportError(reason instanceof Error ? reason.message : 'The current selection is unavailable.');
        return;
      }
      const magicWand = this.ports.getMagicWand();
      this.ports.execute({
        kind: 'modify',
        operation: 'similar',
        layerId: document.activeLayerId,
        tolerance: magicWand.tolerance,
        antiAlias: magicWand.antiAlias,
        sampleAllLayers: magicWand.sampleAllLayers
      });
    });
  };

  readonly feather = (radius: number, applyAtCanvasBounds: boolean): void => {
    this.run({ kind: 'modify', operation: 'feather', radius, applyAtCanvasBounds });
  };

  readonly modify = (
    operation: 'border' | 'smooth' | 'expand' | 'contract',
    amount: number,
    applyAtCanvasBounds: boolean
  ): void => {
    this.run(operation === 'border'
      ? { kind: 'modify', operation, width: amount }
      : { kind: 'modify', operation, radius: amount, applyAtCanvasBounds });
  };

  private run(parameters: SelectionModifyParameters): void {
    this.ports.runAfterAdmission(() => this.ports.execute(parameters));
  }
}
