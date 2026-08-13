// Deterministic 1x1 opaque PNG used only by protocol and lifecycle tests.
const TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XjV1AAAAAElFTkSuQmCC', 'base64');

export class FakeInferenceBackend {
  async ready() { return true; }
  async run({ signal, onProgress }) {
    onProgress?.(0.25, 'loading-model');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 10);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Job cancelled.'), { code: 'JOB_CANCELLED' }));
      }, { once: true });
    });
    onProgress?.(0.75, 'running');
    return [{ bytes: TEST_PNG, mimeType: 'image/png', width: 1, height: 1 }];
  }
}
