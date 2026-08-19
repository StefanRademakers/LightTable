# Dated provider catalog inventory

This file makes the captured catalogs easy for a coding agent to scan. It is not a static production registry. Runtime discovery and live schemas remain authoritative.

## OpenArt snapshot: 2026-08-11

Captured: 16 models, 41 model/mode combinations.

| Media | Model ID | Display name | Captured modes |
| --- | --- | --- | --- |
| Image | `nano-banana-2` | Nano Banana 2 | text2image, image2image |
| Image | `nano-banana-pro` | Nano Banana Pro | text2image, image2image |
| Image | `nano-banana-2-lite` | Nano Banana 2 Lite | text2image, image2image |
| Image | `gpt-image-2` | GPT Image 2 | text2image, image2image |
| Image | `byte-plus-seedream-4-5` | Seedream 4.5 | text2image, image2image |
| Image | `byte-plus-seedream-5-pro` | Seedream 5 Pro | text2image, image2image |
| Image | `byte-plus-seedream-5-lite` | Seedream 5 Lite | text2image, image2image |
| Video | `grok-imagine-1-5` | Grok Imagine 1.5 | text2video, image2video |
| Video | `gemini-omni-flash` | Gemini Omni Flash | text2video, image2video, element2video |
| Image + Video | `kling-3-omni` | Kling 3 Omni | text2image, image2image, text2video, image2video, element2video |
| Video | `byte-plus-seedance-2` | Seedance 2.0 | text2video, image2video, element2video |
| Video | `byte-plus-seedance-2-fast` | Seedance 2.0 Fast | text2video, image2video, element2video |
| Video | `byte-plus-seedance-2-mini` | Seedance 2.0 Mini | text2video, image2video, element2video |
| Video | `byte-plus-seedance-2-5` | Seedance 2.5 | text2video, image2video, element2video |
| Video | `wan2-7` | Wan 2.7 | text2video, image2video, element2video |
| Video | `pixverseV6` | PixVerse V6 | text2video, image2video |

Only two exact normalized OpenArt form samples were stored in the export. All other controls must come from live `openart_model_form_get` rather than descriptions or guessed defaults.

## Higgsfield snapshot: 2026-08-14

Captured: 86 models — 32 image, 33 video, 6 audio and 15 3D.

### Image models

| Model ID | Display name | Captured key controls | Captured media roles |
| --- | --- | --- | --- |
| `nano_banana_2` | Nano Banana 2 | resolution | image |
| `nano_banana_pro` | Nano Banana Pro | resolution | image |
| `soul_2` | Higgsfield Soul 2.0 | quality, soul_id | image, max 1 |
| `soul_v2` | Higgsfield Soul 2.0 | quality, soul_id | image, max 1 |
| `soul_cinematic` | Soul Cinema | quality, soul_id | image, max 1 |
| `gpt_image_2` | GPT Image 2 | resolution, quality | image |
| `cinematic_studio_2_5` | Cinema Studio Image 2.5 | resolution | image |
| `marketing_studio_image` | Marketing Studio Image | resolution | image |
| `ms_image` | DTC Ads | style, brand kit, resolution, quality, batch/products | image, max 14 |
| `image_auto` | Auto | schema-defined | image |
| `autosprite` | AutoSprite Animation | kind, tier, frame count/size, background, sound | image, max 1 |
| `soul_cast` | Soul Cast | budget | none captured |
| `soul_location` | Soul Location | schema-defined | none captured |
| `z_image` | Z Image | schema-defined | none captured |
| `nano_banana` | Nano Banana | schema-defined | image references |
| `nano_banana_2_shots` | Nano Banana Pro | schema-defined | image references |
| `nano_banana_2_lite` | Nano Banana 2 Lite | resolution, thinking | image references |
| `seedream_v4_5` | Seedream 4.5 | quality | image references |
| `flux_2` | FLUX.2 | resolution, variant | image references |
| `flux_2_pro_outpaint` | FLUX.2 Pro Outpaint | expansion sides, folder | image references |
| `flux_kontext` | Flux Kontext | schema-defined | image references |
| `kling_omni_image` | Kling O1 Image | resolution | image references |
| `openai_hazel` | OpenAI Hazel | quality | image references |
| `seedream_v5_lite` | Seedream 5.0 Lite | quality | image references |
| `seedream_v5_pro` | Seedream 5.0 Pro | resolution, width/height, remove background, inpaint | image references |
| `grok_image` | Grok Image | resolution, mode | image references |
| `recraft_v4_1` | Recraft V4.1 | resolution, model type, colors, background | none captured |
| `image_background_remover` | Image Background Remover | schema-defined | image references |
| `outpaint` | Outpaint | folder | image references |
| `topaz_image` | Topaz | output dimensions, face enhancement, sharpen, denoise | image references |
| `topaz_image_generative` | Topaz Generative | dimensions, creativity, texture, enhance/sharpen/denoise | image references |
| `bytedance_image_upscale` | Bytedance Image Upscale | resolution, remove background | image references |

Duplicate-looking IDs such as `soul_2` and `soul_v2` are snapshot facts. Do not collapse them without live provider confirmation.

### Video models

| Model ID | Display name | Captured key controls | Captured media roles |
| --- | --- | --- | --- |
| `cinematic_studio_3_0` | Cinema Studio Video 3.0 | resolution, genre, audio; 4–15s | image/start/end |
| `cinematic_studio_video` | Cinema Studio Video | slow motion, sound; 5/10s | image/start/end |
| `cinematic_studio_video_v2` | Cinema Studio Video | genre, mode, sound, speed ramp, shots, cfg, preset; 3–12s | image/start/end |
| `marketing_studio_video` | Marketing Studio | resolution, audio, mode, dimensions, avatars/products/assets; 12–15s | general image and image/start/end |
| `clipify` | Personal Clipper | URLs, clip count/aspect, subtitles, face crop, segment length | none captured |
| `higgsfield_preset` | Higgsfield Preset | preset | image, max 1 |
| `flux_3_video` | FLUX 3 Video | duration, resolution, audio | start/end, image/video references |
| `grok_video_v15` | Grok Video 1.5 | resolution, duration | start, image/audio references |
| `video_background_remover` | Video Background Remover | schema-defined | video references |
| `sync_so` | Sync Lipsync 3 | sync mode, folder | input video/audio |
| `minimax_hailuo` | Minimax Hailuo | variant, duration, resolution | start/end |
| `minimax_h3` | MiniMax H3 | duration, resolution, batch, folder | start/end, image/video/audio references |
| `wan2_6` | Wan 2.6 Video | quality, duration | image/video/audio references |
| `seedance1_5` | Seedance 1.5 Pro | duration, resolution, audio | start/end |
| `seedance_2_0` | Seedance 2.0 | duration, resolution, mode, bitrate, genre, audio | start/end, image/video/audio references |
| `seedance_2_0_mini` | Seedance 2.0 Mini | duration, resolution, bitrate, genre, audio | start/end, image/video/audio references |
| `seedance_2_5` | Seedance 2.5 | mode, duration, resolution, audio, bitrate, extension | start/end, image/video/audio references |
| `topaz_video` | Topaz | resolution, enhancement, interpolation | video references |
| `bytedance_video_upscale` | Bytedance Video Upscale | fps, resolution, preset, model version | video references |
| `video_upscale` | Video Upscale | duration, folder | input video |
| `video_deflicker` | Video Deflicker | duration, folder | input video |
| `kling2_6` | Kling 2.6 Video | duration, sound | start image |
| `kling3_0` | Kling v3.0 | duration, mode, sound | start/end |
| `kling3_0_turbo` | Kling 3.0 Turbo | resolution, duration | start image |
| `happy_horse_video` | Happy Horse Video | resolution, duration | start image |
| `grok_video` | Grok Video | duration | start image |
| `gemini_omni` | Gemini Omni Flash | duration, resolution | image/video references |
| `wan2_7` | Wan 2.7 | duration, resolution | start/end, audio references |
| `veo3` | Google Veo 3 | variant | start image |
| `veo3_1` | Google Veo 3.1 | duration, quality, variant | start image |
| `veo3_1_lite` | Google Veo 3.1 Lite | duration, audio | start/end |
| `sam_3_video` | Remove Background | mask, frame count | video references |
| `llm_text` | LLM Generation | model, prompts, reasoning | input images |

`llm_text` is cataloged as video in the snapshot but is semantically an LLM utility. Preserve raw data for diagnostics; do not force misleading panel placement.

### Audio models

| Model ID | Display name | Captured key controls/inputs |
| --- | --- | --- |
| `seed_audio` | Seed Audio 1.0 | format, sample rate, voice, rate/loudness/pitch; image/audio references |
| `qwen_audio_tts` | Qwen Audio 3.0 TTS Flash | voice, instruction, language, format, sample rate, volume/rate/pitch, seed, batch |
| `sonilo_music` | Sonilo Music | duration |
| `mirelo_text_to_audio` | Mirelo Text to Audio | duration |
| `inworld_text_to_speech` | Inworld Text to Speech | voice |
| `text2speech_v2` | Text to Speech V2 | variant, voice type/id |

### 3D models

| Model ID | Display name | Captured operation/controls |
| --- | --- | --- |
| `sam_3_3d` | SAM 3 3D Objects | image to object, threshold, textured GLB, seed |
| `image_to_3d` | Image to 3D | texture, rigging, animation, remesh, topology, PBR, seed |
| `meshy_image_to_3d` | Image to 3D | texture, rigging, animation, remesh, topology, PBR, seed |
| `multi_image_to_3d` | Multi-Image to 3D | multi-image plus texture/rig/remesh/topology controls |
| `meshy_multi_image_to_3d` | Multi-Image to 3D | multi-image plus texture/rig/remesh/topology controls |
| `3d_rigging` | 3D Rigging | model URL, height, animation |
| `meshy_rigging` | 3D Rigging | model URL, height, animation |
| `sam_3_3d_body` | 3D Body | image references, meshes/keypoints/MHR options |
| `tripo_3d` | Text to 3D | negative prompt, texture/PBR/quality/size/face limit |
| `tripo_h3_1_image_to_3d` | Tripo H3.1 Image to 3D | image, texture/PBR/geometry/topology/orientation |
| `tripo_h3_1_multiview_to_3d` | Tripo H3.1 Multiview to 3D | multi-image, texture/PBR/geometry/topology/orientation |
| `hunyuan3d_v3_image_to_3d` | Hunyuan3D v3 Image to 3D | image(s), PBR, face count, generate/polygon type |
| `meshy_v6_text_to_3d` | Meshy 6 Text to 3D | preview/full, topology/polycount, PBR, rigging/animation |
| `hunyuan3d_v3_1_text_to_3d` | Hunyuan 3D v3.1 Text to 3D | std/pro, PBR, generate type, face count |
| `meshy_v5_remesh` | Meshy 5 Remesh | model URL, topology, polycount, height, origin |

The captured Higgsfield tool catalog had no `generate_3d`. These models must remain catalog-only or disabled until a real callable 3D transport and result lifecycle are discovered and tested.

## Snapshot files remain richer

This summary intentionally does not duplicate every enum, default, min/max, description or conditional note. Use the complete source files listed in [SNAPSHOT_SOURCE_INDEX.json](SNAPSHOT_SOURCE_INDEX.json), then verify against the live connector before enabling submission.
