/* tslint:disable */
/* eslint-disable */

export class VelloInteropDevice {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static create(): Promise<VelloInteropDevice>;
    device_handle(): any;
    diagnostics_json(): string;
    dispose(): void;
    release_paint_scene_source(source_id: string): void;
    /**
     * Applies a bounded fragment delta and renders the current source scene.
     * Returns true only when the already-compiled source revision was reused.
     */
    render_incremental_paint_scene_texture(texture: any, width: number, height: number, source_id: string, update_json: string): boolean;
    /**
     * Returns true when the compiled Vello scene was already cached.
     */
    render_paint_scene_texture(texture: any, width: number, height: number, scene_key: string, scene_json: string): boolean;
    scene_cache_entries(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_vellointeropdevice_free: (a: number, b: number) => void;
    readonly vellointeropdevice_create: () => any;
    readonly vellointeropdevice_device_handle: (a: number) => [number, number, number];
    readonly vellointeropdevice_diagnostics_json: (a: number) => [number, number];
    readonly vellointeropdevice_dispose: (a: number) => void;
    readonly vellointeropdevice_release_paint_scene_source: (a: number, b: number, c: number) => void;
    readonly vellointeropdevice_render_incremental_paint_scene_texture: (a: number, b: any, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly vellointeropdevice_render_paint_scene_texture: (a: number, b: any, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly vellointeropdevice_scene_cache_entries: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h815b7f6b18672e9f: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h8ed73831599be5e0: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h8ed73831599be5e0_2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h8ed73831599be5e0_3: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h247af7eb24bf918e: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
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
