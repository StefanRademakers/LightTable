import type { AdvancedSourceImageDescriptor } from './types';
import type { NativeBitmapFormatId } from './nativeBitmapFormats';

export interface WasmVipsDecodeRequest {
  kind: 'decode';
  requestId: number;
  bytes: ArrayBuffer;
  contentType: string;
}

export interface WasmVipsDecodeSuccess {
  kind: 'decoded';
  requestId: number;
  pixels: ArrayBuffer;
  descriptor: AdvancedSourceImageDescriptor;
}

export interface WasmVipsDecodeFailure {
  kind: 'error';
  requestId: number;
  message: string;
}

export interface WasmVipsEncodeRequest {
  kind: 'encode';
  requestId: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  storage: 'u8' | 'u16' | 'f16-display';
  format: NativeBitmapFormatId;
}

export interface WasmVipsEncodeSuccess {
  kind: 'encoded';
  requestId: number;
  bytes: ArrayBuffer;
}

export type WasmVipsWorkerRequest = WasmVipsDecodeRequest | WasmVipsEncodeRequest;
export type WasmVipsWorkerResponse =
  | WasmVipsDecodeSuccess
  | WasmVipsEncodeSuccess
  | WasmVipsDecodeFailure;
