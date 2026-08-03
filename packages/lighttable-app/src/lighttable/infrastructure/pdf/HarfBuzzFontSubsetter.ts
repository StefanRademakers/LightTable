const HARFBUZZ_MEMORY_MODE_DUPLICATE = 0;
const HARFBUZZ_SUBSET_FLAGS_RETAIN_GIDS = 0x0000_0002;
const HARFBUZZ_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x0000_0040;
const HARFBUZZ_SUBSET_FLAGS_DOWNGRADE_CFF2 = 0x0000_4000;

export interface HarfBuzzFontSubsetLimits {
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumGlyphCount: number;
  readonly maximumAxisCount: number;
}

export const DEFAULT_HARFBUZZ_FONT_SUBSET_LIMITS: HarfBuzzFontSubsetLimits = Object.freeze({
  maximumInputBytes: 64 * 1024 * 1024,
  maximumOutputBytes: 64 * 1024 * 1024,
  maximumGlyphCount: 65_534,
  maximumAxisCount: 64
});

export interface HarfBuzzFontSubsetRequest {
  readonly fontBytes: Uint8Array;
  readonly faceIndex: number;
  readonly glyphIds: readonly number[];
  readonly variableAxes?: Readonly<Record<string, number>>;
  readonly downgradeCff2?: boolean;
}

interface HarfBuzzSubsetExports extends WebAssembly.Exports {
  readonly _initialize: () => void;
  readonly memory: WebAssembly.Memory;
  readonly malloc: (size: number) => number;
  readonly free: (pointer: number) => void;
  readonly hb_blob_create: (
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number
  ) => number;
  readonly hb_blob_destroy: (blob: number) => void;
  readonly hb_blob_get_length: (blob: number) => number;
  readonly hb_blob_get_data: (blob: number, length: number) => number;
  readonly hb_face_create: (blob: number, faceIndex: number) => number;
  readonly hb_face_destroy: (face: number) => void;
  readonly hb_face_reference_blob: (face: number) => number;
  readonly hb_set_add: (set: number, codepoint: number) => void;
  readonly hb_subset_input_create_or_fail: () => number;
  readonly hb_subset_input_destroy: (input: number) => void;
  readonly hb_subset_input_glyph_set: (input: number) => number;
  readonly hb_subset_input_get_flags: (input: number) => number;
  readonly hb_subset_input_set_flags: (input: number, flags: number) => void;
  readonly hb_subset_input_pin_axis_location: (
    input: number,
    face: number,
    tag: number,
    value: number
  ) => number;
  readonly hb_subset_or_fail: (sourceFace: number, input: number) => number;
}

const fail = (message: string): never => {
  throw new Error(`HarfBuzz font subset ${message}`);
};

const positiveInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive safe integer.`);
};

const sfntSignature = (bytes: Uint8Array) => bytes.length >= 4
  ? String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  : '';

export const isSfntFont = (bytes: Uint8Array) => {
  const signature = sfntSignature(bytes);
  return signature === '\u0000\u0001\u0000\u0000'
    || signature === 'OTTO'
    || signature === 'true'
    || signature === 'typ1';
};

const tag = (value: string) => {
  if (!/^[\x20-\x7e]{4}$/.test(value)) fail(`axis tag ${JSON.stringify(value)} must contain four ASCII characters.`);
  return ((value.charCodeAt(0) << 24) >>> 0)
    | (value.charCodeAt(1) << 16)
    | (value.charCodeAt(2) << 8)
    | value.charCodeAt(3);
};

const requiredPointer = (value: number, name: string) => {
  if (!value) fail(`${name} allocation failed.`);
  return value;
};

const validateRequest = (
  request: HarfBuzzFontSubsetRequest,
  limits: HarfBuzzFontSubsetLimits
) => {
  positiveInteger(limits.maximumInputBytes, 'maximumInputBytes');
  positiveInteger(limits.maximumOutputBytes, 'maximumOutputBytes');
  positiveInteger(limits.maximumGlyphCount, 'maximumGlyphCount');
  positiveInteger(limits.maximumAxisCount, 'maximumAxisCount');
  if (request.fontBytes.byteLength === 0) fail('input is empty.');
  if (request.fontBytes.byteLength > limits.maximumInputBytes) fail('input exceeds the byte limit.');
  if (!isSfntFont(request.fontBytes)) fail('input must be an SFNT TrueType/OpenType font.');
  if (!Number.isSafeInteger(request.faceIndex) || request.faceIndex < 0 || request.faceIndex > 65_535) {
    fail('faceIndex must be an integer between 0 and 65535.');
  }
  if (request.glyphIds.length === 0) fail('requires at least one glyph ID.');
  if (request.glyphIds.length > limits.maximumGlyphCount) fail('glyph list exceeds the entry limit.');
  const glyphIds = [...new Set([0, ...request.glyphIds])].sort((left, right) => left - right);
  if (glyphIds.length > limits.maximumGlyphCount) fail('unique glyph closure exceeds the entry limit.');
  glyphIds.forEach((glyphId) => {
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId > 0xffff) {
      fail(`glyph ID ${glyphId} is outside the unsigned 16-bit range.`);
    }
  });
  const axes = Object.entries(request.variableAxes ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (axes.length > limits.maximumAxisCount) fail('variable axis list exceeds the entry limit.');
  axes.forEach(([axisTag, value]) => {
    tag(axisTag);
    if (!Number.isFinite(value)) fail(`axis ${axisTag} has a non-finite value.`);
  });
  return { glyphIds, axes };
};

const instantiate = async (wasmBytes: BufferSource) => {
  const result = await WebAssembly.instantiate(wasmBytes, {});
  const exports = result instanceof WebAssembly.Instance
    ? result.exports as HarfBuzzSubsetExports
    : result.instance.exports as HarfBuzzSubsetExports;
  exports._initialize();
  return exports;
};

const subsetWithRuntime = (
  hb: HarfBuzzSubsetExports,
  request: HarfBuzzFontSubsetRequest,
  limitOverrides: Partial<HarfBuzzFontSubsetLimits> = {}
): Uint8Array => {
  const limits = { ...DEFAULT_HARFBUZZ_FONT_SUBSET_LIMITS, ...limitOverrides };
  const { glyphIds, axes } = validateRequest(request, limits);
  const inputPointer = requiredPointer(hb.malloc(request.fontBytes.byteLength), 'input byte');
  let blob = 0;
  let face = 0;
  let subsetInput = 0;
  let subsetFace = 0;
  let subsetBlob = 0;
  try {
    new Uint8Array(hb.memory.buffer, inputPointer, request.fontBytes.byteLength)
      .set(request.fontBytes);
    blob = requiredPointer(hb.hb_blob_create(
      inputPointer,
      request.fontBytes.byteLength,
      HARFBUZZ_MEMORY_MODE_DUPLICATE,
      0,
      0
    ), 'font blob');
    face = requiredPointer(hb.hb_face_create(blob, request.faceIndex), 'font face');
    subsetInput = requiredPointer(hb.hb_subset_input_create_or_fail(), 'subset input');
    const glyphSet = requiredPointer(hb.hb_subset_input_glyph_set(subsetInput), 'glyph set');
    glyphIds.forEach((glyphId) => hb.hb_set_add(glyphSet, glyphId));
    const flags = hb.hb_subset_input_get_flags(subsetInput)
      | HARFBUZZ_SUBSET_FLAGS_RETAIN_GIDS
      | HARFBUZZ_SUBSET_FLAGS_NOTDEF_OUTLINE
      | (request.downgradeCff2 ? HARFBUZZ_SUBSET_FLAGS_DOWNGRADE_CFF2 : 0);
    hb.hb_subset_input_set_flags(subsetInput, flags);
    axes.forEach(([axisTag, value]) => {
      if (!hb.hb_subset_input_pin_axis_location(subsetInput, face, tag(axisTag), value)) {
        fail(`could not pin variable axis ${axisTag}=${value}.`);
      }
    });
    subsetFace = requiredPointer(hb.hb_subset_or_fail(face, subsetInput), 'subset face');
    subsetBlob = requiredPointer(hb.hb_face_reference_blob(subsetFace), 'subset blob');
    const outputLength = hb.hb_blob_get_length(subsetBlob);
    if (outputLength <= 0) fail('output is empty.');
    if (outputLength > limits.maximumOutputBytes) fail('output exceeds the byte limit.');
    const outputPointer = requiredPointer(hb.hb_blob_get_data(subsetBlob, 0), 'output byte');
    const output = Uint8Array.from(new Uint8Array(hb.memory.buffer, outputPointer, outputLength));
    if (!isSfntFont(output)) fail('output is not an SFNT font.');
    return output;
  } finally {
    if (subsetBlob) hb.hb_blob_destroy(subsetBlob);
    if (subsetFace) hb.hb_face_destroy(subsetFace);
    if (subsetInput) hb.hb_subset_input_destroy(subsetInput);
    if (face) hb.hb_face_destroy(face);
    if (blob) hb.hb_blob_destroy(blob);
    hb.free(inputPointer);
  }
};

export interface HarfBuzzFontSubsetter {
  /** The call is synchronous once the lazy WASM runtime has been instantiated. */
  subset(
    request: HarfBuzzFontSubsetRequest,
    limitOverrides?: Partial<HarfBuzzFontSubsetLimits>
  ): Uint8Array;
}

/**
 * Instantiates one bounded HarfBuzz runtime for a complete export transaction.
 * Reusing it avoids allocating the WASM heap once per font. Drop the returned
 * object after export so the browser can reclaim that heap.
 */
export const createHarfBuzzFontSubsetter = async (
  wasmBytes: BufferSource
): Promise<HarfBuzzFontSubsetter> => {
  const runtime = await instantiate(wasmBytes);
  return {
    subset: (request, limitOverrides) => subsetWithRuntime(runtime, request, limitOverrides)
  };
};

/** Convenience entry point for one-off callers and focused adapter tests. */
export const subsetSfntFontWithHarfBuzz = async (
  wasmBytes: BufferSource,
  request: HarfBuzzFontSubsetRequest,
  limitOverrides: Partial<HarfBuzzFontSubsetLimits> = {}
): Promise<Uint8Array> => (
  await createHarfBuzzFontSubsetter(wasmBytes)
).subset(request, limitOverrides);
