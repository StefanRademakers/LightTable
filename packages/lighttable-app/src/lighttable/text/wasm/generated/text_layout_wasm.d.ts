/* tslint:disable */
/* eslint-disable */

/**
 * Memory-safe OpenType metadata inspection for the browser/Electron worker.
 */
export function inspect_font_json(data: Uint8Array, face_index: number): string;

/**
 * Smoke-test API for the cross-host text engine boundary.
 *
 * Layout and font APIs are added only after their serializable contracts are
 * frozen in Slice 02. Keeping this export deliberately small prevents the
 * toolchain spike from becoming an accidental production ABI.
 */
export function text_engine_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly inspect_font_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly text_engine_version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
