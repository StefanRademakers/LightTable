export type DocumentGpuResourceRelease = () => void;
export type DocumentGpuResourceKey = string | symbol;
export type DocumentGpuResourceDetach = () => DocumentGpuResourceRelease | null;

export interface SubmittedResourceOwner {
  readonly queue: {
    onSubmittedWorkDone(): Promise<unknown>;
  };
}

interface DeviceResourceBinding {
  readonly owner: SubmittedResourceOwner;
  readonly detach: DocumentGpuResourceDetach;
}

/**
 * Owns the durable relationship between a canonical document and every
 * device-scoped repository that currently realizes its binary assets.
 *
 * Renderer detach deliberately does not release these bindings: another
 * canvas on the same device can reuse them. Document close releases every
 * device generation, while device loss releases only the invalid generation.
 * Neither operation depends on whichever React renderer happens to be active.
 */
export class DocumentGpuResourceRegistry {
  private readonly bindings = new Map<
    DocumentGpuResourceKey,
    Map<SubmittedResourceOwner, DeviceResourceBinding>
  >();

  constructor(
    private readonly reportReleaseError: (reason: unknown) => void = (reason) => {
      console.error('LightTable document GPU resource cleanup failed.', reason);
    }
  ) {}

  bind(
    documentId: DocumentGpuResourceKey,
    owner: SubmittedResourceOwner,
    detach: DocumentGpuResourceDetach
  ): void {
    let documentBindings = this.bindings.get(documentId);
    if (!documentBindings) {
      documentBindings = new Map();
      this.bindings.set(documentId, documentBindings);
    }
    documentBindings.set(owner, { owner, detach });
  }

  releaseDocument(documentId: DocumentGpuResourceKey): boolean {
    const documentBindings = this.bindings.get(documentId);
    if (!documentBindings) return false;
    this.bindings.delete(documentId);
    this.retireBindings(documentBindings.values());
    return true;
  }

  releaseOwner(owner: SubmittedResourceOwner): number {
    const releases: DeviceResourceBinding[] = [];
    for (const [documentId, documentBindings] of this.bindings) {
      const binding = documentBindings.get(owner);
      if (!binding) continue;
      documentBindings.delete(owner);
      releases.push(binding);
      if (documentBindings.size === 0) this.bindings.delete(documentId);
    }
    this.retireBindings(releases);
    return releases.length;
  }

  has(documentId: DocumentGpuResourceKey, owner?: SubmittedResourceOwner): boolean {
    const documentBindings = this.bindings.get(documentId);
    return owner ? documentBindings?.has(owner) ?? false : Boolean(documentBindings?.size);
  }

  private retireBindings(bindings: Iterable<DeviceResourceBinding>): void {
    for (const binding of bindings) {
      let release: DocumentGpuResourceRelease | null = null;
      try { release = binding.detach(); } catch (reason) { this.reportReleaseError(reason); }
      if (!release) continue;
      const destroy = () => {
        try { release?.(); } catch (reason) { this.reportReleaseError(reason); }
      };
      try {
        void binding.owner.queue.onSubmittedWorkDone().then(destroy, destroy);
      } catch {
        destroy();
      }
    }
  }
}

const documentGpuResources = new DocumentGpuResourceRegistry();

export const bindDocumentGpuResources = (
  documentId: DocumentGpuResourceKey,
  owner: SubmittedResourceOwner,
  detach: DocumentGpuResourceDetach
): void => documentGpuResources.bind(documentId, owner, detach);

export const releaseDocumentGpuResources = (documentId: DocumentGpuResourceKey): boolean =>
  documentGpuResources.releaseDocument(documentId);

export const releaseDeviceGpuResources = (owner: SubmittedResourceOwner): number =>
  documentGpuResources.releaseOwner(owner);
