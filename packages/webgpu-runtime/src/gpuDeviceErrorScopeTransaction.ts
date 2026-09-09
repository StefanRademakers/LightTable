export interface GpuDeviceErrorScopeResult<Value> {
  readonly value: Value;
  readonly errors: ReadonlyMap<GPUErrorFilter, GPUError | null>;
}

const deviceScopeTails = new WeakMap<GPUDevice, Promise<void>>();

/**
 * Runs one balanced error-scope transaction on a shared GPUDevice.
 *
 * Error scopes are a device-global LIFO stack, so asynchronous owners may not
 * interleave their push/pop pairs. The lock is held through every pop and pop
 * failures are surfaced only after all successfully pushed scopes unwind.
 */
export const runGpuDeviceErrorScopeTransaction = async <Value>(
  device: GPUDevice,
  filters: readonly GPUErrorFilter[],
  operation: () => Value | Promise<Value>
): Promise<GpuDeviceErrorScopeResult<Value>> => {
  const previous = deviceScopeTails.get(device) ?? Promise.resolve();
  let release!: () => void;
  const owned = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => owned);
  deviceScopeTails.set(device, tail);
  await previous;

  try {
    const pushed: GPUErrorFilter[] = [];
    let value!: Value;
    let operationFailure: unknown = null;
    for (const filter of filters) {
      try {
        device.pushErrorScope(filter);
        pushed.push(filter);
      } catch (reason) {
        operationFailure = reason;
        break;
      }
    }
    if (operationFailure === null) {
      try {
        value = await operation();
      } catch (reason) {
        operationFailure = reason;
      }
    }

    const errors = new Map<GPUErrorFilter, GPUError | null>();
    const popFailures: unknown[] = [];
    for (const filter of pushed.reverse()) {
      try {
        errors.set(filter, await device.popErrorScope());
      } catch (reason) {
        popFailures.push(reason);
      }
    }
    if (operationFailure !== null && popFailures.length > 0) {
      throw new AggregateError(
        [operationFailure, ...popFailures],
        'WebGPU operation and error-scope cleanup failed.'
      );
    }
    if (operationFailure !== null) throw operationFailure;
    if (popFailures.length > 0) {
      throw new AggregateError(popFailures, 'WebGPU error-scope cleanup failed.');
    }
    return { value, errors };
  } finally {
    release();
    if (deviceScopeTails.get(device) === tail) deviceScopeTails.delete(device);
  }
};
