# wgpu 30 browser-WebGPU interop spike

This isolated probe tests the ownership model required for a zero-copy Vello
backend in LightTable:

1. Rust/wgpu requests the browser `GPUDevice`.
2. Rust exports that exact device to JavaScript.
3. JavaScript creates a `GPUTexture` on it.
4. Rust wraps and clears that foreign texture through wgpu.
5. JavaScript reads the same texture back and checks the pixel value.

The probe deliberately does not depend on product code. Build the WASM module,
generate bindings, and execute it in LightTable's Electron version:

```powershell
cargo build --release --target wasm32-unknown-unknown
D:\mediavibe\LightTable\.tools\text-wasm\bin\wasm-bindgen.exe --target web --out-dir pkg --out-name interop target\wasm32-unknown-unknown\release\lighttable_wgpu30_webgpu_interop_spike.wasm
D:\mediavibe\LightTable\node_modules\electron\dist\electron.exe electron-main.cjs
```

`INTEROP_PASS` proves texture sharing without a CPU or GPU copy. It does not yet
prove Vello compatibility; Vello itself must next be compiled against the same
wgpu major and render a representative LightTable scene into the shared texture.

