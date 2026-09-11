/** Retains one in-flight settlement without latching its failure forever. */
export class TransformSettlementOwner {
  private current: Promise<void> | null = null;

  read(): Promise<void> {
    return this.current ?? Promise.resolve();
  }

  isPending(): boolean { return this.current !== null; }

  publish(operation: Promise<void>, reportFailure: (reason: unknown) => void): Promise<void> {
    this.current = operation;
    void operation.then(
      () => this.retire(operation),
      (reason) => {
        reportFailure(reason);
        this.retire(operation);
      }
    );
    return operation;
  }

  private retire(operation: Promise<void>) {
    if (this.current === operation) this.current = null;
  }
}

export const requireTransformSettlementRecovery = async (
  settlement: Promise<void>,
  recover: () => Promise<boolean>
): Promise<void> => {
  await settlement;
  if (!await recover()) {
    throw new Error(
      'The previous transform rollback is not exact; document mutation remains blocked.'
    );
  }
};
