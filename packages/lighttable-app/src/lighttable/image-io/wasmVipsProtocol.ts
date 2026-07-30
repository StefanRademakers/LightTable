import type { AdvancedSourceImageDescriptor } from './types';

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

export type WasmVipsWorkerRequest = WasmVipsDecodeRequest;
export type WasmVipsWorkerResponse = WasmVipsDecodeSuccess | WasmVipsDecodeFailure;
