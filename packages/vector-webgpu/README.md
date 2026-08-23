# @lighttable/vector-webgpu

Native LightTable WebGPU realization for vector fills, strokes, masks and
editor overlays. It owns backend buffers, pipelines, encoding and explicit
resource disposal; canonical geometry remains in `@lighttable/vector-core`.

In the hybrid renderer this is the compatibility/specialized path for islands
that Vello cannot admit and for native interaction overlays. It shares the same
`GPUDevice` and final LightTable compositor with Vello; it is not a competing
document or launch mode.
