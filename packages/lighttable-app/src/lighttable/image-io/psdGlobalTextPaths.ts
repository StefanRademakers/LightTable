import type { Layer, Psd } from 'ag-psd';

type EngineValue = null | boolean | number | string | EngineValue[] | EngineDictionary;
interface EngineDictionary { [key: string]: EngineValue }

const MAX_ENGINE_DATA_BYTES = 16 * 1024 * 1024;
const MAX_ENGINE_DEPTH = 128;

const whitespace = (byte: number) => byte === 32 || byte === 10 || byte === 13 || byte === 9;
const numberByte = (byte: number) => (byte >= 48 && byte <= 57) || byte === 46 || byte === 45;

/**
 * Parses Photoshop's PostScript-like global text dictionary. Adobe files in
 * the wild occasionally contain byte strings without the UTF-16 BOM required
 * by ag-psd. Those strings are decoded as escaped Latin-1 instead of causing
 * the complete TextFrameSet (including path-text geometry) to be discarded.
 */
export const parsePsdGlobalEngineData = (data: Uint8Array): EngineDictionary => {
  if (data.byteLength > MAX_ENGINE_DATA_BYTES) throw new Error('PSD global text data exceeds the safety limit.');
  let index = 0;
  let root: EngineValue | undefined;
  const stack: (EngineDictionary | EngineValue[] | string)[] = [];
  const skip = () => { while (index < data.length && whitespace(data[index]!)) index += 1; };
  const escapedByte = () => {
    let byte = data[index++]!;
    if (byte === 92 && index < data.length) byte = data[index++]!;
    return byte;
  };
  const pop = () => {
    if (stack.length === 0) throw new Error('Malformed PSD global text data.');
    stack.pop();
  };
  const pushValue = (value: EngineValue) => {
    const top = stack.at(-1);
    if (typeof top === 'string') {
      const parent = stack.at(-2);
      if (!parent || Array.isArray(parent) || typeof parent === 'string') {
        throw new Error('Malformed PSD global text property.');
      }
      parent[top] = value;
      pop();
    } else if (Array.isArray(top)) {
      top.push(value);
    } else {
      throw new Error('Malformed PSD global text value.');
    }
  };
  const pushContainer = (value: EngineDictionary | EngineValue[]) => {
    if (stack.length === 0) root = value;
    else pushValue(value);
    stack.push(value);
    if (stack.length > MAX_ENGINE_DEPTH) throw new Error('PSD global text nesting exceeds the safety limit.');
  };
  const pushProperty = (name: string) => {
    if (stack.length === 0) pushContainer({});
    const top = stack.at(-1);
    if (typeof top === 'string') pushValue(name === 'nil' ? null : `/${name}`);
    else if (top && !Array.isArray(top)) stack.push(name);
    else throw new Error('Malformed PSD global text property.');
  };
  const text = () => {
    if (data[index] === 41) { index += 1; return ''; }
    const utf16 = data[index] === 0xfe && data[index + 1] === 0xff;
    if (utf16) index += 2;
    let result = '';
    while (index < data.length && data[index] !== 41) {
      if (utf16) {
        const high = escapedByte();
        if (index >= data.length) throw new Error('Truncated UTF-16 PSD text string.');
        result += String.fromCharCode((high << 8) | escapedByte());
      } else {
        result += String.fromCharCode(escapedByte());
      }
    }
    if (data[index] !== 41) throw new Error('Unterminated PSD text string.');
    index += 1;
    return result;
  };

  skip();
  let length = data.length;
  while (length > 0 && data[length - 1] === 0) length -= 1;
  while (index < length) {
    const byte = data[index]!;
    if (byte === 60 && data[index + 1] === 60) { index += 2; pushContainer({}); }
    else if (byte === 62 && data[index + 1] === 62) { index += 2; pop(); }
    else if (byte === 47) {
      index += 1;
      const start = index;
      while (index < length && !whitespace(data[index]!) && ![60, 62, 91, 93].includes(data[index]!)) index += 1;
      pushProperty(String.fromCharCode(...data.subarray(start, index)));
    } else if (byte === 40) { index += 1; pushValue(text()); }
    else if (byte === 91) { index += 1; pushContainer([]); }
    else if (byte === 93) { index += 1; pop(); }
    else if (data.subarray(index, index + 4).every((value, offset) => value === [110, 117, 108, 108][offset])) {
      index += 4; pushValue(null);
    } else if (data.subarray(index, index + 4).every((value, offset) => value === [116, 114, 117, 101][offset])) {
      index += 4; pushValue(true);
    } else if (data.subarray(index, index + 5).every((value, offset) => value === [102, 97, 108, 115, 101][offset])) {
      index += 5; pushValue(false);
    } else if (numberByte(byte)) {
      const start = index;
      while (index < length && numberByte(data[index]!)) index += 1;
      const value = Number.parseFloat(String.fromCharCode(...data.subarray(start, index)));
      if (!Number.isFinite(value)) throw new Error('Invalid number in PSD global text data.');
      pushValue(value);
    } else {
      // Photoshop dictionaries contain harmless delimiters/version markers;
      // match ag-psd's recovery behavior and skip unknown single bytes.
      index += 1;
    }
    skip();
  }
  if (!root || Array.isArray(root) || typeof root !== 'object') {
    throw new Error('PSD global text root is missing.');
  }
  return root;
};

const dictionary = (value: EngineValue | undefined): EngineDictionary | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const numbers = (value: EngineValue | undefined) =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number') ? value as number[] : null;

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const textLayers = (layers: readonly Layer[] | undefined): Layer[] => {
  const result: Layer[] = [];
  const visit = (nodes: readonly Layer[] | undefined) => nodes?.forEach((layer) => {
    if (layer.text) result.push(layer);
    visit(layer.children);
  });
  visit(layers);
  return result;
};

/** Restores TextFrameSet paths that ag-psd could not attach to TySh layers. */
export const recoverPsdGlobalTextPaths = (psd: Psd) => {
  if (!psd.engineData) return 0;
  const root = parsePsdGlobalEngineData(decodeBase64(psd.engineData));
  const resource = dictionary(root['0']);
  const frameSet = dictionary(resource?.['8']);
  const frames = frameSet?.['0'];
  if (!Array.isArray(frames)) return 0;
  const layers = textLayers(psd.children);
  let recovered = 0;
  frames.forEach((frameValue, frameIndex) => {
    const frame = dictionary(frameValue);
    const path = dictionary(frame?.['0']);
    const bezier = dictionary(path?.['1']);
    const data = dictionary(path?.['2']);
    const controlPoints = numbers(bezier?.['0']);
    const frameMatrix = numbers(data?.['2']);
    const textRange = numbers(data?.['6']);
    if (!controlPoints || controlPoints.length < 8 || controlPoints.length % 8 !== 0
      || !frameMatrix || frameMatrix.length !== 6 || !textRange || textRange.length !== 2) return;
    const layer = layers.find((candidate) => candidate.text?.index === frameIndex);
    if (!layer?.text || layer.text.textPath) return;
    const pathData = dictionary(data?.['11']);
    layer.text.textPath = {
      bezierCurve: { controlPoints },
      data: {
        type: typeof data?.['0'] === 'number' ? data['0'] : undefined,
        orientation: typeof data?.['1'] === 'number' ? data['1'] : undefined,
        frameMatrix,
        textRange,
        pathData: { reversed: pathData?.['0'] === true }
      }
    };
    recovered += 1;
  });
  return recovered;
};
