# Result

- Every rendered document keeps a current 256 px longest-edge thumbnail of the existing final composite.
- Capture is idle-debounced and uses one small GPU resize/readback pass; it does not recompose layers.
- Inactive document tabs show the cached aspect-correct preview immediately on hover.
- Object URLs are replaced and revoked when documents update, close, or the workspace unmounts.
- Shader validation and app typecheck pass.
