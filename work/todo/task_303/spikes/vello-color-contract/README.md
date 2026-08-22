# Vello linear-color contract probe

This bounded native probe verifies the exact color path used by the reviewed
LightTable Vello patch. It feeds a 50% display-sRGB gray represented as the
linear value `0.21404114` through Peniko and Vello's scene encoder and prints
the packed draw word. The expected opaque result is `ff373737` (55 per linear
RGB channel), not the sRGB-encoded `ff808080`.

Prepare the managed Vello checkout with `npm run ensure:vector-vello-wasm`,
then run from the repository root:

```powershell
cargo run --manifest-path work/todo/task_303/spikes/vello-color-contract/Cargo.toml
```

The permanent upstream-patch regression test also checks a half-transparent
linear midtone and requires premultiplied `0x801b1b1b`.
