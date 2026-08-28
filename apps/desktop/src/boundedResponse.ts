export const readResponseBytesBounded = async (
  response: Response,
  maximumBytes: number,
  label: string
): Promise<Uint8Array> => {
  const declaredLengthText = response.headers.get('content-length');
  const declaredLength = declaredLengthText === null ? undefined : Number(declaredLengthText);
  const message = `${label} exceeds the ${Math.floor(maximumBytes / (1024 * 1024))} MiB safety limit.`;
  if (declaredLength !== undefined && (
    !Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes
  )) throw new Error(message);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(message);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes || chunks.length >= 65_536) {
        await reader.cancel().catch(() => undefined);
        throw new Error(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
