# Lighttable — 3D Placement Layer, Perspective Match en Cached Rendering

## Doel

Voeg een minimale maar solide **3D Placement Layer** toe aan Lighttable.

De 3D-functionaliteit is nadrukkelijk geen volledige 3D-editor. Het doel is:

- een GLB/glTF-object inladen;
- het object in een bestaand beeld plaatsen;
- het object in 3D verplaatsen, roteren en schalen;
- optioneel een camera en origin oplossen met een fSpy-achtige perspective-match tool;
- de 3D-render als normale texture laten deelnemen aan de bestaande Lighttable layer compositor;
- uitsluitend opnieuw renderen wanneer de 3D-state verandert;
- later een AI Harmonize-stap kunnen toevoegen om object en achtergrond fotografisch samen te brengen.

De eerste versie hoeft geen uitgebreide lighting editor, animatiesysteem, physics, particles, node graph of volledige scene editor te bevatten.

---

## Hoofdprincipes

### 1. Een 3D-layer is extern een normale renderbare layer

Intern bevat de layer:

- een Three.js scene;
- één geïmporteerde GLB/glTF asset;
- een perspective camera;
- een object root transform;
- optioneel een gedeelde perspective solution;
- een transparant render target;
- een gecachte outputtexture.

Extern biedt de layer hetzelfde contract als andere renderbare layers:

```ts
interface LayerRenderResult {
  texture: GPUTexture;
  bounds: Rect;
  premultipliedAlpha: boolean;
  revision: number;
}
```

De bestaande Lighttable compositor hoeft geen kennis te hebben van meshes, camera’s, materials of Three.js.

---

### 2. Geen continue renderloop

De 3D-layer draait niet permanent op `requestAnimationFrame`.

Render uitsluitend wanneer een relevante state verandert:

- GLB asset geladen of vervangen;
- object translate/rotate/scale gewijzigd;
- camera gewijzigd;
- perspective solution toegepast;
- document- of renderafmetingen gewijzigd;
- layer opnieuw zichtbaar gemaakt en cache ongeldig is;
- export vraagt om een actuele render.

Wanneer de layer niet actief is en de cache geldig is:

```ts
return cachedRenderResult;
```

Dit betekent dat een niet-actieve 3D-layer zich tijdens normale compositing gedraagt als een gewone gecachte rasterlayer.

---

### 3. Contextgevoelige Transform Tool

Gebruik bij voorkeur de bestaande Transform Tool als contextgevoelige ingang.

Gedrag:

```text
Raster/Paint layer actief
→ bestaande 2D transform tool

3D layer actief
→ Three.js 3D transform controls
```

Voor een 3D-layer moet de tool minimaal drie modes ondersteunen:

- Translate
- Rotate
- Scale

Gebruik in de eerste versie Three.js `TransformControls`.

Aanbevolen shortcuts:

```text
W → Translate
E → Rotate
R → Scale
```

De tool manipuleert de 3D object root, niet de 2D cached output van de layer.

Een eventuele latere aparte 2D layer-transform van de uiteindelijke render moet als afzonderlijk concept worden behandeld.

---

## Scope versie 1

### In scope

- nieuw `3d` layertype;
- GLB/glTF import;
- Three.js scene per 3D-layer;
- Three.js `WebGPURenderer`;
- transparante achtergrond;
- embedded glTF materials;
- perspective camera;
- object root translate/rotate/scale;
- contextgevoelige Transform Tool;
- gecachte render-target output;
- dirty/invalidation model;
- 3D-menu dat alleen actief is wanneer een 3D-layer actief is;
- default camera zonder perspective match;
- fSpy-achtige perspective match;
- matched origin;
- snap selected object to origin;
- reset transform;
- object terugvinden wanneer het buiten beeld staat;
- document serialization;
- correcte disposal van textures, geometries en image bitmaps.

### Niet in scope

- animation playback;
- timeline;
- multiple editable objects per layer;
- skeletal editing;
- material editor;
- uitgebreide lighting editor;
- environment/HDRI workflow;
- physics;
- particles;
- USD;
- shadow catcher;
- render passes zoals normals/depth/object ID;
- AI Harmonize implementatie;
- automatische AI camera calibration.

Deze onderdelen mogen architectonisch niet onmogelijk worden gemaakt, maar hoeven niet in het eerste prototype.

---

# Gebruikersworkflow

## Workflow A — zonder perspective match

Een 3D-layer moet volledig bruikbaar zijn zonder fSpy/perspective matching.

```text
3D > Import GLB
→ nieuwe 3D-layer
→ standaardcamera
→ object wordt genormaliseerd en bij de scene-origin geplaatst
→ transform gizmo wordt actief
→ gebruiker plaatst het object op het oog
```

Geschikt voor:

- zwevende objecten;
- productrenders;
- grafische composities;
- abstracte elementen;
- objecten waarbij exacte aansluiting op de foto niet nodig is.

---

## Workflow B — met perspective match

```text
Selecteer achtergrondbeeld
→ 3D > Perspective Match…
→ plaats axis/vanishing-point guides
→ kies origin in het beeld
→ solve camera
→ maak of activeer een 3D-layer
→ apply matched camera
→ snap object to matched origin
→ translate/rotate/scale object
```

Perspective Match dient uitsluitend om te bepalen:

- camera orientation;
- field of view;
- horizon;
- ground-plane orientation;
- image-space origin;
- wereld-origin die onder de gekozen beeldpositie projecteert.

De solver hoeft niet automatisch lighting, scene scale of objectplaatsing te bepalen.

---

# 3D-menu

Het menu **3D** is zichtbaar of disabled afhankelijk van het productdesign, maar de acties zijn uitsluitend actief wanneer een 3D-layer geselecteerd is.

Aanbevolen eerste versie:

```text
3D
├── Import GLB…
├── Replace GLB…
├── Perspective Match…
├── Apply Perspective Solution
├── Use Default Camera
├── Use Matched Camera
├── Snap Selected to Origin
├── Reset Selected Transform
├── Find / Recover Selected
├── Show Origin
├── Show Ground Grid
└── Remove 3D Asset
```

## Verplicht gedrag

### Snap Selected to Origin

Verplaatst de geselecteerde object root naar de huidige scene-origin:

```ts
objectRoot.position.copy(sceneOrigin);
```

Standaard:

```ts
sceneOrigin = new THREE.Vector3(0, 0, 0);
```

Bij een perspective match moet deze wereld-origin projecteren naar de door de gebruiker gekozen `originImagePoint`.

De actie mag rotatie en schaal niet wijzigen.

---

### Reset Selected Transform

Herstelt de geïmporteerde object root naar de genormaliseerde importstate:

```ts
position = initialPosition;
rotation = initialRotation;
scale = initialScale;
```

Sla deze importstate expliciet op nadat asset-normalisatie is uitgevoerd.

---

### Find / Recover Selected

Een perspective match kan de camera sterk wijzigen. Een bestaand object kan daardoor:

- buiten beeld staan;
- achter de camera staan;
- zeer ver weg lijken;
- extreem klein projecteren.

In matched-camera mode mag `Find Selected` niet stilletjes de solved camera wijzigen.

Aanbevolen gedrag:

1. Controleer of de object bounds zichtbaar zijn.
2. Wanneer het object buiten beeld staat, toon een kleine recover-overlay.
3. Bied acties:
   - `Snap to Origin`
   - `Reset Transform`
4. Toon optioneel een viewport-edge indicator in de richting van het object.
5. Wijzig de matched camera niet zonder expliciete gebruikersactie.

In default/free-camera mode mag een latere `Frame Selected` actie de camera wel bewegen.

---

### Use Default Camera / Use Matched Camera

Een 3D-layer kan altijd een standaardcamera gebruiken.

Wanneer een perspective solution aanwezig is, kan de gebruiker wisselen tussen:

```ts
type CameraMode = "default" | "matched";
```

De layer moet beide camerastates onafhankelijk bewaren, zodat terugschakelen geen state verliest.

---

# Perspective Match

## Functionele rol

Perspective Match is een optionele document- of shot-level camera solution.

Eén solution kan door meerdere 3D-layers worden gebruikt.

```ts
interface PerspectiveSolution {
  id: string;
  name: string;

  sourceLayerId: string;
  sourceImageSize: {
    width: number;
    height: number;
  };

  camera: {
    position: Vec3;
    rotation: Quat;
    verticalFovDegrees: number;
    near: number;
    far: number;
  };

  groundPlane: {
    normal: Vec3;
    constant: number;
  };

  worldOrigin: Vec3;
  originImagePoint: Vec2;

  solveMode: "onePoint" | "twoPoint" | "threePoint";
  revision: number;
}
```

Bewaar een perspective solution niet uitsluitend in één 3D-layer. Gebruik een document-level collection:

```ts
interface Document3DState {
  perspectiveSolutions: PerspectiveSolution[];
  activePerspectiveSolutionId?: string;
}
```

Een 3D-layer verwijst ernaar:

```ts
perspectiveSolutionId?: string;
```

---

## fSpy research

fSpy is een open-source still-image camera-matching applicatie. De broncode is TypeScript en de repository bevat de camera-solver, UI, tests en het project-file format.

Belangrijke researchdoelen voor de agent:

1. Lokaliseer in de fSpy repository:
   - vanishing-point berekening;
   - horizonberekening;
   - focal-length/FOV solve;
   - camera rotation solve;
   - principal point handling;
   - one-, two- en three-point perspective modes;
   - origin placement;
   - reference-distance/scale handling;
   - project-file data structures;
   - tests met bekende camera solutions.

2. Documenteer welke delen:
   - wiskundig conceptueel kunnen worden hergebruikt;
   - project-specifiek zijn;
   - direct gekoppeld zijn aan fSpy UI/state;
   - niet nodig zijn voor Lighttable v1.

3. Bouw voor Lighttable een kleine, framework-onafhankelijke solver module:

```ts
interface PerspectiveSolver {
  solve(input: PerspectiveSolveInput): PerspectiveSolveResult;
}
```

4. Schrijf unit tests met:
   - synthetische verdwijnpunten;
   - bekende FOV;
   - bekende camera rotation;
   - meerdere beeldverhoudingen;
   - crop/resize cases;
   - near-parallel guides;
   - ongeldige of instabiele configurations.

## Licentie-opmerking

fSpy staat onder GPL-3.0.

Neem niet zonder besluitvorming broncode rechtstreeks over in een niet-GPL Lighttable codebase.

Gebruik de repository voor:

- algoritmeonderzoek;
- begrip van de wiskunde;
- testcases en gedragsonderzoek;
- onafhankelijke herimplementatie.

Laat vóór directe code-overname expliciet beoordelen of de licentie verenigbaar is met de distributie en licentie van Lighttable.

Bronnen:

- https://github.com/stuffmatic/fspy
- https://fspy.io/
- https://github.com/stuffmatic/fspy/blob/develop/project_file_format.md

---

# Perspective Match UI

## Minimale UI

De eerste versie heeft:

- twee sets parallelle lijnen voor X- en Z-richting;
- optionele verticale/Y-richting;
- horizonweergave;
- origin handle;
- solve-status;
- apply/cancel;
- preview grid.

Bij two-point perspective:

```text
X guide pair → vanishing point X
Z guide pair → vanishing point Z
X/Z vanishing points → horizon
vertical direction → camera roll/up constraint
origin handle → wereld-origin projectie
```

De preview grid moet op het ground plane liggen en door de solved camera worden gerenderd.

De gebruiker hoeft geen absoluut wereldformaat te bepalen. Object scale blijft handmatig.

---

## Origin

De origin is cruciaal en moet in de eerste implementatie zitten.

De gebruiker kiest in de foto het punt waar geïmporteerde objecten logisch verschijnen.

Na solve moet gelden:

```text
project(worldOrigin) ≈ originImagePoint
```

Nieuwe objecten worden standaard op de origin geplaatst.

Na het toepassen van een nieuwe perspective solution op een bestaande 3D-layer:

- verander de camera;
- verplaats bestaande objecten niet automatisch;
- toon wanneer nodig de recover-overlay;
- bied direct `Snap Selected to Origin`.

Dit voorkomt onverwachte destructieve verplaatsingen en voorkomt tegelijk dat objecten “kwijt” lijken.

---

# 3D-layer documentmodel

```ts
interface ThreeDLayer extends BaseLayer {
  type: "3d";

  asset: {
    assetId: string;
    format: "glb" | "gltf";
    contentHash: string;
  };

  object: {
    rootTransform: Transform3D;
    initialTransform: Transform3D;
  };

  cameraMode: "default" | "matched";

  defaultCamera: CameraState;
  perspectiveSolutionId?: string;

  viewport: {
    showOrigin: boolean;
    showGroundGrid: boolean;
  };

  renderState: {
    sourceRevision: number;
    cachedRevision: number;
    dirtyReasons: ThreeDDirtyReason[];
  };

  layerTransform2D?: Transform2D;
}
```

```ts
interface Transform3D {
  position: [number, number, number];
  rotationQuaternion: [number, number, number, number];
  scale: [number, number, number];
}
```

Gebruik intern quaternions voor rotatie. Converteer alleen voor UI-weergave naar Euler-hoeken.

---

# Runtime architectuur

## Aanbevolen modules

```text
src/3d/
├── ThreeDLayerRuntime.ts
├── ThreeDSceneFactory.ts
├── ThreeDAssetLoader.ts
├── ThreeDRenderService.ts
├── ThreeDTransformController.ts
├── ThreeDCameraController.ts
├── ThreeDCache.ts
├── ThreeDDisposal.ts
├── perspective/
│   ├── PerspectiveSolver.ts
│   ├── PerspectiveTypes.ts
│   ├── VanishingPointMath.ts
│   ├── CameraCalibrationMath.ts
│   └── PerspectiveSolver.test.ts
└── ui/
    ├── ThreeDMenu.tsx
    ├── PerspectiveMatchOverlay.tsx
    ├── TransformGizmoOverlay.tsx
    └── RecoverObjectOverlay.tsx
```

Houd serialized documentstate gescheiden van runtime Three.js objecten.

```ts
interface ThreeDLayerRuntime {
  scene: THREE.Scene;
  objectRoot: THREE.Group;
  activeCamera: THREE.PerspectiveCamera;
  defaultCamera: THREE.PerspectiveCamera;
  transformControls: TransformControls;
  renderTarget: THREE.RenderTarget;
  cachedResult?: LayerRenderResult;
}
```

Runtime objecten mogen niet rechtstreeks in Zustand/document JSON worden opgeslagen.

---

# Three.js integratie

## Asset loading

Gebruik `GLTFLoader`.

Ondersteun in het prototype minimaal:

- standaard GLB;
- embedded textures;
- Draco wanneer de bestaande productstack dit eenvoudig kan leveren;
- Meshopt optioneel.

Na import:

1. Maak een `THREE.Group` als `objectRoot`.
2. Plaats de geladen glTF scene als child.
3. Bereken gecombineerde bounds.
4. Normaliseer alleen wat noodzakelijk is.
5. Bewaar de toegepaste import-normalisatie in `initialTransform`.
6. Plaats `objectRoot` op de huidige scene-origin.
7. Selecteer de object root.
8. Activeer de 3D transform gizmo.
9. Markeer de layer dirty.
10. Render één keer.

Let op: dispose image bitmaps en GPU-resources expliciet wanneer een asset wordt vervangen of de layer wordt verwijderd.

Three.js documentatie:

- https://threejs.org/docs/pages/GLTFLoader.html
- https://threejs.org/docs/pages/TransformControls.html
- https://threejs.org/docs/pages/WebGPURenderer.html

---

## Renderer

Gebruik als eerste onderzoekspad Three.js `WebGPURenderer`.

Eisen:

- transparante background;
- output geschikt voor Lighttable compositing;
- geen ingebakken tone mapping die botst met de Lighttable grade pipeline;
- consistente alpha-conventie;
- render op document/canvas outputafmetingen;
- geen permanente animation loop.

Initialisatieconcept:

```ts
const renderer = new THREE.WebGPURenderer({
  alpha: true,
  antialias: true,
});

await renderer.init();
```

Onderzoek expliciet:

- lineaire output;
- `HalfFloatType` output;
- premultiplied versus straight alpha;
- direct render target access;
- uitwisseling met Lighttable’s bestaande `GPUDevice`;
- kosten en beperkingen van een eigen Three.js GPU device;
- fallback via transparante canvas en `copyExternalImageToTexture`.

Neem geen architectuurbesluit over shared-device interop zonder een kleine technische spike.

---

# Cached rendering

## Dirty model

Gebruik expliciete invalidation in plaats van continue vergelijking van alle state.

```ts
type ThreeDDirtyReason =
  | "asset"
  | "objectTransform"
  | "camera"
  | "perspectiveSolution"
  | "renderSize"
  | "visibility"
  | "rendererReset"
  | "export";
```

```ts
function invalidateThreeDLayer(
  layerId: string,
  reason: ThreeDDirtyReason
): void;
```

## Renderbeslissing

```ts
function getThreeDLayerRender(
  layer: ThreeDLayer,
  runtime: ThreeDLayerRuntime
): LayerRenderResult {
  if (!runtime.cachedResult || layer.renderState.dirtyReasons.length > 0) {
    renderAndUpdateCache(layer, runtime);
  }

  return runtime.cachedResult;
}
```

## Wanneer niet renderen

Niet opnieuw renderen voor:

- gewone layer selection changes, tenzij gizmo/overlay dit vereist;
- pannen en zoomen van de 2D editorviewport;
- andere layer adjustments;
- grading boven of onder de 3D-layer;
- opacity/blend-mode wijzigingen;
- uitgeschakelde 3D-layer;
- niet-actieve 3D-layer met geldige cache.

De compositor mag de bestaande cached texture blijven samplen.

## Wanneer wel renderen

- object transform drag;
- object transform commit;
- camera change;
- perspective solution change;
- asset replace;
- document render size change;
- cache loss/device reset;
- export wanneer revision niet actueel is.

100K polygonen is geen reden om vooraf verschillende preview-quality modes te bouwen. Houd v1 op één kwaliteitsniveau. Voeg pas dynamische quality scaling toe wanneer profiling aantoont dat dit nodig is.

---

# Transform-interactie

## Selectie

Voor v1 is één editable object root per 3D-layer voldoende.

De volledige GLB wordt als één plaatsbaar object behandeld.

```ts
transformControls.attach(runtime.objectRoot);
```

Interne glTF nodes hoeven nog niet apart selecteerbaar te zijn.

## Tijdens drag

```ts
transformControls.addEventListener("objectChange", () => {
  syncRuntimeTransformToDocument();
  invalidateThreeDLayer(layerId, "objectTransform");
  requestEditorRender();
});
```

Render tijdens drag op normale outputkwaliteit, tenzij metingen aantonen dat dit te traag is.

## Undo/redo

Start één undo transaction bij drag start en commit bij drag end.

Niet iedere pointermove als aparte undo entry opslaan.

```text
mouseDown gizmo
→ begin transaction

objectChange
→ update transient state

mouseUp gizmo
→ commit one transform command
```

---

# AI Harmonize — toekomstige aansluiting

AI Harmonize is niet onderdeel van v1, maar de output moet hiervoor bruikbaar zijn.

Voorgestelde toekomstige flow:

```text
background image
+
3D beauty pass with alpha
+
optional object mask
→ AI Harmonize
→ harmonized raster result
```

Mogelijke taken:

- lichtkleur aanpassen;
- exposure en contrast matchen;
- contact met ondergrond verbeteren;
- reflecties of bounced light suggereren;
- grain/noise matchen;
- lens softness en chromatic behavior matchen;
- kleine geometry/material artefacts verbergen.

Behandel AI Harmonize als een expliciete, niet-destructieve afgeleide stap. Bewaar de originele 3D-layer en camera/objectstate.

Bouw in v1 nog geen complexe lighting workflow uitsluitend om toekomstige harmonisatie te ondersteunen.

---

# Implementatiefasen

## Fase 0 — technische spikes

### Spike A: Three.js output naar Lighttable compositor

Doel:

- GLB renderen met transparante achtergrond;
- output in bestaande compositor tonen;
- alpha en kleurspace valideren;
- render uitsluitend op expliciete request;
- cache opnieuw gebruiken.

Acceptatie:

- geen continue renderloop;
- object verschijnt correct boven een image layer;
- opacity en blend mode werken;
- cache blijft zichtbaar nadat 3D-layer niet actief is.

### Spike B: TransformControls

Doel:

- contextgevoelige Transform Tool;
- translate/rotate/scale;
- state sync;
- één undo transaction per drag.

### Spike C: perspective solve

Doel:

- eenvoudige two-point solve;
- horizon;
- FOV;
- camera orientation;
- origin;
- grid preview;
- object snap to origin.

---

## Fase 1 — minimale 3D-layer

- `ThreeDLayer` documenttype;
- runtime registry;
- GLB import;
- default camera;
- transparent render;
- cached texture;
- transform gizmo;
- 3D-menu;
- snap to origin;
- reset transform;
- show origin/grid;
- disposal;
- save/load;
- undo/redo.

### Acceptatiecriteria

- gebruiker kan zonder perspective match een GLB importeren;
- object verschijnt direct in beeld;
- object kan worden getransformeerd;
- layer rendert niet continu;
- niet-actieve layer gebruikt cache;
- document heropenen herstelt asset, camera en transform;
- ontbrekende asset geeft een duidelijke placeholder/error;
- verwijderen van layer lekt geen Three.js resources.

---

## Fase 2 — Perspective Match

- perspective solution documentmodel;
- overlay met axis guides;
- two-point solver;
- origin handle;
- camera preview grid;
- apply solution;
- matched/default camera toggle;
- snap selected to matched origin;
- recover-object overlay;
- unit tests.

### Acceptatiecriteria

- solved grid sluit visueel aan op de perspectieflijnen;
- world origin projecteert op gekozen image origin;
- nieuw GLB verschijnt op de matched origin;
- bestaande objecten worden niet stilletjes verplaatst;
- buiten beeld geraakt object kan met één actie worden hersteld;
- meerdere 3D-layers kunnen dezelfde solution gebruiken.

---

## Fase 3 — stabilisatie

- WebGPU device-loss recovery;
- resize invalidation;
- export render validation;
- serialized migration/versioning;
- GLB texture disposal;
- grotere asset tests;
- cropped image/perspective solution behavior;
- regression tests;
- performance profiling.

Voeg pas na profiling toe:

- preview-resolution scaling;
- advanced culling;
- shared scene renderer;
- pooled render targets.

---

# Onderzoeksvragen die de agent expliciet moet beantwoorden

1. Kan Three.js `WebGPURenderer` veilig naast de bestaande Lighttable `GPUDevice` bestaan?
2. Kunnen beide dezelfde device/resources delen zonder private Three.js internals?
3. Is directe texture sharing mogelijk en stabiel genoeg?
4. Is een transparante offscreen canvas plus `copyExternalImageToTexture` eenvoudiger en voldoende snel?
5. Welke alpha-conventie gebruikt Three.js in deze route?
6. Hoe voorkomen we dubbele sRGB/linear conversie?
7. Welke tone-mapping settings moeten expliciet uit?
8. Hoe groot moeten render targets zijn ten opzichte van document en layer bounds?
9. Kunnen render targets gepoold worden zonder stale textures?
10. Welke fSpy solve modes zijn noodzakelijk voor v1?
11. Welke solver-code kan conceptueel worden herbouwd zonder GPL-code over te nemen?
12. Hoe gedraagt een solution zich na crop, resize of canvas rotation?
13. Moet de principal point standaard op image center blijven?
14. Hoe detecteren we dat een object buiten de matched camera frustum staat?
15. Hoe projecteren we de chosen image origin exact naar de world-origin?
16. Hoe garanderen we dat nieuwe imports altijd zichtbaar en recoverable zijn?

---

# Aanbevolen beslissingen voor v1

- Gebruik Three.js.
- Gebruik één GLB-object root per 3D-layer.
- Gebruik één perspective camera per layer, plus optionele matched camera state.
- Laat meerdere layers naar dezelfde document-level perspective solution verwijzen.
- Gebruik geen continue renderloop.
- Cache de complete RGBA-output.
- Gebruik de bestaande Transform Tool contextgevoelig.
- Maak het 3D-menu alleen actief op een 3D-layer.
- Implementeer `Snap Selected to Origin` direct.
- Implementeer een recover-flow direct.
- Verplaats bestaande objecten nooit automatisch na een nieuwe solve.
- Plaats nieuwe objecten wel automatisch op de actuele origin.
- Bouw geen quality levels vóór profiling.
- Bouw geen lighting editor vóór er een echte behoefte is.
- Houd AI Harmonize als expliciete vervolgstap.
- Houd fSpy code/licentie strikt gescheiden van de eigen solverimplementatie.

---

# Definition of Done voor het prototype

Het prototype is geslaagd wanneer:

1. Een gebruiker een afbeelding als achtergrond kan openen.
2. Een gebruiker een GLB als 3D-layer kan importeren.
3. De GLB direct zichtbaar bij de standaardorigin verschijnt.
4. De bestaande Transform Tool automatisch een 3D gizmo wordt.
5. Translate, rotate en scale werken met undo/redo.
6. De 3D-layer alleen opnieuw rendert na 3D-statewijzigingen.
7. Een niet-actieve 3D-layer uit zijn cached texture wordt gecomposite.
8. Perspective Match een camera, ground plane en origin kan oplossen.
9. De gebruiker het object naar de matched origin kan snappen.
10. Een object dat na camera matching buiten beeld staat teruggevonden kan worden.
11. Meerdere 3D-layers dezelfde perspective solution kunnen gebruiken.
12. Save/load de volledige non-destructieve state herstelt.
13. De bestaande Lighttable grade, opacity, masks en blend modes op de gerenderde output kunnen werken.
14. Er geen permanente Three.js renderloop of aantoonbare GPU-resource leak aanwezig is.
