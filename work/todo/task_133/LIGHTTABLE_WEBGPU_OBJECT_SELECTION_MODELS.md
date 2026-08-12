# LightTable WebGPU Object Selection — Model Selection and Implementation Specification

## Status

- Target: commercial closed-source LightTable desktop application
- Runtime: Transformers.js / ONNX Runtime WebGPU
- Primary task: interactive object segmentation using points, negative points, boxes and iterative mask refinement
- Current implementation: SlimSAM
- Current problem: SlimSAM is fast and compact, but its mask and boundary quality are not sufficient for a Photoshop-like Object Selection Tool

## Decision summary

Replace SlimSAM as the default model with **SAM 2.1 Hiera Small**.

Provide three model profiles:

| Profile | Model | Encoder | Decoder | Purpose |
|---|---|---|---|---|
| Fast | SAM 2.1 Hiera Tiny | Q4F16 or FP16 | FP16 | Lower-end hardware and fallback |
| Balanced | **SAM 2.1 Hiera Small** | **FP16 initially** | **FP16** | Default LightTable model |
| High Quality | **SAM 2.1 Hiera Base+** | **FP16 initially** | **FP16** | Optional higher-quality download |

Keep SlimSAM temporarily as a legacy fallback behind the existing segmentation backend interface. Do not expose it as the normal default.

Test SAM 3 Tracker separately as an experimental candidate. Do not make the production implementation or saved documents dependent on SAM 3 yet.

## Goals

1. Obtain clearly better masks than the current SlimSAM implementation.
2. Keep interactive positive and negative correction clicks responsive.
3. Run locally using WebGPU without requiring a remote service.
4. Cache image embeddings so the expensive vision encoder runs only when necessary.
5. Separate model inference from LightTable's high-resolution boundary refinement.
6. Keep model selection configurable and replaceable behind the existing backend abstraction.
7. Maintain a documented license and provenance chain for every distributed model artifact.

## Non-goals

- Do not build text-prompted open-vocabulary selection in this phase.
- Do not implement video tracking in this phase.
- Do not replace the existing LightTable selection representation or GPU compositor.
- Do not assume that a raw SAM mask alone is production-quality at full document resolution.
- Do not bundle every quantization variant.

## Model assessment

| Model | Relative quality | Relative WebGPU cost | Suitability for LightTable |
|---|---:|---:|---|
| SlimSAM | Low to medium | Very low | Current fallback only |
| MobileSAM | Medium | Very low | Possible low-end fallback, but not preferred |
| EdgeSAM | Medium | Low | Interesting future lightweight comparison |
| EfficientSAM | Medium to good | Low to medium | Future benchmark candidate |
| RepViT-SAM | Good for its size | Low | Promising, but requires additional integration and license verification |
| HQ-SAM / Light HQ-SAM | Good fine-detail quality | Medium | Future refinement candidate; less direct Transformers.js route |
| SAM 1 ViT-B | Good | Medium to high | Superseded by SAM 2.1 for this application |
| SAM 2.1 Hiera Tiny | Good | Low to medium | Fast profile |
| **SAM 2.1 Hiera Small** | **Very good** | **Medium** | **Recommended default** |
| **SAM 2.1 Hiera Base+** | **Very good to high** | **Medium to high** | **Recommended HQ profile** |
| SAM 2.1 Hiera Large | High | High | Probably insufficient benefit for default desktop WebGPU usage |
| SAM 3 Tracker | Potentially high | High | Experimental benchmark pending license/provenance confirmation |

Meta reports that SAM 2 is more accurate and approximately six times faster than SAM 1 for interactive image segmentation. The official SAM 2 code and checkpoints are released under Apache 2.0.

## Initial model repositories

Use the following repositories for technical evaluation:

```text
onnx-community/sam2.1-hiera-tiny-ONNX
onnx-community/sam2.1-hiera-small-ONNX
onnx-community/sam2.1-hiera-base-plus-ONNX
onnx-community/sam3-tracker-ONNX        # experimental only
```

Treat repository names as configurable data, not hard-coded assumptions throughout the tool.

The complete Hugging Face repository sizes include multiple mutually exclusive quantization variants. LightTable must download only the selected encoder, decoder and required configuration/processor files.

Approximate FP16 payloads observed in the current repositories:

| Model | FP16 vision encoder | FP16 prompt/mask decoder | Approximate selected model payload |
|---|---:|---:|---:|
| SAM 2.1 Tiny | 67 MB | 10.5 MB | ~78 MB plus configuration |
| SAM 2.1 Small | 81.2 MB | 10.5 MB | ~92 MB plus configuration |
| SAM 2.1 Base+ | 153 MB | 10.5 MB | ~164 MB plus configuration |

These sizes must be confirmed programmatically from the pinned repository revision before release.

## Runtime architecture

Preserve or introduce a model-independent segmentation interface. The exact integration should follow the current LightTable architecture, but conceptually it must support:

```ts
type SegmentationQuality = "fast" | "balanced" | "high" | "experimental";

interface SegmentationPrompt {
  positivePoints: Array<{ x: number; y: number }>;
  negativePoints: Array<{ x: number; y: number }>;
  box?: { x0: number; y0: number; x1: number; y1: number };
  previousMask?: SegmentationMask;
}

interface SegmentationBackend {
  readonly id: string;
  readonly capabilities: {
    points: boolean;
    negativePoints: boolean;
    boxes: boolean;
    iterativeMaskInput: boolean;
  };

  load(signal?: AbortSignal): Promise<void>;
  encodeImage(source: SegmentationSource, signal?: AbortSignal): Promise<ImageEmbedding>;
  predict(embedding: ImageEmbedding, prompt: SegmentationPrompt, signal?: AbortSignal): Promise<MaskCandidates>;
  disposeEmbedding(embedding: ImageEmbedding): void;
  dispose(): void;
}
```

Adapt naming and ownership to the existing codebase rather than duplicating existing abstractions.

## Model profiles

Start with the following configuration intent:

```ts
const segmentationProfiles = {
  fast: {
    family: "sam2.1",
    variant: "hiera-tiny",
    encoderPrecision: "q4f16",
    decoderPrecision: "fp16",
  },
  balanced: {
    family: "sam2.1",
    variant: "hiera-small",
    encoderPrecision: "fp16",
    decoderPrecision: "fp16",
  },
  high: {
    family: "sam2.1",
    variant: "hiera-base-plus",
    encoderPrecision: "fp16",
    decoderPrecision: "fp16",
  },
} as const;
```

This is a starting configuration, not a mandate to duplicate this exact object.

### Precision policy

1. Establish quality and performance baselines using FP16 encoder and FP16 decoder.
2. Test a Q4F16 encoder with an FP16 decoder after the baseline works.
3. Do not select INT8 or Q4 purely from file size.
4. Keep the decoder FP16 by default because it is small and directly affects interactive mask stability.
5. Promote a quantized profile only if automated and visual tests show an acceptable quality difference.
6. Detect required WebGPU shader features and fall back safely when FP16 execution is unsupported or unstable.

Quantization regressions may appear as contour displacement, missing thin structures, holes, instability after correction clicks and reduced foreground/background discrimination.

## Embedding lifecycle and cache

The expensive vision encoder must not run on every click.

Generate or retrieve the image embedding when:

- the Object Selection Tool becomes active;
- the active source layer changes;
- the source sampling mode changes between current layer and composited image;
- source pixels affecting the sampled image change;
- the selected model profile changes;
- the model revision or preprocessing configuration changes.

Reuse the embedding when only prompts change:

- positive click;
- negative click;
- box adjustment;
- iterative refinement using the previous mask;
- switching between candidate masks from the same prediction.

The cache key must include at least:

```text
documentId
source revision / composite revision
source layer or composite identity
sampling mode
model ID
model repository revision
precision variant
processor/preprocessing version
```

Use explicit GPU and CPU resource disposal. Do not allow stale embeddings to accumulate when switching documents, layers or models.

Abort obsolete encoder and decoder work when:

- the document closes;
- the active layer changes;
- newer input supersedes an in-flight request;
- the tool is cancelled;
- the source revision changes during inference.

## Coordinate and preprocessing correctness

Most apparent model-quality problems can also be caused by incorrect coordinate conversion. Add automated coverage for:

- document coordinates to source-layer coordinates;
- transformed layers;
- crop offsets;
- zoom and device-pixel ratio independence;
- letterboxing and model resize padding;
- point and box coordinates after preprocessing;
- output-mask unpadding and rescaling;
- masks generated from the current layer versus the composited document;
- selections partially outside canvas or source-layer bounds.

Prompt coordinates must always be based on image/document geometry, never screen pixels.

## Interactive selection behavior

Required interactions:

| Interaction | Result |
|---|---|
| Click | Add positive point prompt |
| Alt/Option-click | Add negative point prompt |
| Drag box | Supply initial box prompt |
| Additional click | Refine using previous points and preferably previous mask input |
| Undo prompt | Remove latest prompt and recompute using cached embedding |
| Reset | Clear prompts and current candidate without rerunning the encoder |
| Confirm | Convert final refined mask into the normal LightTable selection representation |
| Cancel | Discard temporary mask and release temporary resources |

Show a temporary overlay while the user is refining. Do not destructively write pixels during interactive segmentation.

## Candidate-mask selection

SAM may return multiple candidate masks and confidence/IoU estimates.

- Preserve all returned candidates until the user makes another prompt or confirms.
- Default to the highest predicted quality score.
- Avoid blindly trusting the score when a previous mask exists; add stability checks where practical.
- Permit the UI to cycle candidates if the existing Object Selection UX has room for it.
- Keep candidate handling internal if exposing it would complicate the initial UI.

## High-resolution boundary refinement

A better SAM model alone is not sufficient for Photoshop-like output. SAM determines the intended object; LightTable must refine the final boundary against the original full-resolution pixels.

Implement the refinement as a separate stage after model inference:

```text
SAM mask
  -> restore to document/source coordinates
  -> identify uncertain boundary band
  -> full-resolution edge-aware refinement
  -> optional alpha/soft-edge estimation
  -> user refine brush
  -> LightTable selection mask
```

### Minimum refinement implementation

1. Upscale the model mask without introducing an arbitrary hard threshold too early.
2. Generate an uncertainty band around the mask boundary.
3. Sample original full-resolution image data inside this band.
4. Use an edge-aware method such as guided filtering or joint bilateral refinement.
5. Preserve strong, hard image edges where evidence is clear.
6. Avoid jagged stair-stepping and one-pixel holes.
7. Keep the refinement stage GPU-based where it fits the existing LightTable render architecture.
8. Keep refinement parameters independent of canvas zoom.

### Future enhancement

Hair, fur, motion blur, defocus and transparency may require alpha matting rather than binary segmentation. Design this stage so a dedicated matting/refinement model can later be introduced without replacing SAM or the selection UI.

BiRefNet/RMBG-style background-removal models are not direct replacements for promptable SAM selection. They may later serve as an automatic `Select Subject` backend or refinement assistant.

## Model download and storage

Models should be optional managed downloads rather than part of the core installer.

Requirements:

- Show model name, expected download size, quality profile and license before download.
- Pin an exact repository revision or immutable artifact version.
- Store and verify SHA-256 for every downloaded file.
- Download into a temporary file and atomically move it into the model cache only after validation.
- Resume or restart interrupted downloads safely.
- Never load an unverified partial model.
- Allow model removal through Preferences or the future model manager.
- Do not silently replace a pinned model with a newer repository revision.
- Keep documents independent of local model availability; store the resulting selection, not a live dependency on the model.

## Benchmark suite

Do not choose the final model based on a few attractive examples. Build a fixed LightTable test set containing licensed or internally created images with:

1. clearly separated opaque objects;
2. low-contrast foreground/background boundaries;
3. hair and fur;
4. leaves, branches, wires and other thin structures;
5. holes and enclosed negative spaces;
6. multiple touching or overlapping objects;
7. transparent and translucent objects;
8. motion blur and shallow depth of field;
9. textured backgrounds similar to the subject;
10. small objects in large documents;
11. transformed and partially off-canvas layers;
12. 8-bit and 16-bit document sources;
13. current-layer sampling and composited-image sampling.

For each image, define:

- initial positive point or box;
- optional negative point sequence;
- expected reference mask;
- boundary-sensitive evaluation region;
- acceptable latency and memory ranges.

## Measurements

Record at least:

- initial model download size;
- cold model initialization time;
- first image encoder time;
- subsequent decoder latency per click;
- peak GPU memory;
- peak system memory;
- mask IoU against reference;
- boundary F-score or equivalent boundary metric;
- thin-structure retention;
- stability after additional positive and negative prompts;
- visual difference between FP16 and quantized variants.

Whole-mask IoU alone is not enough: a mask can score well while still producing visibly poor hair, fingers or narrow structures. Weight boundary quality heavily for LightTable.

Benchmark at minimum:

```text
SlimSAM current implementation
SAM 2.1 Hiera Tiny FP16
SAM 2.1 Hiera Small FP16
SAM 2.1 Hiera Base+ FP16
SAM 2.1 Hiera Small Q4F16 encoder + FP16 decoder
SAM 3 Tracker candidate, if technically functional
```

## Recommended acceptance criteria

The exact numeric thresholds should be calibrated against the current test corpus, but the implementation is not complete until:

- SAM 2.1 Small visibly and measurably outperforms SlimSAM on boundary-heavy cases;
- positive and negative point correction works reliably;
- no encoder rerun occurs for prompt-only changes;
- output is invariant to canvas zoom and device-pixel ratio;
- repeated prompt updates do not leak GPU resources;
- model downloads are pinned and hash-verified;
- FP16 versus quantized quality differences are documented;
- the final mask can be committed through the existing selection pipeline;
- cancellation leaves the document unchanged;
- model absence or WebGPU failure degrades gracefully.

## License and provenance requirements

### SAM 2.1

The official Meta SAM 2 code and checkpoints are Apache 2.0. Include the Apache 2.0 license and required notices in LightTable's third-party licenses.

The community ONNX conversion still needs its own provenance record. Before production distribution, record:

- source checkpoint ID and exact revision;
- ONNX repository and exact revision;
- converter identity;
- export script or reproducible export command;
- Transformers, Optimum, PyTorch and ONNX versions;
- selected graph filenames;
- SHA-256 hashes;
- source and conversion license notices.

Prefer a reproducible internal export or an explicitly documented Hugging Face conversion over an undocumented binary artifact.

### SAM 3

SAM 3 is under Meta's custom SAM License rather than Apache 2.0. Commercial use and distribution appear permitted, but distribution carries additional conditions and the current `onnx-community/sam3-tracker-ONNX` repository does not provide sufficiently explicit license/provenance metadata for a production LightTable release.

SAM 3 must remain experimental until the following are confirmed:

1. the ONNX graphs derive from an official Meta SAM 3 checkpoint;
2. the exact source checkpoint and revision are known;
3. converted weights are distributed under the SAM License;
4. the export procedure is documented or reproducible;
5. commercial redistribution of the concrete ONNX artifacts is confirmed;
6. the complete SAM License accompanies the distributed artifacts.

Do not copy source code from the SAM3 Tracker WebGPU Space unless an explicit compatible source-code license is identified.

Suggested maintainer question:

> Hello, we are evaluating `onnx-community/sam3-tracker-ONNX` for local WebGPU inference in a commercial closed-source desktop image editor. The repository identifies `facebook/sam3` as its base model, but currently has no explicit license metadata or LICENSE file. Could you confirm the official source checkpoint and revision, that the ONNX weights were converted from that checkpoint, that the converted artifacts remain distributed under Meta's SAM License, the export tooling and versions used, and whether commercial redistribution of these concrete ONNX artifacts under the SAM License is intended? Could the repository also include the complete SAM License, explicit license metadata, and a reproducible export procedure or artifact hashes?

This section is an engineering compliance checklist, not formal legal advice.

## Implementation phases

### Phase 1 — Replace the quality baseline

- Add SAM 2.1 Hiera Small behind the existing backend interface.
- Use FP16 encoder and decoder.
- Confirm correct preprocessing, prompt coordinates and output scaling.
- Cache image embeddings.
- Support positive points, negative points, boxes and iterative masks.
- Compare visually against current SlimSAM.

### Phase 2 — Benchmark profiles

- Add Tiny and Base+ profiles.
- Add repeatable performance and mask-quality capture.
- Test Small Q4F16 encoder with FP16 decoder.
- Choose default and fallback thresholds from measurements.

### Phase 3 — Boundary refinement

- Implement full-resolution uncertainty-band extraction.
- Add edge-aware GPU refinement.
- Measure boundary accuracy separately from whole-mask IoU.
- Integrate the result into the existing selection mask pipeline.

### Phase 4 — Productization

- Add managed model downloads.
- Pin repository revisions and file hashes.
- Add Preferences UI for Fast, Balanced and High Quality.
- Add failure fallback and resource cleanup.
- Complete third-party license and provenance records.

### Phase 5 — Experimental SAM 3 comparison

- Resolve license/provenance questions.
- Run the same fixed benchmark suite.
- Compare quality improvement against model size, initialization time, encoder time and memory.
- Promote SAM 3 only if it materially improves LightTable's real selection cases.

## Final recommendation

The intended production direction is:

```text
Default:       SAM 2.1 Hiera Small FP16
High Quality:  SAM 2.1 Hiera Base+ FP16
Fast fallback: SAM 2.1 Hiera Tiny, quantized only after validation
Legacy:        SlimSAM, temporarily retained internally
Experimental:  SAM 3 Tracker
```

The coding agent should inspect and reuse the current LightTable selection, worker, model-loading, GPU-resource and undo architecture. The model choice must remain replaceable. The most important quality improvement will come from combining a stronger SAM 2.1 model with correct prompt handling, embedding reuse and a LightTable-owned full-resolution boundary-refinement stage.

## References

- SAM 2 paper: <https://arxiv.org/html/2408.00714v1>
- Official SAM 2 repository and Apache 2.0 license: <https://github.com/facebookresearch/sam2>
- Transformers.js documentation: <https://huggingface.co/docs/transformers.js/index>
- Transformers.js SAM 2/SAM 3 tracker support: <https://github.com/huggingface/transformers.js/releases>
- SAM 2.1 Tiny ONNX files: <https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/tree/main/onnx>
- SAM 2.1 Small ONNX files: <https://huggingface.co/onnx-community/sam2.1-hiera-small-ONNX/tree/main/onnx>
- SAM 2.1 Base+ ONNX files: <https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/tree/main/onnx>
- Official SAM 3 license: <https://github.com/facebookresearch/sam3/blob/main/LICENSE>
- SAM 3 Tracker ONNX repository: <https://huggingface.co/onnx-community/sam3-tracker-ONNX>
- SAM 3 Tracker WebGPU Space: <https://huggingface.co/spaces/webml-community/SAM3-Tracker-WebGPU>
- SlimSAM paper: <https://arxiv.org/abs/2312.05284>
- EdgeSAM paper: <https://arxiv.org/html/2312.06660v2>
- EfficientSAM paper: <https://arxiv.org/abs/2312.00863>
- HQ-SAM paper: <https://arxiv.org/abs/2306.01567>
