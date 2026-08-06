interface RecoveryHashRequest { readonly id: number; readonly blob: Blob }

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = ({ data }: MessageEvent<RecoveryHashRequest>) => {
  void (async () => {
    try {
      const bytes = await data.blob.arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const value = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      scope.postMessage({ id: data.id, value, bytes }, [bytes]);
    } catch (reason) {
      scope.postMessage({ id: data.id, error: reason instanceof Error ? reason.message : String(reason) });
    }
  })();
};

export {};
