# Lighttable Healing Brush — Improvement Plan

## Status / Problem

The current Healing Brush implementation is functional, but the result is not yet Photoshop-class. On small defects such as red skin blemishes, Photoshop often produces a convincing correction in one dab/stroke, while Lighttable currently needs substantially more brushing.

The next iteration should therefore focus on the **healing algorithm**, not on rebuilding the brush engine.

## Primary Goal

Keep the existing **100% GPU/WebGPU brush pipeline**, source sampling, stroke handling and brush UX, but replace/improve the current healing stage so that sampled detail adapts much more naturally to the destination's local tone, illumination and surrounding pixels.

The implementation should remain interactive and GPU-native.

---

## Important Research Finding

Photoshop's Healing Brush should not be treated as simply:

```text
source high-frequency detail
+
destination low-frequency color
```

The original Adobe research describes Healing as a **seamless cloning / gradient-domain problem**. Todor Georgiev's paper describes an iterative solution based on a **fourth-order PDE (biharmonic-style reconstruction)**. A key goal is not only continuity of the healed region at its boundary, but also continuity of derivatives, allowing the pasted structure to adapt smoothly to the destination.

This is likely an important reason Photoshop performs much better on small localized defects than a straightforward frequency-separation implementation.

The surrounding destination pixels and especially the **boundary around the painted region are therefore important inputs to the heal**, rather than the operation being purely a per-pixel source/destination blend.

---

## Research References

### Original Adobe / Georgiev Healing Brush paper

**Todor Georgiev — “Photoshop Healing Brush: a Tool for Seamless Cloning” (Adobe Systems, 2004)**

ResearchGate:
https://www.researchgate.net/publication/250700643_Photoshop_Healing_Brush_a_Tool_for_Seamless_Cloning

PDF mirror:
https://ftp.funet.fi/pub/mirrors/ftp.gimp.org/pub/references/Photoshop_Healing_Brush_a_Tool_for_Seamless_Clonin.pdf

This should be the main technical reference for the improvement work.

Key concepts to investigate from the paper:

- seamless cloning rather than direct cloning;
- spatial variations from the sampled source;
- destination boundary constraints;
- continuity at the boundary;
- continuity of derivatives at the boundary;
- fourth-order PDE / biharmonic reconstruction;
- iterative numerical solution suitable for GPU compute;
- multiplicative / illumination-aware formulation discussed by Georgiev.

### Adobe Healing Brush documentation

https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/healing-brush-tool.html

Adobe describes Healing Brush as blending sampled pixels with the surrounding **texture, lighting and tone**.

Adobe also exposes a **Diffusion** control:

- lower diffusion → detailed textures / edges;
- higher diffusion → smooth or gradient-like areas.

This is important behavior to reproduce conceptually in Lighttable.

### Adobe Healing examples / Diffusion

https://helpx.adobe.com/photoshop/using/healing-examples.html

Useful as a behavioral reference for how increasing diffusion changes adaptation of the pasted region to its surroundings.

### Gradient-domain / Poisson background

MIT Computational Photography notes:

https://people.csail.mit.edu/fredo/comp-photo-book/05-edges-matter-01-poisson-image-editing.html

Useful background on gradient-domain cloning, boundary correction and the relationship between Poisson-style editing and Georgiev's Healing Brush formulation.

### GIMP implementation reference

https://developer.gimp.org/core/algorithm/healing/

GIMP explicitly references Georgiev's paper for its Heal implementation. It can be useful as an additional implementation reference, but should **not automatically be copied** or assumed to match Photoshop exactly.

---

## Step 1 — Audit the Current Lighttable Implementation

Before changing architecture, inspect the current Healing Brush implementation and document exactly what it does.

In particular determine whether it currently uses:

- frequency separation;
- local blur / low-frequency transfer;
- direct source/destination blending;
- per-dab processing;
- stroke-level processing;
- destination neighborhood sampling;
- boundary conditions;
- iterative processing;
- source or destination snapshots.

Also inspect the existing normal Brush and Clone Stamp implementations again. The working Clone Stamp implementation should remain the foundation for source-coordinate tracking and source sampling.

Do not duplicate brush infrastructure unnecessarily.

---

## Step 2 — Separate Brush Mechanics from Healing

The shared pipeline should remain approximately:

```text
Existing Brush Engine
        │
        ├── size / hardness
        ├── spacing
        ├── opacity / flow
        ├── pressure
        ├── stroke geometry
        └── brush mask
                │
                ▼
        Clone-style Source Sampling
                │
                ▼
           Healing Stage
                │
                ▼
          Layer Composite
```

Clone Stamp and Healing Brush should continue sharing source-position and brush infrastructure.

The major difference should be:

```text
Clone Stamp  -> direct sampled pixels
Healing      -> sampled pixels + destination-aware healing solve
```

---

## Step 3 — Prototype a Gradient-Domain Healing Path

Investigate a GPU implementation inspired by Georgiev's method rather than relying only on frequency separation.

Conceptually:

```text
Source Patch
     +
Destination Patch
     +
Healing Mask / Stroke Region
     +
Destination Boundary
     │
     ▼
Gradient / spatial variation representation
     │
     ▼
GPU iterative healing solver
     │
     ▼
Seamlessly adapted patch
     │
     ▼
Composite into target layer
```

The exact mathematical implementation should be selected after studying the paper and testing alternatives. Do not prematurely hard-code one interpretation if a simpler mathematically equivalent formulation produces the same visual quality much faster on WebGPU.

---

## Step 4 — Treat the Painted Region as a Patch

Avoid solving each brush dab independently if that creates visible accumulation or weak adaptation.

Prefer reasoning about the affected stroke/region as a coherent patch:

```text
Stroke / dab region
        ↓
Determine affected bounds
        ↓
Expand bounds with surrounding destination margin
        ↓
Collect source + destination + mask
        ↓
GPU heal solve
        ↓
Composite result
```

For a small blemish the affected GPU working region should therefore remain very small.

The implementation should exploit this aggressively for performance rather than processing the complete document.

---

## Step 5 — Boundary-Aware Healing

The destination pixels surrounding the painted area should participate in the solve.

This is particularly important for cases such as:

- skin blemishes;
- small discolorations;
- dust spots;
- scratches;
- subtle gradients;
- areas with changing illumination.

The desired behavior is that source **detail/structure** is transferred while the healed region naturally inherits the destination's broader appearance.

A useful mental model is:

```text
SOURCE
local texture / structure
        │
        ▼
   healing solver  ◄──── destination surroundings
        │                 + boundary behavior
        ▼
source detail adapted to destination
```

Do not simply average the destination surroundings into the brush; they should constrain/adapt the reconstruction.

---

## Step 6 — Diffusion

Add or prepare a Photoshop-like **Diffusion** parameter.

Behavioral target:

```text
Low diffusion
→ preserve fine detail / grain
→ less spreading of adaptation
→ useful near detailed structures and edges

High diffusion
→ stronger/smoother adaptation
→ useful for skin and smooth gradients
```

The coding agent should determine how this maps most naturally onto the chosen GPU solver: iteration behavior, scale, propagation radius, solver parameters, or another mathematically appropriate control.

Do not implement Diffusion as an arbitrary blur slider merely to imitate the UI.

---

## Step 7 — WebGPU Performance Strategy

The final implementation must remain **100% GPU based** for image processing.

Prefer:

- compute shaders;
- small region-of-interest textures;
- ping-pong textures for iterative solves;
- reusable temporary GPU resources;
- dispatch limited to affected bounds;
- no CPU pixel readback;
- no full-document healing pass;
- no CPU image-processing fallback.

A 64×64, 128×128 or similarly small healing region can afford substantially more sophisticated processing than a full-resolution image operation.

Do not optimize iteration count prematurely. First establish the quality level required to approach Photoshop, then profile and reduce cost intelligently.

---

## Step 8 — Interactive Strategy

Investigate whether the best UX is:

1. lightweight approximate healing while the pointer is moving;
2. higher-quality solve when the stroke/dab settles or mouse/pointer is released;

or whether the optimized WebGPU solver is already fast enough to run continuously.

The user should never experience a visible delayed correction under normal retouching conditions.

---

## Quality Test Case

Use small skin blemishes as one of the primary regression tests.

Expected workflow:

```text
Alt/Option sample clean nearby skin
        ↓
brush slightly larger than blemish
        ↓
one dab / short stroke
        ↓
blemish disappears
        ↓
skin texture remains believable
        ↓
local skin tone and illumination remain continuous
```

A result that requires repeatedly painting the same blemish should be considered insufficient unless Photoshop behaves similarly on the same source/destination pair.

Also test:

- smooth skin;
- skin with visible pores;
- gradients;
- high-frequency texture;
- near edges;
- source and destination with different brightness;
- source and destination with slightly different color;
- long strokes;
- soft and hard brush boundaries.

---

## Comparison Harness

Create a small visual regression set where identical:

- source point;
- destination point;
- brush radius;
- hardness;
- stroke path;

are tested in Photoshop and Lighttable.

The goal is not necessarily pixel parity, but behavioral parity:

- defect removal strength;
- texture preservation;
- color adaptation;
- luminance adaptation;
- edge quality;
- absence of halos;
- absence of repeated-brushing requirement.

This will be more useful than tuning the algorithm by subjective feel alone.

---

## Important Architectural Constraint

Do **not** rewrite the successful Clone Stamp or normal brush engine to implement this.

The desired architecture is roughly:

```text
                    Shared GPU Brush Engine
                           │
                  Shared Source Sampling
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Clone Stamp                 Healing Brush
             │                           │
      direct texture                destination-aware
         sampling                    healing solver
             │                           │
             └─────────────┬─────────────┘
                           │
                     GPU Composite
```

Healing should become a specialized processing stage on top of infrastructure that already works.

---

## Implementation Priority

1. Analyze current Lighttable Heal implementation.
2. Read Georgiev's Healing Brush paper carefully.
3. Establish a Photoshop comparison test using small blemish removal.
4. Prototype destination-boundary-aware gradient-domain healing in WebGPU.
5. Compare against the current implementation and Photoshop.
6. Determine the minimum solver complexity required for Photoshop-class results.
7. Add meaningful Diffusion control.
8. Optimize ROI allocation, iterations and compute dispatch.
9. Integrate cleanly into the existing shared brush architecture.

## Definition of Done

The improvement is successful when a typical small skin blemish or similarly localized defect can usually be removed with **one appropriately sized dab or short stroke**, while retaining believable source texture and adapting naturally to the destination's color, illumination and surrounding structure.

Performance must remain interactive and the image-processing path must remain GPU/WebGPU based.
