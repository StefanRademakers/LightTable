/* tslint:disable */
/* eslint-disable */

/**
 * Packed, allocation-bounded layout result. Numeric getters become JavaScript
 * typed arrays and avoid JSON/string copies across the WASM boundary.
 */
export class PackedFlowLayout {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    bounds(): Float32Array;
    caret_geometry(): Float32Array;
    caret_meta(): Uint32Array;
    cluster_map(): Uint32Array;
    clusters(): Uint32Array;
    geometry(): Float32Array;
    glyph_ids(): Uint32Array;
    grapheme_stops(): Uint32Array;
    line_geometry(): Float32Array;
    line_meta(): Uint32Array;
    run_meta(): Uint32Array;
    selection_geometry(): Float32Array;
    selection_meta(): Uint32Array;
    readonly key: string;
}

/**
 * Bounded hinted R8 mask used only by the renderer bakeoff.
 */
export class PackedGlyphCoverage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    pixels(): Uint8Array;
    readonly bearing_x: number;
    readonly bearing_y: number;
    readonly command_count: number;
    readonly height: number;
    readonly width: number;
}

/**
 * Releases all parsed fonts and scratch allocations for one generation.
 */
export function drop_layout_session(session_key: string): boolean;

/**
 * Memory-safe OpenType metadata inspection for the browser/Electron worker.
 */
export function inspect_font_json(data: Uint8Array, face_index: number): string;

/**
 * Rasterizes one exact registered face/glyph using Skrifa embedded hinting
 * and an allocation-bounded R8 coverage mask.
 */
export function rasterize_registered_glyph(session_key: string, asset_id: string, face_index: number, glyph_id: number, ppem: number): PackedGlyphCoverage;

/**
 * Shapes one validated flow-text request through the persistent Parley stack.
 * Style metadata uses fixed strides: u32 = start/end/source/style/face and
 * f32 = size/weight/stretch/tracking. String ranges address paired family and
 * expected font-asset identities in one UTF-8 byte table.
 */
export function realize_flow_text(session_key: string, key: string, text: string, max_width: number | null | undefined, alignment: number, line_height_kind: number, line_height_value: number, first_line_indent: number, start_indent: number, end_indent: number, space_before: number, space_after: number, origin_x: number, origin_y: number, max_glyph_count: number, style_meta: Uint32Array, style_metrics: Float32Array, font_strings_utf8: Uint8Array, string_ranges: Uint32Array): PackedFlowLayout;

/**
 * Registers immutable font bytes in one document-generation layout context.
 */
export function register_layout_font(session_key: string, asset_id: string, data: Uint8Array): number;

/**
 * Current reserved WASM linear memory, for bounded diagnostics only.
 */
export function text_engine_memory_bytes(): number;

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
    readonly __wbg_packedflowlayout_free: (a: number, b: number) => void;
    readonly __wbg_packedglyphcoverage_free: (a: number, b: number) => void;
    readonly drop_layout_session: (a: number, b: number) => number;
    readonly inspect_font_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly packedflowlayout_bounds: (a: number) => [number, number];
    readonly packedflowlayout_caret_geometry: (a: number) => [number, number];
    readonly packedflowlayout_caret_meta: (a: number) => [number, number];
    readonly packedflowlayout_cluster_map: (a: number) => [number, number];
    readonly packedflowlayout_clusters: (a: number) => [number, number];
    readonly packedflowlayout_geometry: (a: number) => [number, number];
    readonly packedflowlayout_glyph_ids: (a: number) => [number, number];
    readonly packedflowlayout_grapheme_stops: (a: number) => [number, number];
    readonly packedflowlayout_key: (a: number) => [number, number];
    readonly packedflowlayout_line_geometry: (a: number) => [number, number];
    readonly packedflowlayout_line_meta: (a: number) => [number, number];
    readonly packedflowlayout_run_meta: (a: number) => [number, number];
    readonly packedflowlayout_selection_geometry: (a: number) => [number, number];
    readonly packedflowlayout_selection_meta: (a: number) => [number, number];
    readonly packedglyphcoverage_bearing_x: (a: number) => number;
    readonly packedglyphcoverage_bearing_y: (a: number) => number;
    readonly packedglyphcoverage_command_count: (a: number) => number;
    readonly packedglyphcoverage_height: (a: number) => number;
    readonly packedglyphcoverage_pixels: (a: number) => [number, number];
    readonly packedglyphcoverage_width: (a: number) => number;
    readonly rasterize_registered_glyph: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly realize_flow_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number) => [number, number, number];
    readonly register_layout_font: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly text_engine_version: () => [number, number];
    readonly text_engine_memory_bytes: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
