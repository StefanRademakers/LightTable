# Workflow semantics across providers

Provider mode names are transport vocabulary. LightTable needs stable user-facing operations and input variants.

## Image operations

| Canonical operation | Required semantic inputs | OpenArt examples | Higgsfield examples | Local AI |
| --- | --- | --- | --- | --- |
| Image Create | prompt | `text2image` | image model without required media | `image.create` |
| Image Edit | base image, prompt | `image2image` | image model with image media | `image.edit` |
| Inpaint | base image, mask, prompt | only when live form has mask semantics | only when model contract confirms mask/inpaint | `image.inpaint` |
| Variation | base/reference image, intent | provider/model dependent | provider/model dependent | custom intent when supported |
| Outpaint | base image and expansion/canvas intent | provider/model dependent | dedicated outpaint models/fields | future capability |
| Remove Background | source image | provider/model dependent | dedicated remover model | editor/local facility may be preferable |
| Upscale/Enhance | source image | provider/model dependent | Topaz/Bytedance models | separate local processing may exist |

Do not label any model with image references as “Image Edit” unless its model contract actually uses those images as edit/base input rather than general visual guidance. When a model has only a general reference array, the adapter may need explicit product semantics.

## Video input variants

| Canonical variant | Meaning | Typical provider modes/roles |
| --- | --- | --- |
| Text | Generate from prompt with no required media | `text2video`, Higgsfield no medias |
| References | Media guides subjects, identity, style or composition | OpenArt `element2video`; Higgsfield `image_references`, `video_references`, `audio_references` mapped to canonical generation roles |
| Frames | Input image is a literal first frame; optional last frame | OpenArt `image2video`; Higgsfield `start_image`, `end_image` |
| Edit | Transform a source video | provider source-video/edit mode |
| Extend | Extend a source video in time | provider extension mode plus source video |

Use `References` and `Frames` in UI. Avoid using `Omni` as a generic variant name because Omni is also part of actual model names such as Kling 3 Omni and Gemini Omni Flash. Avoid unexplained `FLF` unless it is secondary technical help text.

## OpenArt mode mapping

The captured OpenArt convention is relatively consistent:

| OpenArt mode | Canonical variant |
| --- | --- |
| `text2image` | Image Create |
| `image2image` | Image Edit/reference-based image workflow; confirm exact form semantics |
| `text2video` | Video Text |
| `image2video` | Video Frames |
| `element2video` | Video References |

The live form remains authoritative for fields, required inputs and limits.

## Higgsfield media-role normalization

Catalog roles and generation roles can differ. Normalize catalog intent first, then let the connector-family adapter emit its accepted generation role.

| Catalog/raw role | Canonical purpose | Native generation role seen in StoryBuilder facade |
| --- | --- | --- |
| `image`, `image_references`, `input_images` | visual/reference image unless model rules specify otherwise | `image` |
| `start_image` | first frame | `start_image` |
| `end_image` | last frame | `end_image` |
| `video_references`, `input_video` | video reference or source video according to workflow | `video` |
| `audio_references`, `input_audio` | audio reference/source audio | `audio` |
| reusable element | character/environment/prop identity | `ref_element` or prompt element syntax only when verified |

Do not map `input_video` and `video_references` to the same semantic purpose without considering the workflow. One is often a source to edit; the other is guidance.

## Multi-reference behavior

A model is multi-reference only when the selected workflow schema confirms:

- accepted media kinds;
- reference count/slot limit;
- whether order matters;
- whether references are general or named roles;
- prompt reference syntax;
- whether mixed image/video/audio is permitted.

The model brand alone is insufficient. Kling 3, Seedance and MiniMax expose different modes with different reference semantics.

## Output kind and delivery

Output kind is part of the canonical recipe and job:

- image output enters project history before opening/placing;
- video output enters history before playback/lightbox use;
- audio output enters history before waveform/playback use;
- 3D output enters history before a viewer/import operation.

Do not infer output kind from filename alone. Validate MIME type and file signature at delivery.

## Advanced provider workflows

Higgsfield's catalog includes marketing presets, lipsync, clipping, upscaling, deflicker, background removal, LLM text and 3D utilities. These should not be squeezed into Image Create/Edit or Video References/Frames.

Represent them as explicit operations only when LightTable has:

- an understandable product entry point;
- required input slots;
- complete schema validation;
- executable submit and result transport;
- suitable result viewer/import path;
- history/recreate representation.

Catalog visibility alone is not panel parity.
