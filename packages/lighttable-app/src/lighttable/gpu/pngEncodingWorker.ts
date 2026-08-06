interface PngEncodingRequest {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayBuffer;
}

interface PngEncodingResponse {
  readonly id: number;
  readonly blob?: Blob;
  readonly error?: string;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = async ({ data }: MessageEvent<PngEncodingRequest>) => {
  try {
    const canvas = new OffscreenCanvas(data.width, data.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG worker canvas could not be created.');
    const pixels = new Uint8ClampedArray(data.pixels);
    context.putImageData(new ImageData(pixels, data.width, data.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    scope.postMessage({ id: data.id, blob } satisfies PngEncodingResponse);
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error)
    } satisfies PngEncodingResponse);
  }
};

export {};
