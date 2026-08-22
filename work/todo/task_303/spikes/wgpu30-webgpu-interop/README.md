# wgpu 30 browser-WebGPU interop spike

This isolated probe tests a real Vello scene through the ownership model
required for a zero-copy Vello backend in LightTable:

1. Rust/wgpu requests the browser `GPUDevice`.
2. Rust exports that exact device to JavaScript.
3. JavaScript creates a `GPUTexture` on it.
4. Rust wraps that foreign texture and Vello renders a background plus circle.
5. JavaScript reads the same texture back and checks both pixel values.

The probe deliberately does not depend on product code. It uses pinned Vello
commit `3fabef9315914fc2fa32eed12afac8922785396b`. Vello 0.10 currently pins
wgpu 29; `vello-wgpu30.patch` contains the three small changes needed by this
configuration. Prepare the ignored reference worktree from the repository root:

```powershell
git -C .referenceCode/vello worktree add --detach ../vello-wgpu30-interop 3fabef9315914fc2fa32eed12afac8922785396b
git -C .referenceCode/vello-wgpu30-interop apply ../../work/todo/task_303/spikes/wgpu30-webgpu-interop/vello-wgpu30.patch
```

Then build the WASM module, generate bindings, and execute it in LightTable's
Electron version:

```powershell
cargo build --release --target wasm32-unknown-unknown
D:\mediavibe\LightTable\.tools\text-wasm\bin\wasm-bindgen.exe --target web --out-dir pkg --out-name interop target\wasm32-unknown-unknown\release\lighttable_wgpu30_webgpu_interop_spike.wasm
D:\mediavibe\LightTable\node_modules\electron\dist\electron.exe electron-main.cjs
```

`INTEROP_PASS` proves Vello can render into the shared texture without a CPU or
GPU texture copy. The probe also serializes the schema-1 `@lighttable/paint-scene`
shape and has Rust/Vello decode and render that exact command stream. The next
proof is compiling representative native-vector/PDF fixtures and measuring the
same scene in both backends for pixels, cold render, mutation, pan/zoom, memory,
binary size and round-trip behavior.
