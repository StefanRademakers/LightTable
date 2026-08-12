export const SAM2_SMALL_PROFILE = {
  modelId: 'onnx-community/sam2.1-hiera-small-ONNX',
  artifactRevision: 'a7df49d8de14b9d2e4504d1687b0d568f905fd8d',
  precision: 'fp16',
  preprocessingRevision: 'sam2-1024-v1',
  graphNames: ['vision_encoder', 'prompt_encoder_mask_decoder']
} as const;

export const SLIMSAM_PROFILE = {
  modelId: 'Xenova/slimsam-77-uniform',
  artifactRevision: 'main',
  precision: 'auto',
  preprocessingRevision: 'sam-v1'
} as const;
