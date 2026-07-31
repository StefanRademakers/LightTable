# Archived Lighttable — WebGPU Auto Align Layers

## Doel

Bouw een werkende **Auto Align Layers** feature voor Lighttable die direct aansluit op de bestaande layer stack en WebGPU-pipeline.

De feature moet bestaande image layers geometrisch op elkaar uitlijnen zonder pixels destructief te wijzigen.

Eerste bruikbare scope:

- één locked reference layer;
- één target layer;
- source-pixel analyse;
- grading volledig negeren;
- non-destructieve transform-update;
- WebGPU-first;
- translation als eerste model;
- daarna similarity en affine;
- confidence scoring;
- overlay/difference preview vóór commit.

Primair bedoeld voor:

- bijna identieke beelden;
- AI-return images met kleine offsets;
- exposure- of kleurverschillen;
- lokale edits;
- focus stacks;
- bracketed shots;
- handmatig verschoven duplicaten.

Panorama stitching en zware perspective matching vallen buiten de eerste milestone.

---

## 1. Kernprincipes

### 1.1 De reference layer beweegt nooit

De gebruiker kiest één layer als reference.

Deze layer:

- moet locked zijn, of tijdens de align session immutable worden behandeld;
- mag tijdens analyse, preview en commit nooit veranderen;
- behoudt exact zijn huidige document transform;
- vormt de vaste coordinate-space waar targets naar toe worden gematcht.

Alleen de target layer krijgt een correction transform.

```ts
interface AutoAlignRequest {
  referenceLayerId: LayerId;
  targetLayerIds: LayerId[];
}
```

Als exact één geselecteerde layer locked is, gebruik die automatisch als reference.

Als meerdere layers locked zijn, laat de gebruiker kiezen.

Als geen enkele layer locked is, laat de gebruiker kiezen en behandel die layer gedurende de session als immutable.

---

### 1.2 Geen destructieve pixelbewerking

Auto Align schrijft nooit terug naar source pixels.

De feature retourneert alleen een transform correction:

```ts
interface AlignmentResult {
  model: "translation" | "similarity" | "affine";
  correctionMatrix: Mat3;
  confidence: number;
  overlap: number;
  residualError: number;
  diagnostics: AlignmentDiagnostics;
}
```

De uiteindelijke target transform wordt non-destructief samengesteld:

```ts
correctedTargetMatrix =
  correctionMatrix * currentTargetMatrix;
```

De exacte matrixvolgorde moet aansluiten op de bestaande Lighttable conventions en expliciet getest worden.

---

### 1.3 Analyseer source pixels, niet de graded output

Auto Align mag niet analyseren op:

- exposure;
- contrast;
- curves;
- LUT;
- color balance;
- per-layer adjustments;
- opacity;
- blend mode;
- masks die alleen voor grading bestaan;
- composited output;
- display transform;
- tone mapping.

Gebruik de originele source texture plus relevante geometry.

Voorkeursbron:

```ts
layer.sourceTexture
```

Niet:

```ts
layer.renderTexture
layer.compositedTexture
```

---

### 1.4 Geometry die wel meegenomen moet worden

De analysis path moet rekening houden met:

- source orientation;
- EXIF rotation indien van toepassing;
- crop;
- flip;
- bestaande translation;
- bestaande rotation;
- bestaande scale;
- anchor/origin;
- document placement.

Reference en target worden eerst naar één gedeelde analysis/document space geprojecteerd.

---

## 2. Verwachte aansluiting op de layer stack

Minimaal aannemelijk model:

```ts
interface Layer {
  id: LayerId;
  type: string;
  source: LayerSource;
  transform: LayerTransform;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  revision: number;
}
```

Image source:

```ts
interface ImageLayerSource {
  texture: GPUTexture;
  width: number;
  height: number;
  sourceRevision: number;
}
```

Auto Align mag niet afhankelijk zijn van opacity, blend mode of grading controls.

---

## 3. Milestones

### Milestone 1 — Translation-only GPU prototype

Ondersteun:

- één locked reference;
- één target;
- source-pixel analyse;
- grayscale;
- gradient-domain error;
- downsample;
- image pyramid;
- translation search;
- overlap mask;
- confidence score;
- preview;
- apply/cancel;
- undo.

Nog niet ondersteunen:

- rotation;
- scale;
- affine;
- homography;
- panoramas;
- multi-layer batch;
- ORB/SIFT/XFeat;
- RANSAC.

Doel:

> Bewijzen dat Lighttable twee echte layers uit de layer stack correct kan analyseren en een betrouwbare translation correction kan vinden en toepassen.

---

### Milestone 2 — Similarity

Toevoegen:

- translation;
- rotation;
- uniform scale.

Gebruik coarse-to-fine refinement.

Geen volledige brute-force 4D search.

---

### Milestone 3 — Affine

Toevoegen:

- non-uniform scale;
- beperkte shear;
- rotation;
- translation.

Affine alleen kiezen wanneer similarity aantoonbaar onvoldoende is.

---

### Milestone 4 — Multi-layer alignment

Toevoegen:

- één locked reference;
- meerdere targets;
- targets onafhankelijk matchen;
- gezamenlijke preview;
- één undoable transaction.

---

## 4. UI en gebruikersflow

Voorgestelde entry:

```text
Layer context menu
→ Auto Align Layers…
```

of:

```text
Edit
→ Auto Align Selected Layers…
```

Dialoog:

```text
Reference:
[ Layer A 🔒 ]

Targets:
[x] Layer B
[x] Layer C

Alignment mode:
[ Auto ]
[ Translation ]
[ Translation + Rotation + Scale ]
[ Affine ]

Analysis:
[x] Ignore color adjustments
[x] Use gradient matching
[x] Exclude transparent pixels

Preview:
[ Overlay ]
[ Difference ]
[ Flicker ]
```

---

## 5. Alignment session

Gebruik een tijdelijke preview session.

```ts
interface AlignmentSession {
  referenceLayerId: LayerId;
  targetLayerIds: LayerId[];
  originalTransforms: Map<LayerId, Mat3>;
  previewTransforms: Map<LayerId, Mat3>;
  results: Map<LayerId, AlignmentResult>;
}
```

Gedrag:

- documentmodel wordt pas bij Apply definitief aangepast;
- Cancel herstelt exact de originele transforms;
- preview mode wisselen triggert geen nieuwe analyse;
- Apply is één undoable transaction.

---

## 6. Modules

```text
AutoAlignController
├── AlignmentSession
├── AlignmentAnalysisService
├── AlignmentSearchPipeline
├── AlignmentModelSelector
├── AlignmentConfidenceEvaluator
├── AlignmentPreviewController
└── AlignmentCache
```

### AutoAlignController

Verantwoordelijk voor:

- selectie valideren;
- reference bepalen;
- session starten;
- pipeline aanroepen;
- preview;
- apply/cancel;
- undo transaction.

### AlignmentAnalysisService

Verantwoordelijk voor:

- source texture ophalen;
- geometry meenemen;
- analysis bounds bepalen;
- grayscale genereren;
- gradient genereren;
- validity mask;
- image pyramid;
- caching.

### AlignmentSearchPipeline

Verantwoordelijk voor:

- candidate generation;
- GPU scoring;
- reduction;
- coarse-to-fine refinement;
- model-specifieke search.

---

## 7. Coordinate spaces

Gebruik expliciete namen:

```text
source pixel space
layer local space
document space
analysis pixel space
preview/render space
```

Voor iedere layer:

```ts
sourceToDocument =
  documentPlacement
  * userTransform
  * cropTransform
  * sourceOrientation;
```

Voor analyse:

```ts
sourceToAnalysis =
  documentToAnalysis
  * sourceToDocument;
```

Correctie:

```ts
correctedTargetToDocument =
  correctionInDocumentSpace
  * currentTargetToDocument;
```

Bewaar de authoritative correction als matrix.

Decompose alleen bij commit als het layer model dat vereist.

---

## 8. Analysis bounds

Bepaal bounds in document space:

```ts
referenceBounds = transformBounds(
  reference.sourceBounds,
  reference.sourceToDocument
);

targetBounds = transformBounds(
  target.sourceBounds,
  target.sourceToDocument
);
```

Analysegebied:

```ts
analysisBounds =
  intersect(
    expand(referenceBounds, searchMargin),
    expand(targetBounds, searchMargin)
  );
```

Als de mogelijke overlap te klein is:

- stop vroeg;
- pas niets toe;
- toon duidelijke foutmelding.

---

## 9. GPU analysis pipeline

### Pass A — Reproject naar analysis space

Shader:

- sample source texture;
- pas geometry toe;
- projecteer naar gedeelde analysis space;
- markeer buiten-bounds pixels invalid;
- pas geen grading toe.

Output:

```text
r16float luminance
r8uint validity mask
```

---

### Pass B — Luminance

```wgsl
fn luminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}
```

---

### Pass C — Lokale normalisatie

Aanbevolen:

```text
normalized =
  (luminance - localMean)
  / max(localStdDev, epsilon)
```

Voor prototype mag eenvoudiger:

- subtract blurred luminance;
- divide door lokale contrastmaat;
- clamp extremen.

Doel:

- exposureverschillen onderdrukken;
- globale brightness mismatch negeren;
- vignetting deels reduceren.

---

### Pass D — Gradient map

Gebruik centrale verschillen of Sobel.

```wgsl
gx = right - left;
gy = bottom - top;
magnitude = sqrt(gx * gx + gy * gy);
```

Gradient-domain matching is standaard voor de eerste versie.

---

### Pass E — Validity mask

Pixel is geldig wanneer:

- source sample binnen bounds ligt;
- alpha boven threshold ligt;
- crop pixel niet uitsluit;
- optionele exclude mask pixel niet uitsluit.

Alleen pixels die bij reference én target geldig zijn tellen mee.

---

### Pass F — Image pyramid

Start bijvoorbeeld met:

```text
256
128
64
```

Search begint op kleinste level en refine't omhoog.

Cache per layer en source/geometry revision.

---

## 10. Translation search op GPU

### Candidate grid

```ts
interface TranslationCandidate {
  dx: number;
  dy: number;
}
```

Bijvoorbeeld:

```text
dx = -32 ... +32
dy = -32 ... +32
```

4225 candidates kunnen parallel gescoord worden.

### Candidate score

Per candidate:

1. sample reference;
2. sample target op offsetpositie;
3. check validity;
4. bereken robuuste fout;
5. tel valid pixels;
6. schrijf error sum en overlap.

Aanbevolen loss:

```wgsl
fn robustLoss(delta: f32) -> f32 {
  return min(abs(delta), 0.15);
}
```

Of Huber loss.

### Compute layout

```text
1 workgroup per candidate
N threads per workgroup
iedere thread verwerkt meerdere pixels
workgroup reduction
1 score per candidate
```

Output:

```ts
struct CandidateScore {
  errorSum: f32;
  validCount: u32;
}
```

Alleen compacte scoredata naar CPU lezen.

Nooit volledige textures teruglezen.

---

## 11. Coarse-to-fine

Voorbeeld:

```text
Level 64:
  search ±32 px
  step 2

Level 128:
  zoek rond beste candidate
  radius 4
  step 1

Level 256:
  zoek rond beste candidate
  radius 2
  subpixel refinement
```

Offsets correct schalen tussen pyramid levels.

---

## 12. Subpixel refinement

Na beste integer offset:

- score links/midden/rechts;
- fit parabool voor X;
- score boven/midden/onder;
- fit parabool voor Y.

Alternatief:

```text
±1.0
±0.5
±0.25
```

---

## 13. Similarity search

Similarity bevat:

- translation;
- rotation;
- uniform scale.

Strategie:

1. vind translation;
2. gebruik als startpunt;
3. test beperkte rotation;
4. test beperkte scale;
5. refine translation opnieuw;
6. herhaal op hoger pyramid level.

Defaults:

```text
rotation: ±3°
scale: 0.97–1.03
```

Candidate:

```ts
interface SimilarityCandidate {
  dx: number;
  dy: number;
  rotation: number;
  scale: number;
}
```

Search schedule:

```text
Stage 1:
  rotation step 0.5°
  scale step 0.01

Stage 2:
  rotation step 0.15°
  scale step 0.003

Stage 3:
  rotation step 0.05°
  scale step 0.001
```

Alleen lokaal rond huidige beste kandidaat zoeken.

---

## 14. Affine

Pas bouwen nadat translation en similarity stabiel zijn.

Niet alle zes affine parameters brute-forcen.

Aanpak:

- begin vanuit similarity result;
- gebruik iterative optimization of feature correspondences;
- beperk shear;
- beperk non-uniform scale;
- reject onrealistische matrices.

Constraints:

```text
scale X/Y: 0.9–1.1
shear: beperkt
determinant: positief
geen extreme perspective
```

---

## 15. Confidence scoring

Diagnostics:

```ts
interface AlignmentDiagnostics {
  bestError: number;
  secondBestError: number;
  overlap: number;
  improvementFromIdentity: number;
  peakSharpness: number;
  transformMagnitude: number;
  validPixelCount: number;
}
```

Belangrijke signalen:

```text
improvement =
  1 - bestError / identityError
```

```text
separation =
  1 - bestError / secondBestError
```

Voorlopige formule:

```ts
confidence =
  clamp(
    improvement * 0.45 +
    separation * 0.25 +
    overlapScore * 0.20 +
    peakSharpness * 0.10,
    0,
    1
  );
```

Resultaatbeleid:

```text
confidence ≥ 0.80
→ bruikbaar

0.55–0.80
→ preview met waarschuwing

< 0.55
→ niet automatisch toepassen
```

---

## 16. Preview modes

### Overlay

```text
reference: 100%
target: 50%
```

### Difference

```text
abs(reference - transformedTarget)
```

### Flicker

Wissel reference en target op 2–4 Hz.

### Edge difference

Vergelijk gradient maps in plaats van RGB.

---

## 17. Caching

Cache key:

```ts
interface AlignmentCacheKey {
  layerId: LayerId;
  sourceRevision: number;
  geometryRevision: number;
  analysisVersion: number;
  pyramidConfigHash: string;
}
```

Niet invalidaten bij:

- exposure;
- contrast;
- LUT;
- curves;
- color wheels;
- blend mode;
- opacity.

Wel invalidaten bij:

- source replacement;
- crop;
- flip;
- source orientation;
- destructive raster edit;
- gewijzigde dimensions;
- geometry die de analysis input beïnvloedt.

---

## 18. GPU resource lifecycle

Gebruik tijdelijke scope:

```ts
class AlignmentGpuScope {
  createTexture(...): GPUTexture;
  createBuffer(...): GPUBuffer;
  destroy(): void;
}
```

Bij apply/cancel:

- tijdelijke buffers destroyen;
- niet-gecachete textures destroyen;
- mapped buffers unmap;
- preview resources vrijgeven.

---

## 19. Async en cancellation

Pipeline:

```ts
await analysisService.prepare(...);
await searchPipeline.findTranslation(...);
await previewController.update(...);
```

Gebruik:

- kleine readbacks;
- AbortSignal;
- progress callbacks;
- geen blocking CPU loops.

```ts
interface AlignmentProgress {
  phase:
    | "prepare"
    | "pyramid"
    | "translation"
    | "similarity"
    | "affine"
    | "confidence"
    | "preview";
  progress: number;
}
```

---

## 20. Undo en transactie

Apply:

```ts
document.transaction("Auto Align Layers", () => {
  for (const [layerId, transform] of session.previewTransforms) {
    document.layers.updateTransform(layerId, transform);
  }
});
```

Cancel schrijft niets naar history.

Undo herstelt exact de originele matrices.

---

## 21. AI-return preset

```ts
const AI_RETURN_PRESET: AlignmentOptions = {
  model: "similarity",
  maxTranslationPx: 128,
  maxRotationDeg: 3,
  minScale: 0.96,
  maxScale: 1.04,
  useGradientDomain: true,
  useLocalNormalization: true,
  robustLoss: "huber",
  excludeEditedRegions: true,
};
```

Eigenschappen:

- translation + similarity;
- beperkte rotation;
- beperkte scale;
- gradient-domain default;
- robust loss;
- optionele exclude mask;
- tolerant voor lokale edits.

---

## 22. Exclude mask

Als Lighttable beschikt over:

- selection mask;
- AI edit mask;
- inpainting mask;
- generated-region mask;

gebruik die optioneel als exclude mask.

```text
analysis validity =
  source validity
  AND NOT exclude mask
```

API:

```ts
interface AlignmentOptions {
  excludeMask?: AlignmentMaskSource;
}
```

---

## 23. Geen Canvas2D fallback in productie

Als WebGPU niet beschikbaar is:

- feature disabled;
- toon duidelijke melding;
- behoud eventueel alleen een CPU reference implementation voor tests.

De productiefeature blijft WebGPU-first.

---

## 24. Tests

### Unit tests

Test:

- matrix composition;
- transform direction;
- analysis bounds;
- pyramid scaling;
- candidate mapping;
- confidence;
- cache invalidation;
- undo restoration.

### Synthetic tests

Gebruik:

- checkerboard;
- tekst;
- lijnen;
- cirkels;
- noise;
- hoge en lage frequenties.

Bekende transforms:

```text
translation:
±1 px
±10 px
±64 px

rotation:
±0.1°
±1°
±3°

scale:
0.98
1.00
1.02
```

Doelen:

```text
translation error < 0.75 px
rotation error < 0.1°
scale error < 0.0015
```

### Photographic tests

Minimaal:

1. vrijwel identieke foto;
2. exposureverschil;
3. white-balanceverschil;
4. lokale retouche;
5. AI replacement region;
6. transparante randen;
7. verschillende crops;
8. weinig overlap;
9. repetitieve patronen;
10. motion blur;
11. low-texture image;
12. grote vlakke gebieden.

### Negative tests

Correct falen bij:

- geen overlap;
- volledig andere images;
- alleen vlakke kleur;
- extreme crop;
- target zonder geldige pixels;
- alignment geannuleerd tijdens dispatch.

Geen enkele failure mag de target transform wijzigen.

---

## 25. Debug tooling

Development-only panel:

- reference luminance;
- target luminance;
- gradient maps;
- validity masks;
- analysis bounds;
- pyramid levels;
- score heatmap;
- beste candidate;
- tweede beste candidate;
- overlap;
- residual difference.

Een score heatmap is essentieel voor ambiguïteit en transform-direction bugs.

---

## 26. Performance targets

Translation:

```text
analysis size: 256–512 px
translation search: < 100 ms gewenst
totale preview latency: < 250 ms gewenst
```

Similarity:

```text
totale latency: < 500 ms gewenst
```

Correctheid gaat vóór optimalisatie.

---

## 27. Implementatievolgorde

### Stap 1 — Layer stack integratie

- reference en targets ophalen;
- source textures resolven;
- geometry matrices ophalen;
- revisions ophalen;
- session opzetten.

### Stap 2 — Shared analysis space

- document-space bounds;
- overlap bounds;
- document-to-analysis matrix;
- reproject shader;
- validity mask.

### Stap 3 — Analysis textures

- luminance;
- local normalization;
- gradient;
- pyramid.

### Stap 4 — Translation scoring

- candidate buffer;
- compute shader;
- workgroup reduction;
- compacte readback;
- beste candidate.

### Stap 5 — Preview transform

- correction matrix;
- preview-only override;
- overlay;
- difference.

### Stap 6 — Confidence

- identity score;
- second-best;
- overlap;
- safe rejection.

### Stap 7 — Apply/cancel/undo

- transaction;
- restore;
- cleanup.

### Stap 8 — Similarity

- beperkte rotation/scale;
- staged refinement;
- model selection.

### Stap 9 — Multi-layer

- targets itereren;
- shared reference cache;
- batch apply.

---

## 28. Suggested file structure

```text
src/editor/auto-align/
  AutoAlignController.ts
  AlignmentSession.ts
  AlignmentTypes.ts
  AlignmentAnalysisService.ts
  AlignmentCache.ts
  AlignmentSearchPipeline.ts
  AlignmentModelSelector.ts
  AlignmentConfidenceEvaluator.ts
  AlignmentPreviewController.ts
  AlignmentGpuScope.ts

src/editor/auto-align/gpu/
  alignment-preprocess.wgsl
  alignment-downsample.wgsl
  alignment-gradient.wgsl
  alignment-score-translation.wgsl
  alignment-score-similarity.wgsl
  alignment-score-reduce.wgsl
  alignment-difference-preview.wgsl

src/editor/auto-align/tests/
  AlignmentMatrix.test.ts
  AlignmentBounds.test.ts
  AlignmentSyntheticTranslation.test.ts
  AlignmentConfidence.test.ts
  AlignmentCache.test.ts
```

---

## 29. TypeScript API

```ts
export interface AutoAlignOptions {
  model: "auto" | "translation" | "similarity" | "affine";

  maxTranslationPx: number;
  maxRotationDeg: number;
  minScale: number;
  maxScale: number;

  useGradientDomain: boolean;
  useLocalNormalization: boolean;
  ignoreColorAdjustments: true;

  minimumOverlap: number;
  minimumConfidence: number;

  excludeMask?: AlignmentMaskSource;
  generateDebugOutput?: boolean;
}
```

```ts
export interface AutoAlignResult {
  referenceLayerId: LayerId;
  targetLayerId: LayerId;

  model: "translation" | "similarity" | "affine";
  correctionMatrix: Mat3;
  previewTransform: Mat3;

  confidence: number;
  overlap: number;
  residualError: number;

  diagnostics: AlignmentDiagnostics;
}
```

```ts
export interface AutoAlignService {
  align(
    referenceLayerId: LayerId,
    targetLayerId: LayerId,
    options: AutoAlignOptions,
    signal?: AbortSignal
  ): Promise<AutoAlignResult>;
}
```

---

## 30. Definition of Done — Milestone 1

- [ ] Twee echte image layers uit de Lighttable layer stack worden gebruikt.
- [ ] Eén locked reference blijft volledig onveranderd.
- [ ] Alleen de target beweegt.
- [ ] Grading en compositing worden volledig genegeerd.
- [ ] Source textures worden rechtstreeks op GPU geanalyseerd.
- [ ] Beide layers komen in één gedeelde analysis space.
- [ ] Validity mask sluit transparante en buiten-bounds pixels uit.
- [ ] Image pyramid wordt gebruikt.
- [ ] Translation candidates worden parallel op WebGPU gescoord.
- [ ] Alleen compacte scoredata wordt naar CPU gelezen.
- [ ] Translation wordt binnen 0.75 px teruggevonden.
- [ ] Resultaat wordt als tijdelijke transform gepreviewd.
- [ ] Overlay en Difference preview bestaan.
- [ ] Apply is één undoable transaction.
- [ ] Cancel herstelt exact de originele transform.
- [ ] Lage-confidence matches worden niet automatisch toegepast.
- [ ] GPU resources worden correct vrijgegeven.
- [ ] Exposureverschil breekt matching niet.
- [ ] Lokale edits domineren de score niet.
- [ ] UI blijft responsive.

---

## 31. Niet doen

Voor de eerste implementatie niet:

- meteen ORB/SIFT/XFeat integreren;
- meteen homography bouwen;
- compositor output analyseren;
- graded textures analyseren;
- volledige textures naar CPU lezen;
- Canvas2D als productiepad gebruiken;
- reference transform aanpassen;
- pixels destructief resamplen;
- confidence overslaan;
- complexer model kiezen zonder duidelijke verbetering.

---

## 32. Belangrijkste technische risico's

De coding agent moet expliciet valideren:

1. **Transform direction**  
   Links- of rechtsvermenigvuldigen?

2. **Shared coordinate space**  
   Staan beide layers echt in dezelfde documentruimte?

3. **Bounds en overlap**  
   Worden invalid pixels correct uitgesloten?

4. **Pyramid scaling**  
   Worden offsets correct omgerekend?

5. **Gradient robustness**  
   Werkt matching bij exposure- en kleurverschillen?

6. **Local edits**  
   Domineren gewijzigde gebieden de score niet?

7. **Readback latency**  
   Wordt alleen compacte scoredata gelezen?

8. **Cache correctness**  
   Invalideert grading de analysis cache niet?

9. **Preview isolation**  
   Wordt pas bij Apply gecommit?

10. **Undo correctness**  
    Herstelt Undo exact de originele matrix?

---

## 33. Einddoel

Na implementatie moet de gebruiker:

1. twee of meer image layers selecteren;
2. één locked layer als reference gebruiken;
3. Auto Align starten;
4. source-pixel matching op WebGPU uitvoeren;
5. grading en lokale edits grotendeels negeren;
6. targets non-destructief uitlijnen;
7. overlay/difference controleren;
8. Apply of Cancel kiezen;
9. de volledige actie undoën.

De architectuur moet later uitbreidbaar blijven naar:

- similarity;
- affine;
- feature matching;
- panorama workflows;
- AI-return masks;
- focus stacking;
- HDR/bracket alignment;
- node-based image operations.

De eerste prioriteit is een kleine, betrouwbare en goed testbare **translation-only WebGPU implementatie die echt werkt met de bestaande Lighttable layer stack**.
