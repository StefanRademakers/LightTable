# ag-psd Feature- en Parityreferentie voor Lighttable

> **Implementation companion:** use
> `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md` for the executable product,
> architecture, editing-UI and verification checklist. This file remains the
> technical format/library reference.

> **Doel:** technisch referentiedocument voor het importeren, intern modelleren, renderen, bewerken en exporteren van Photoshop PSD/PSB-documenten met `ag-psd`, met als uiteindelijke doel een zo hoog mogelijke Photoshop-featurepariteit in Lighttable.
>
> **Bronstatus:** gecontroleerd op 28 juli 2026 tegen `ag-psd` package/repositoryversie **31.0.2** en de actuele TypeScript-bron op `master`.
>
> **Belangrijk:** `ag-psd` is een **pure JavaScript/TypeScript parser en serializer**, geen WASM-library en geen Photoshop-renderer.

---

## 1. Executive summary

`ag-psd` is geschikt als centrale PSD/PSB I/O-laag voor Lighttable:

```text
PSD / PSB bytes
    ↓
ag-psd parser
    ↓
Lighttable canonical document model
    ↓
Lighttable WebGPU compositor en editors
    ↓
Lighttable-generated layer previews + composite preview
    ↓
ag-psd serializer
    ↓
PSD / PSB bytes
```

De library kan veel Photoshop-structuren semantisch uitlezen en een groot deel daarvan opnieuw schrijven:

- documentafmetingen, kleurmodus, bitdiepte en samengestelde afbeelding;
- volledige geneste layer tree;
- rasterlagen, groepen, masks en real masks;
- clipping, opacity, fill opacity, locks, linked layers en Blend If-ranges;
- vrijwel alle reguliere Photoshop blend modes;
- tekstlagen met stijl- en paragraafruns;
- vector masks, shape fills, gradients en strokes;
- adjustment layers;
- layer effects;
- Smart Objects, embedded/linked bestanden, transforms, warps en veel Smart Filters;
- artboards;
- layer comps;
- animatie-, timeline- en beperkte video-metadata;
- documentresources zoals guides, resolution, thumbnail, XMP, printdata, slices en annotations.

De cruciale grens is:

> `ag-psd` leest en schrijft PSD-structuur en pixelbuffers, maar rendert geen Photoshop-resultaat.

Lighttable moet daarom zelf:

1. blend modes en compositing uitvoeren;
2. adjustment layers renderen;
3. masks toepassen;
4. vector shapes rasteriseren;
5. tekst renderen;
6. layer effects renderen;
7. Smart Object-transforms, warps en ondersteunde filters renderen;
8. actuele layer previews, document composite en thumbnail genereren vóór export.

---

## 2. Betrouwbaarheidslegenda

In dit document worden vier niveaus gebruikt:

| Status | Betekenis |
|---|---|
| **Editable** | `ag-psd` heeft getypeerde read/write-ondersteuning en Lighttable kan dit als bewerkbare feature modelleren. Eigen rendering blijft meestal noodzakelijk. |
| **Read / preserve** | Data kan worden gelezen, maar wijzigingen zijn beperkt, read-only of riskant. Bewaren zonder semantische edit is het primaire doel. |
| **Raster fallback** | De semantische data is onvolledig of Lighttable ondersteunt de renderer nog niet. Gebruik de meegeleverde Photoshop-rasterpreview als visuele fallback. |
| **Unsupported / lossy** | `ag-psd` ondersteunt de structuur niet betrouwbaar of slaat onbekende blokken over. Een open-save-roundtrip kan data verliezen. |

### 2.1 Parserondersteuning is niet hetzelfde als Photoshop-pariteit

Voor daadwerkelijke featurepariteit zijn vier afzonderlijke lagen nodig:

1. **Parse parity** — kan de PSD-data worden uitgelezen?
2. **Model parity** — kan Lighttable dezelfde betekenis intern representeren?
3. **Render parity** — produceert Lighttable visueel hetzelfde resultaat?
4. **Roundtrip parity** — blijft het document na edit/export correct en verder bewerkbaar in Photoshop?

Een feature geldt pas als volledig ondersteund wanneer alle vier slagen.

---

## 3. Actuele formaatondersteuning

De publieke README bevat enkele verouderde beperkingen. De actuele broncode en changelog zijn leidend.

### 3.1 PSD en PSB

| Formaat | Lezen | Schrijven | Opmerking |
|---|---:|---:|---|
| PSD / `8BPS` versie 1 | Ja | Ja | Normaal PSD-formaat, maximaal 30.000 × 30.000 volgens de formaatgrens. |
| PSB / `8BPS` versie 2 | Ja | Ja | Schrijven via `writePsd(..., { psb: true })`. Maximaal 300.000 × 300.000 volgens de formaatheader. |

Belangrijke PSB-beperkingen:

- ondersteuning betekent niet dat willekeurig grote PSB-bestanden veilig in een browser passen;
- de parser werkt met `ArrayBuffer`, typed arrays en JavaScript-geheugenlimieten;
- de changelog noemt een praktische bestandsgroottelimiet rond 2 GB;
- bepaalde channel sizes groter dan 4 GB worden expliciet geweigerd;
- Lighttable moet eigen limieten afdwingen voordat bitmaps worden gedecomprimeerd.

### 3.2 Kleurmodi bij lezen

De actuele reader accepteert:

| PSD-kleurmodus | Lezen | Semantiek |
|---|---:|---|
| Bitmap | Ja | Wordt naar RGB(A)-pixeldata geconverteerd. |
| Grayscale | Ja | Wordt naar RGB(A)-pixeldata uitgebreid. |
| Indexed | Ja | Palette wordt als `psd.palette` gelezen; pixels worden naar RGB(A) geconverteerd. |
| RGB | Ja | Native hoofdpad. |
| CMYK | Nee | Reader weigert de documentmodus. Kleurobjecten binnen effects/metadata kunnen wél CMYK zijn. |
| Multichannel | Nee | Niet ondersteund als documentmodus. |
| Duotone | Nee | Niet ondersteund als documentmodus. |
| Lab | Nee | Niet ondersteund als documentmodus. Kleurobjecten binnen metadata kunnen wél Lab zijn. |

### 3.3 Kleurmodi bij schrijven

`ag-psd` schrijft uitsluitend:

- **RGB-documenten**;
- 3 kleurkanalen, of 4 wanneer de composite alpha bevat.

Een ingelezen Bitmap-, Grayscale- of Indexed-document kan dus niet format-lossless in zijn originele documentmodus worden teruggeschreven. Export wordt RGB.

### 3.4 Bitdiepte

| Bitdiepte | Lezen | Schrijven | Pixelrepresentatie |
|---|---:|---:|---|
| 1-bit | Ja, vooral Bitmap | Nee als 1-bit output | Reader converteert naar bruikbare pixels. |
| 8-bit/channel | Ja | Ja | `Uint8Array` of `Uint8ClampedArray`. |
| 16-bit/channel | Ja | Nee | `Uint16Array` met `useImageData: true`; Canvas-pad reduceert naar 8-bit. |
| 32-bit/channel | Initieel/partieel ja | Nee | `Float32Array`; brondata is lineair. Niet als volledig productieproof beschouwen zonder testcorpus. |

**Aanbeveling voor Lighttable:**

- gebruik altijd `useImageData: true` voor betrouwbare pixelimport;
- behoud intern 16-bit/float-precisie wanneer het bronbestand dat bevat;
- label PSD-export voorlopig expliciet als **8-bit RGB PSD/PSB export**;
- bied voor high-bit-depth documenten eventueel TIFF/EXR of een eigen Lighttable-documentformaat als lossless alternatief.

### 3.5 Compressie

De reader kent:

- raw data;
- RLE-compressie;
- ZIP zonder prediction;
- ZIP met prediction.

De writer gebruikt standaard RLE. Met `compress: true` kan layer- en maskdata als ZIP zonder prediction worden geschreven. De composite wordt RLE geschreven vanwege compatibiliteit.

---

## 4. Publieke API

```ts
import {
  readPsd,
  writePsd,
  writePsdUint8Array,
  getLayerImageData,
  getLayerMaskImageData,
  getLayerRealMaskImageData,
  getLayerCanvas,
  getLayerMaskCanvas,
  getLayerRealMaskCanvas,
  getCompositeImageData,
  getCompositeCanvas,
} from 'ag-psd';
```

### 4.1 Lezen

```ts
const psd = readPsd(arrayBuffer, {
  useImageData: true,
  useRawThumbnail: true,
  logMissingFeatures: true,
});
```

### 4.2 Schrijven

```ts
const output = writePsdUint8Array(psd, {
  generateThumbnail: true,
  trimImageData: true,
  noBackground: true,
  compress: false,
  psb: false,
});
```

### 4.3 Aanbevolen productie-import

Voor onbetrouwbare uploads niet direct alles decomprimeren:

```ts
const psd = readPsd(input, {
  useRawData: true,
  useRawThumbnail: true,
  skipLinkedFilesData: false,
  logMissingFeatures: true,
  totalMemoryLimit: MAX_DECODE_BYTES,
});
```

Daarna eerst valideren:

- documentafmetingen;
- bitdiepte;
- kleurmodus;
- aantal lagen;
- maximale laagafmetingen;
- totale geschatte pixeloppervlakte;
- embedded Smart Object-grootte;
- aantal masks en filterbuffers;
- totale decompressed memory;
- nesting depth.

Decode vervolgens lagen gecontroleerd en bij voorkeur on demand.

---

## 5. Top-level PSD-documentdata

Een `Psd` bevat minimaal:

```ts
interface Psd {
  width: number;
  height: number;
  channels?: number;
  bitsPerChannel?: number;
  colorMode?: ColorMode;

  palette?: RGB[];
  children?: Layer[];

  canvas?: HTMLCanvasElement;
  imageData?: PixelData;
  rawCompositeData?: Uint8Array;

  imageResources?: ImageResources;
  linkedFiles?: LinkedFile[];
  artboards?: Artboards;
  globalLayerMaskInfo?: GlobalLayerMaskInfo;
  annotations?: Annotation[];
}
```

Omdat `Psd` ook `LayerAdditionalInfo` uitbreidt, kunnen bepaalde additional-info-blokken op documentniveau voorkomen, zoals patterns en engine data.

### 5.1 Documentafmetingen

- `width`
- `height`
- `channels`
- `bitsPerChannel`
- `colorMode`
- `palette` bij Indexed Color

### 5.2 Composite image

De PSD kan een voorgemonteerde composite bitmap bevatten:

- `psd.canvas`, of
- `psd.imageData`, of
- `psd.rawCompositeData` bij raw-decode.

Deze composite is bruikbaar als:

- snelle documentpreview;
- fallback wanneer Lighttable bepaalde features nog niet rendert;
- visuele ground truth voor importer-tests;
- basis voor thumbnailgeneratie.

De composite is **niet automatisch gekoppeld** aan veranderingen in de layer tree. Na iedere visuele wijziging moet Lighttable een nieuwe composite genereren of de oude verwijderen.

### 5.3 Root layer tree

`psd.children` bevat de rootlagen van boven naar beneden, gelijk aan het Photoshop Layers-panel.

Voor compositing moet meestal van onder naar boven worden gerenderd.

---

## 6. Layer tree en laagtypen

`ag-psd` gebruikt geen exclusief `layer.type`-veld. Het laagtype wordt afgeleid uit aanwezige properties.

```ts
function classifyLayer(layer: Layer): string {
  if (layer.children) return 'group';
  if (layer.text) return 'text';
  if (layer.adjustment) return 'adjustment';
  if (layer.placedLayer) return 'smart-object';
  if (layer.vectorMask || layer.vectorFill) return 'vector-shape';
  if (layer.imageData || layer.canvas || layer.rawData) return 'pixel';
  return 'special-or-empty';
}
```

Let op:

- eigenschappen kunnen gecombineerd voorkomen;
- een tekstlaag heeft doorgaans ook een rasterpreview;
- een Smart Object heeft doorgaans ook een rasterpreview;
- een vectorlaag heeft doorgaans ook een rasterpreview;
- iedere laag kan daarnaast een bitmap mask, vector mask, effects, clipping en blending settings hebben.

### 6.1 Groepen

Groepen worden vertegenwoordigd door:

```ts
interface GroupLayer extends Layer {
  children: Layer[];
  opened?: boolean;
}
```

Ondersteunde groepsinformatie:

- geneste children;
- open/dicht-status;
- visibility;
- opacity;
- group blend mode;
- `pass through` blend mode;
- clipping en advanced blending fields;
- layer color;
- locks;
- layer effects;
- layer comps en timeline-metadata.

Een groep heeft geen eigen pixelbitmap, tenzij een ongeldige/custom structuur wordt aangeleverd. De writer weigert een laag die tegelijk `children` en `canvas/imageData` bevat.

---

## 7. Algemene laagdata

### 7.1 Bounds en positionering

```ts
layer.top
layer.left
layer.bottom
layer.right
```

De laagbitmap kan:

- kleiner zijn dan het document;
- groter zijn dan het document;
- negatieve offsets hebben;
- volledig of gedeeltelijk buiten het document liggen.

Bij schrijven worden `bottom` en `right` afgeleid uit de bitmapafmetingen. `top` en `left` zijn de positionele origin.

### 7.2 Naam en identiteit

- `name`
- `nameSource`
- `id`
- `version`
- `timestamp`
- `layerColor`

De writer dedupliceert dubbele layer IDs. Voor Lighttable moeten de PSD-layer ID en een eigen stabiele document-UUID afzonderlijk worden bewaard.

### 7.3 Visibility en opacity

- `hidden`
- `opacity` — 0 tot 1
- `fillOpacity` — 0 tot 1
- `effectsOpen`

Photoshop onderscheidt opacity en fill opacity. Voor correcte parity mag Lighttable deze niet samenvoegen.

### 7.4 Clipping

- `clipping`

Clipping layers moeten tegen de alpha/transparency van de onderliggende basislaag of clippinggroep worden uitgevoerd.

### 7.5 Locks

- `transparencyProtected`
- `protected.transparency`
- `protected.composite`
- `protected.position`
- `protected.artboards`

Lighttable moet deze flags minstens visueel tonen en edit-acties blokkeren volgens de betekenis.

### 7.6 Linked layers

- `linkGroup`
- `linkGroupEnabled`

Lagen met dezelfde niet-nul `linkGroup` horen aan elkaar gekoppeld te zijn voor transforms/moves.

### 7.7 Advanced blending

- `blendClippendElements`
- `blendInteriorElements`
- `knockout`
- `transparencyShapesLayer`
- `layerMaskAsGlobalMask`
- `channelBlendingRestrictions`
- `blendingRanges`
- `referencePoint`

`blendingRanges` vertegenwoordigt Photoshop **Blend If**-data:

```ts
layer.blendingRanges = {
  compositeGrayBlendSource: number[],
  compositeGraphBlendDestinationRange: number[],
  ranges: Array<{
    sourceRange: number[];
    destRange: number[];
  }>,
};
```

Dit is belangrijk voor echte Photoshop-pariteit en moet als apart compositoronderdeel worden geïmplementeerd.

### 7.8 Blend modes

De actuele types bevatten:

```text
pass through
normal
dissolve
darken
multiply
color burn
linear burn
darker color
lighten
screen
color dodge
linear dodge
lighter color
overlay
soft light
hard light
vivid light
linear light
pin light
hard mix
difference
exclusion
subtract
divide
hue
saturation
color
luminosity
linear height
height
subtraction
```

De laatste drie zijn minder standaard/interne varianten en moeten als compatibiliteitscases worden behandeld.

**Lighttable parity-eis:** blend modes moeten in dezelfde working color space en met dezelfde alpha/compositing-semantiek worden uitgevoerd als Photoshop. Alleen de formule kopiëren is niet voldoende; edge cases rond premultiplication, clipping, fill opacity, group isolation en HDR moeten worden getest.

---

## 8. Pixeldata per laag

### 8.1 Beschikbare vormen

- `layer.canvas`
- `layer.imageData`
- `layer.rawData`

`PixelData`:

```ts
interface PixelData {
  data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;
  width: number;
  height: number;
}
```

### 8.2 Aanbevolen Lighttable-pad

Gebruik `useImageData: true` en upload de typed array direct naar de decode/upload-pipeline.

Redenen:

- vermijdt browser-canvas alpha-premultiplication;
- behoudt 16-bit/32-bit data;
- voorkomt een onnodige canvas roundtrip;
- maakt exacte roundtrip-tests mogelijk;
- geeft betere controle over kleurconversie.

### 8.3 Premultiplied alpha

Canvas kan RGB-waarden van semi-transparante pixels wijzigen door alpha-premultiplication en terugconversie. Voor read-modify-write kan dit zichtbare of numerieke corruptie veroorzaken.

Lighttable moet intern expliciet vastleggen:

- of textures straight of premultiplied alpha bevatten;
- op welk punt premultiplication plaatsvindt;
- hoe PSD straight-alpha pixeldata wordt geconverteerd;
- hoe export terug naar PSD-pixelkanalen gebeurt.

### 8.4 Pregenerated previews

Tekst-, vector- en Smart Object-lagen bevatten meestal een pregenerated rasterbitmap. Deze moet worden bewaard als:

- visuele fallback;
- referentie voor parity-tests;
- placeholder wanneer fonts/assets/filters ontbreken;
- bron voor unsupported semantische features.

---

## 9. Bitmap masks en real masks

Een laag kan zowel `mask` als `realMask` bevatten.

```ts
interface LayerMaskData {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
  defaultColor?: number;
  disabled?: boolean;
  positionRelativeToLayer?: boolean;
  fromVectorData?: boolean;

  userMaskDensity?: number;
  userMaskFeather?: number;
  vectorMaskDensity?: number;
  vectorMaskFeather?: number;

  canvas?: HTMLCanvasElement;
  imageData?: PixelData;
}
```

Ondersteunde maskconcepten:

- user layer mask;
- real user mask;
- eigen bounds en offsets;
- default background color;
- enabled/disabled;
- gekoppeld aan layerpositionering of documentpositionering;
- gegenereerd vanuit vectordata;
- user mask density;
- user mask feather;
- vector mask density;
- vector mask feather;
- mask pixeldata;
- gelijktijdig bitmap- en vectormaskgebruik.

### 9.1 Lighttable parity-eisen

- bewaar mask bounds los van layer bounds;
- respecteer `positionRelativeToLayer`;
- pas density en feather nondestructief toe;
- onderscheid user mask en real mask;
- toon disabled masks zonder data te verwijderen;
- behoud originele maskpixels zolang de mask niet wordt gewijzigd;
- genereer nieuwe 8-bit maskdata bij PSD-export.

---

## 10. Vector masks en shape layers

### 10.1 Vector mask

```ts
interface LayerVectorMask {
  invert?: boolean;
  notLink?: boolean;
  disable?: boolean;
  fillStartsWithAllPixels?: boolean;
  clipboard?: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    resolution: number;
  };
  paths: BezierPath[];
}
```

Een path bevat:

```ts
interface BezierPath {
  open: boolean;
  operation?: 'exclude' | 'combine' | 'subtract' | 'intersect';
  knots: BezierKnot[];
  fillRule: 'even-odd' | 'non-zero';
}
```

Een knot bevat gekoppelde of losse Bezierhandles:

```ts
interface BezierKnot {
  linked: boolean;
  points: number[]; // handle-in, anchor, handle-out
}
```

### 10.2 Vector fills

`vectorFill` kan zijn:

- solid color;
- solid gradient;
- noise gradient;
- pattern reference.

Gradientdata kan bevatten:

- naam;
- smoothness;
- color stops;
- opacity stops;
- style: linear, radial, angle, reflected, diamond;
- scale;
- angle;
- dither;
- interpolation method: classic, perceptual, linear, smooth;
- reverse;
- align;
- offset;
- noise-gradient roughness, model, seed en channel ranges.

### 10.3 Vector strokes

`vectorStroke` ondersteunt:

- stroke enabled;
- fill enabled;
- line width;
- dash offset;
- miter limit;
- cap: butt, round, square;
- join: miter, round, bevel;
- alignment: inside, center, outside;
- scale lock;
- stroke adjust;
- dash set;
- blend mode;
- opacity;
- color, gradient of pattern content;
- resolution.

### 10.4 Vector origination

`vectorOrigination.keyDescriptorList` kan shape-origininformatie bevatten:

- rounded-rectangle radii;
- shape bounding box;
- box corners;
- transformmatrix;
- origin type en resolution.

### 10.5 Beperkingen

- `pathList` is niet uitgewerkt;
- patterncontent is slechts gedeeltelijk ondersteund;
- niet iedere moderne Photoshop shape-property is gemodelleerd;
- `ag-psd` rasteriseert shapes niet;
- Lighttable moet zelf fill rule, boolean operations, stroke alignment en gradients renderen;
- voor unsupported cases moet de Photoshop-rasterpreview worden behouden.

---

## 11. Tekstlagen

Tekst is semantisch rijk, maar behoort tot de risicovollere roundtripgebieden.

### 11.1 Basisdata

```ts
interface LayerTextData {
  text: string;
  transform?: number[];
  antiAlias?: AntiAlias;
  gridding?: 'none' | 'round';
  orientation?: 'horizontal' | 'vertical';
  index?: number;
  warp?: Warp;

  top?: number;
  left?: number;
  bottom?: number;
  right?: number;

  style?: TextStyle;
  styleRuns?: TextStyleRun[];
  paragraphStyle?: ParagraphStyle;
  paragraphStyleRuns?: ParagraphStyleRun[];

  shapeType?: 'point' | 'box';
  pointBase?: number[];
  boxBounds?: number[];
  bounds?: UnitsBounds;
  boundingBox?: UnitsBounds;

  textPath?: TextPath; // read-only
}
```

### 11.2 Transform en layout

Ondersteund/uitgelezen:

- 2D transformmatrix `[xx, xy, yx, yy, tx, ty]`;
- point text;
- box/paragraph text;
- layer bounds;
- text bounds;
- bounding box;
- point base;
- box bounds;
- horizontal/vertical orientation;
- fractional glyph widths;
- text grid-informatie;
- text warp;
- tekst op pad, read-only en onvolledig.

### 11.3 Anti-aliasing

Mogelijke waarden:

- none;
- sharp;
- crisp;
- strong;
- smooth;
- platform;
- platformLCD.

### 11.4 Fontdata

```ts
interface Font {
  name: string;
  script?: number;
  type?: number;
  synthetic?: number;
}
```

De PSD bevat niet noodzakelijk het fontbestand. Lighttable moet font-resolutie beheren:

1. exact PostScript/full font name;
2. lokale font match;
3. project-embedded font indien toegestaan;
4. substitution fallback;
5. raster-preview fallback.

### 11.5 Character style

`TextStyle` kan bevatten:

- font;
- font size;
- faux bold;
- faux italic;
- auto leading;
- leading;
- horizontal scale;
- vertical scale;
- tracking;
- auto kerning;
- kerning;
- baseline shift;
- small caps / all caps;
- normal / superscript / subscript baseline;
- underline;
- strikethrough;
- ligatures;
- discretionary ligatures;
- baseline direction;
- tsume;
- style-run alignment;
- language ID;
- no-break;
- fill color;
- stroke color;
- fill/stroke flags;
- fill-first;
- underline offset;
- outline width;
- character direction;
- Hindi numbers;
- kashida;
- diacritic position.

### 11.6 Style runs

`styleRuns` geeft karakterranges met verschillende styles. Elke run bevat een lengte en een `TextStyle`.

Lighttable moet Unicode-indexering zorgvuldig testen. PSD-runs kunnen gebaseerd zijn op UTF-16 code units; JavaScript string indexing en grapheme clusters zijn niet hetzelfde.

### 11.7 Paragraph style

Ondersteunde velden zijn onder meer:

- justification: left, right, center en justify-varianten;
- first line indent;
- start/end indent;
- space before/after;
- auto hyphenate;
- hyphenated word size;
- pre/post hyphen;
- consecutive hyphens;
- hyphenation zone;
- word spacing;
- letter spacing;
- glyph spacing;
- auto leading;
- leading type;
- hanging;
- burasagari;
- kinsoku order;
- every-line composer.

### 11.8 Warp

Beschikbare warp styles:

```text
none, arc, arcLower, arcUpper, arch, bulge,
shellLower, shellUpper, flag, wave, fish, rise,
fisheye, inflate, squeeze, twist, custom, cylinder
```

Warpdata kan bevatten:

- value(s);
- perspective;
- secondary perspective;
- rotation/orientation;
- bounds;
- custom envelope orders;
- rows en columns;
- quilt slices;
- custom mesh points.

### 11.9 Text path

`textPath` wordt uit engine data gehaald, maar is expliciet read-only en incompleet. Het kan onder meer bevatten:

- Bezier control points;
- frame matrix;
- text range;
- gutters;
- baseline alignment;
- reverse en spacing;
- UUID.

### 11.10 Kritieke beperkingen

- predefined Photoshop Character Styles worden niet ondersteund;
- predefined Paragraph Styles worden niet ondersteund;
- verticale tekst schrijven/updaten kan een beschadigd PSD-bestand opleveren;
- text engine data is niet volledig gemodelleerd;
- `engineData` wordt deels als Base64 raw data bewaard om bestaande tekstlagen niet te breken;
- `textPath`-wijzigingen worden niet opgeslagen;
- `ag-psd` rendert geen nieuwe text bitmap;
- een nieuwe of aangepaste tekstlaag kan Photoshop bij openen om **Update** laten vragen;
- `invalidateTextLayers: true` forceert Photoshop om tekst opnieuw te rasteriseren, maar is geen vervanging voor eigen previewgeneratie.

### 11.11 Aanbevolen Lighttable-strategie

Bewaar per tekstlaag drie representaties:

1. **semantic text model** — voor Lighttable editing;
2. **original ag-psd text payload + raw engineData** — voor roundtrip/preservation;
3. **raster fallback** — oorspronkelijke Photoshop-preview.

Bij export:

- genereer een actuele rasterpreview vanuit de Lighttable-text renderer;
- schrijf semantische textdata waar betrouwbaar;
- behoud raw engine data alleen wanneer de tekststructuur niet fundamenteel is gewijzigd;
- gebruik `invalidateTextLayers` wanneer Photoshop-herinterpretatie nodig is;
- blokkeer of rasterize verticale/path-text edits totdat roundtriptests slagen.

---

## 12. Adjustment layers

`ag-psd` heeft getypeerde ondersteuning voor de volgende adjustment layers:

| Adjustment | Belangrijkste data |
|---|---|
| Brightness/Contrast | brightness, contrast, mean value, legacy, Lab-only, auto |
| Levels | RGB, red, green en blue channels; input black/white, gamma, output black/white |
| Curves | punten per RGB/red/green/blue channel |
| Exposure | exposure, offset, gamma |
| Vibrance | vibrance, saturation |
| Hue/Saturation | master plus reds, yellows, greens, cyans, blues, magentas; hue/saturation/lightness en rangegrenzen |
| Color Balance | shadows, midtones, highlights; cyan-red, magenta-green, yellow-blue; preserve luminosity |
| Black & White | zes kleurgewichten, tint on/off, tint color |
| Photo Filter | color, density, preserve luminosity |
| Channel Mixer | monochrome, red/green/blue/gray output channels en constant |
| Color Lookup | lookup type, profiledata, LUT format, RGB/BGR order, embedded LUT bytes en filename |
| Invert | type zonder parameters |
| Posterize | levels |
| Threshold | threshold level |
| Gradient Map | solid/noise gradient, stops, dither, reverse, interpolation, roughness, seed, ranges |
| Selective Color | relative/absolute; CMYK-correcties voor kleuren, whites, neutrals en blacks |

### 12.1 Color Lookup/LUT

Beschikbare LUT-data kan bevatten:

- lookup type: `3dlut`, `abstractProfile`, `deviceLinkProfile`;
- naam;
- dither;
- profielbytes;
- LUT-format: `look`, `cube`, `3dl`;
- data order en table order;
- embedded LUT-filebytes;
- LUT-filename.

Dit sluit goed aan op Lighttable's bestaande LUT/node-architectuur.

### 12.2 Rendering

`ag-psd` voert geen enkele adjustment uit. Lighttable moet voor iedere adjustment:

- parametersemantiek reproduceren;
- kanaal- en kleurspacegedrag reproduceren;
- mask en clipping toepassen;
- opacity en blend mode toepassen;
- group isolation respecteren;
- 8-bit, 16-bit en float input testen;
- vergelijken met Photoshop reference renders.

### 12.3 Parityprioriteit

**P0:** Levels, Curves, Exposure, Hue/Saturation, Vibrance, Color Balance, Black & White, LUT, Invert.

**P1:** Brightness/Contrast legacy/modern, Gradient Map, Channel Mixer, Photo Filter, Selective Color.

**P2:** exact Photoshop auto-behavior en obscure preset metadata.

---

## 13. Layer effects / Blending Options

`layer.effects` ondersteunt:

- meerdere Drop Shadows;
- meerdere Inner Shadows;
- Outer Glow;
- Inner Glow;
- Bevel & Emboss;
- meerdere Color Overlays (`solidFill`);
- Satin;
- meerdere Strokes;
- meerdere Gradient Overlays;
- Pattern Overlay metadata, beperkt.

### 13.1 Gemeenschappelijke effectvelden

Veel effecten bevatten:

- `present`;
- `showInDialog`;
- `enabled`;
- blend mode;
- opacity;
- color;
- size;
- angle;
- distance;
- contour;
- antialias;
- choke/spread;
- noise;
- range;
- jitter;
- use global light.

### 13.2 Drop/Inner Shadow

- size;
- angle;
- distance;
- color;
- blend mode;
- opacity;
- global light;
- antialias;
- contour;
- choke/spread;
- layer conceals, voor drop shadow.

### 13.3 Outer/Inner Glow

- size;
- color;
- blend mode;
- opacity;
- source edge/center;
- technique softer/precise, voor inner glow;
- antialias;
- noise;
- range;
- choke;
- jitter;
- contour.

### 13.4 Bevel & Emboss

- size;
- angle;
- depth/strength;
- highlight en shadow blend modes;
- highlight en shadow colors;
- style: outer bevel, inner bevel, emboss, pillow emboss, stroke emboss;
- highlight/shadow opacity;
- soften;
- global light;
- altitude;
- technique: smooth, chisel hard, chisel soft;
- direction up/down;
- texture/shape flags;
- gloss antialias;
- contour.

Texture-informatie is niet volledig genoeg voor volledige Bevel Texture-parity.

### 13.5 Color Overlay

- enabled;
- blend mode;
- color;
- opacity.

### 13.6 Satin

- size;
- blend mode;
- color;
- antialias;
- opacity;
- distance;
- invert;
- angle;
- contour.

### 13.7 Stroke

- size;
- inside/center/outside;
- fill type color/gradient/pattern;
- blend mode;
- opacity;
- color;
- gradientdata;
- patternreference.

### 13.8 Gradient Overlay

- blend mode;
- opacity;
- align;
- scale;
- dither;
- reverse;
- style;
- offset;
- solid/noise gradient;
- interpolation method;
- angle.

### 13.9 Meerdere effects

Nieuwere Photoshop-versies staan meerdere instanties toe van:

- drop shadow;
- inner shadow;
- color overlay;
- stroke;
- gradient overlay.

De arrays en volgorde moeten behouden blijven. Export van meerdere instanties gebruikt een nieuwere effects-sectie die niet door zeer oude Photoshop-versies wordt gelezen.

### 13.10 Pattern Overlay

De effectstructuur kan naam/ID/reference-data bevatten, maar volledige Pattern Overlay-rendering en roundtrip zijn niet betrouwbaar. Behandel als:

- read/preserve metadata;
- raster fallback;
- later implementeren nadat pattern resource parsing stabiel is.

---

## 14. Patterns

Patternondersteuning is gedeeltelijk en momenteel intern inconsistent gedocumenteerd.

De actuele hoofd-README meldt ondersteuning voor document-level:

- `Patt`;
- `Pat2`;
- `Pat3`;

voor:

- raw- of RLE-compressed patterns;
- RGB patterns;
- Grayscale patterns.

Niet ondersteund of onbetrouwbaar:

- ZIP-compressed patterns, die veel echte Photoshop-bestanden gebruiken;
- Indexed patterns;
- 16-bit patterns;
- volledige Pattern Overlay-rendering;
- volledige pattern descriptorsemantiek;
- alle pattern fills/strokes lossless roundtrip.

`PatternInfo` bevat ten minste:

```ts
interface PatternInfo {
  name: string;
  id: string;
  x: number;
  y: number;
  bounds: { x: number; y: number; w: number; h: number };
  data: Uint8Array;
}
```

**Paritystrategie:** patterns voorlopig als optionele assetresource importeren, originele bytes bewaren en visueel terugvallen op de layer preview wanneer decoding of rendering niet betrouwbaar is.

---

## 15. Smart Objects

Een Smart Object-laag heeft `placedLayer` en verwijst via `id` naar `psd.linkedFiles`.

### 15.1 Placed layer data

```ts
interface PlacedLayer {
  id: string;
  placed?: string;
  type: 'unknown' | 'vector' | 'raster' | 'image stack';

  pageNumber?: number;
  totalPages?: number;
  frameStep?: Fraction;
  duration?: Fraction;
  frameCount?: number;

  transform: number[];
  nonAffineTransform?: number[];
  width?: number;
  height?: number;
  resolution?: UnitsValue;
  warp?: Warp;
  crop?: number;
  comp?: number;
  compInfo?: { compID: number; originalCompID: number };
  filter?: PlacedLayerFilter;
}
```

### 15.2 Transforms

- `transform`: x/y voor de vier hoeken;
- `nonAffineTransform`: alternatieve/perspectivische vierhoek;
- source width/height;
- source resolution;
- warp;
- crop;
- Smart Object comp selection.

Lighttable moet hiermee affine, projective en warped transforms kunnen reconstrueren.

### 15.3 Embedded en linked bestanden

```ts
interface LinkedFile {
  id: string;
  name: string;
  type?: string;
  creator?: string;
  data?: Uint8Array;
  time?: string;
  childDocumentID?: string;
  assetModTime?: number;
  assetLockedState?: number;
  linkedFile?: {
    fileSize: number;
    name: string;
    fullPath: string;
    originalPath: string;
    relativePath: string;
  };
}
```

Mogelijkheden:

- embedded bestandbytes extraheren;
- externe linkpaths uitlezen;
- linked asset metadata bewaren;
- geneste PSD/PSB als child document herkennen;
- Smart Object compinformatie bewaren.

### 15.4 Aanbevolen Lighttable-model

Bewaar:

- `sourceKind: embedded | linked | missing`;
- oorspronkelijke bytes;
- MIME/type-detectie;
- originele filename en paths;
- content hash;
- source dimensions/resolution;
- editable nested Lighttable-document wanneer decodebaar;
- transform en warp apart;
- cached raster preview;
- Smart Filters als node stack.

### 15.5 Smart Object roundtrip

Voor volledige roundtrip moet Lighttable:

- embedded bytes ongewijzigd kunnen bewaren;
- ID/GUID-relaties intact houden;
- actuele placed-layer preview renderen;
- transform- en warpdata correct schrijven;
- linked-vs-embedded semantics niet ongemerkt wijzigen;
- nested PSD-bewerkingen terug serialiseren naar nieuwe embedded bytes.

---

## 16. Smart Filters

`placedLayer.filter` bevat globale filterstackflags en een lijst filters.

```ts
interface PlacedLayerFilter {
  enabled: boolean;
  validAtPosition: boolean;
  maskEnabled: boolean;
  maskLinked: boolean;
  maskExtendWithWhite: boolean;
  list: Filter[];
}
```

Iedere filter heeft daarnaast:

- name;
- opacity;
- blend mode;
- enabled;
- hasOptions;
- foreground color;
- background color.

### 16.1 Getypeerde Smart Filter-varianten

De actuele types modelleren ten minste:

#### Blur

- Average
- Blur
- Blur More
- Box Blur
- Gaussian Blur
- Motion Blur
- Radial Blur
- Shape Blur
- Smart Blur
- Surface Blur

#### Distort

- Displace
- Pinch
- Polar Coordinates
- Ripple
- Shear
- Spherize
- Twirl
- Wave
- ZigZag

#### Noise

- Add Noise
- Despeckle
- Dust & Scratches
- Median
- Reduce Noise

#### Pixelate

- Color Halftone
- Crystallize
- Facet
- Fragment
- Mezzotint
- Mosaic
- Pointillize

#### Render

- Clouds
- Difference Clouds
- Fibers
- Lens Flare

`Lighting Effects` staat als niet-actieve/commented typecode en moet als unsupported worden beschouwd.

#### Sharpen

- Sharpen
- Sharpen Edges
- Sharpen More
- Smart Sharpen
- Unsharp Mask

#### Stylize

- Diffuse
- Emboss
- Extrude
- Find Edges
- Solarize
- Tiles
- Trace Contour
- Wind

#### Video / Other

- De-Interlace
- NTSC Colors
- Custom convolution
- High Pass
- Maximum
- Minimum
- Offset

#### Deformation en speciale filters

- Puppet Warp
- Oil Paint plugin descriptor
- HSB/HSL
- Oil Paint
- Liquify, als opaque meshbytes
- Perspective Warp

#### Adjustment-achtige Smart Filters

- Curves
- Invert
- Brightness/Contrast

### 16.2 Niet-actieve/onvolledige filtertypes in de bron

De volgende zijn als commented/TODO zichtbaar en dus niet als ondersteund beschouwen:

- Lighting Effects;
- Lens Correction;
- Adaptive Wide Angle;
- Filter Gallery als generiek compleet model;
- 3D-lightingstructuren.

### 16.3 Belangrijke nuance

Een getypeerde filter betekent dat parameters kunnen worden gelezen/geschreven, niet dat:

- iedere Photoshop-versie exact hetzelfde descriptorformaat gebruikt;
- alle filteropties zijn gemodelleerd;
- Lighttable het filter al kan renderen;
- export visueel identiek is;
- onbekende pluginfilters behouden blijven.

### 16.4 Lighttable-strategie

Map ondersteunde Smart Filters naar dezelfde algemene node-interface die later ook voor Resolve-achtige grading kan worden gebruikt:

```ts
interface EffectNode {
  id: string;
  type: string;
  enabled: boolean;
  opacity: number;
  blendMode: BlendMode;
  params: unknown;
  mask?: MaskReference;
  sourceFormat?: 'photoshop-smart-filter';
  originalPayload?: unknown;
}
```

Implementeer eerst filters die al passen bij de bestaande GPU-pipeline:

**P0:** Gaussian Blur, Box Blur, Motion Blur, Median, High Pass, Offset, Curves, Invert, Brightness/Contrast.

**P1:** Smart Sharpen, Unsharp Mask, Add Noise, Dust & Scratches, Surface Blur, Mosaic, Emboss, Displace.

**P2:** Liquify, Puppet, Perspective Warp, Oil Paint en pluginfilters.

---

## 17. Artboards

### 17.1 Document-level artboardsettings

```ts
psd.artboards = {
  count,
  autoExpandOffset,
  origin,
  autoExpandEnabled,
  autoNestEnabled,
  autoPositionEnabled,
  shrinkwrapOnSaveEnabled,
  docDefaultNewArtboardBackgroundColor,
  docDefaultNewArtboardBackgroundType,
};
```

### 17.2 Layer-level artboarddata

```ts
layer.artboard = {
  rect,
  guideIndices,
  presetName,
  color,
  backgroundType,
};
```

### 17.3 Lighttable parity

- artboards als speciale group/canvas nodes modelleren;
- eigen local coordinate system bewaren;
- background type en color bewaren;
- artboard guides koppelen;
- auto-nest en auto-position alleen uitvoeren wanneer expliciet ondersteund;
- export count en layer artboarddata consistent houden.

---

## 18. Layer comps

Documentniveau:

```ts
psd.imageResources.layerComps = {
  list: [{ id, name, comment, capturedInfo }],
  lastApplied,
};
```

Per laag kan `layer.comps.settings` bevatten:

- enabled/visibility;
- comp list;
- offset;
- effects reference point.

Captured info flags:

- visibility;
- position;
- appearance.

### Lighttable parity

Layer comps kunnen direct vertaald worden naar document snapshots die alleen specifieke properties overschrijven. Bewaar IDs en captured flags exact; genereer geen volledige duplicaatdocumenten.

---

## 19. Animatie, timeline en video

De hoofd-README noemt animatie nog als beperking, maar changelog en actuele types bevatten read/write-ondersteuning voor meerdere animatiestructuren. Behandel dit als **gedeeltelijk en testplichtig**, niet als volledig Photoshop-parity.

### 19.1 Frame animation

Documentresources kunnen bevatten:

- frame IDs;
- delay;
- dispose mode;
- animation sets;
- frame order;
- repeats;
- active frame;
- onion skin settings.

Per laag:

- frames waarop modifiers van toepassing zijn;
- enable/visibility;
- offset;
- reference point;
- opacity;
- effects.

### 19.2 Timeline

Timeline data kan bevatten:

- start;
- duration;
- in/out time;
- frame rate en frame step;
- work area;
- repeats;
- tracks;
- audio level;
- opacity keys;
- position keys;
- transform keys;
- style keys;
- global-lighting keys;
- linear/hold interpolation.

### 19.3 Audio/video metadata

Image resources en layers kunnen metadata bevatten voor:

- audio clip groups;
- clip timing;
- muted/audio level;
- media descriptor;
- linked mediapaths;
- video pixel source;
- alpha interpretation;
- source profile;
- frame reader information.

`ag-psd` is geen video-decoder. Dit is hoofdzakelijk metadata-preservation.

### 19.4 Lighttablestatus

Voor huidige layered-image parity:

- importeren en bewaren;
- niet tonen als normale pixel layer zonder expliciete video-layerondersteuning;
- fallback naar beschikbare rasterframe-preview;
- onbekende timelinevelden niet muteren;
- export pas claimen na Photoshop roundtriptests.

---

## 20. Document image resources

`psd.imageResources` kan onder meer bevatten:

### 20.1 Document- en applicatie-informatie

- `versionInfo`;
- `layerState`;
- `layerSelectionIds`;
- `idsSeedNumber`;
- `copyrighted`;
- document `url`.

### 20.2 Alpha en channels

- `alphaIdentifiers`;
- `alphaChannelNames`.

### 20.3 Global lighting

- `globalAngle`;
- `globalAltitude`.

Dit is relevant voor layer effects die global light gebruiken.

### 20.4 Pixel en physical dimensions

- `pixelAspectRatio`;
- `resolutionInfo` met PPI/PPCM en physical units.

### 20.5 Grid en guides

- grid horizontal/vertical spacing;
- guides;
- guide position;
- horizontal/vertical direction.

### 20.6 Thumbnail

- decoded `thumbnail` canvas;
- `thumbnailRaw` bytes;
- automatische thumbnailgeneratie bij schrijven.

### 20.7 Metadata

- `captionDigest`;
- `xmpMetadata`;
- `iccUntaggedProfile` flag;
- `backgroundColor`;
- `pathSelectionState`;
- ImageReady variables;
- ImageReady datasets.

Let op: een volledig ICC-profiel als documentresource is niet hetzelfde als de `iccUntaggedProfile` boolean. Verifieer kleurprofielgedrag met echte testbestanden; claim geen volledig color-managed PSD-roundtrip alleen op basis van dit veld.

### 20.8 Printdata

- print scale;
- printer manages colors;
- printer name/profile;
- 16-bit print flag;
- rendering intent;
- hard proof;
- black point compensation;
- proof setup;
- labels;
- crop marks;
- color bars;
- registration marks;
- negative;
- flip;
- interpolation;
- caption.

### 20.9 URLs en slices

- URL list;
- slice bounds;
- slice groups;
- generated/user/layer origin;
- associated layer ID;
- name en type;
- target/message/alt tag;
- HTML cell text;
- background settings;
- outsets.

### 20.10 Count tool

- count group color;
- name;
- marker size;
- font size;
- visibility;
- point positions.

### 20.11 Annotations

Top-level annotations kunnen bevatten:

- text of sound type;
- open status;
- icon location;
- popup location;
- color;
- author;
- name;
- date;
- textdata of soundbytes.

Sound annotations zijn niet betrouwbaar ondersteund als editable feature. Tekstannotations kunnen als documentnotities worden geïmporteerd.

---

## 21. Andere layer additional-info

Naast de hoofdfeatures kan een laag bevatten:

- `filterMask`;
- `sectionDivider`;
- `compositorUsed` met Photoshop/engine/GPU metadata;
- `usingAlignedRendering`;
- `channelBlendingRestrictions`;
- `animationFrameFlags`;
- `filterEffectsMasks` met raw channeldata;
- `userMask` display color en opacity;
- `vowv`, onbekend;
- `pixelSource` voor video;
- raw Base64 `engineData`.

Deze velden moeten standaard worden bewaard in een `photoshopMetadata`-namespace in het Lighttable-document, ook wanneer de UI ze nog niet exposeert.

---

## 22. Kleurobjecten en units

### 22.1 Kleurobjecten

PSD-descriptors kunnen kleuren in meerdere modellen bevatten:

```ts
type Color =
  | { r: number; g: number; b: number; a: number }
  | { r: number; g: number; b: number }
  | { fr: number; fg: number; fb: number }
  | { h: number; s: number; b: number }
  | { c: number; m: number; y: number; k: number }
  | { l: number; a: number; b: number }
  | { k: number };
```

Dit betekent niet dat CMYK/Lab-documenten worden ondersteund; alleen descriptorvelden kunnen die kleurmodellen gebruiken.

Lighttable moet:

- het oorspronkelijke kleurmodel bewaren;
- voor rendering naar de working space converteren;
- bij ongewijzigde export het oorspronkelijke model terugschrijven;
- bij edit een expliciete conversiepolicy hanteren.

### 22.2 Unit values

```ts
interface UnitsValue {
  units: 'Pixels' | 'Points' | 'Picas' | 'Millimeters' |
         'Centimeters' | 'Inches' | 'None' | 'Density';
  value: number;
}
```

Bewaar units semantisch. Niet alle pixelwaardes vooraf flattenen, omdat document resolution en physical units anders verloren gaan.

---

## 23. Wat `ag-psd` niet doet

### 23.1 Geen compositor

De library berekent niet:

- layer order-resultaat;
- group compositing;
- clipping;
- blend modes;
- Blend If;
- adjustments;
- masks;
- fill opacity;
- effects;
- text;
- vector shapes;
- Smart Object-content;
- filters.

### 23.2 Geen automatische layer preview

Bij wijzigingen aan:

- text;
- vector content;
- Smart Objects;
- layer pixeldata;
- masks;
- properties die de eigen layerbitmap veranderen;

moet Lighttable `layer.imageData` opnieuw genereren.

Blend modes en layer effects horen normaal niet in de eigen layer bitmap te worden ingebakken, maar wel in de document composite.

### 23.3 Geen automatische document composite

Na:

- reorder;
- add/remove;
- visibility;
- opacity;
- clipping;
- blend mode;
- adjustments;
- effects;
- pixelwijzigingen;

moet `psd.imageData` opnieuw worden gegenereerd of verwijderd.

### 23.4 Geen automatische thumbnail

Gebruik:

- eigen thumbnail, of
- `generateThumbnail: true` op basis van een actuele composite.

### 23.5 Onbekende blocks worden niet lossless bewaard

Unhandled image resources en additional-info-secties worden doorgaans overgeslagen. Ze worden niet automatisch als opaque blobs in het uitgaande bestand teruggezet.

Daarom is een willekeurige moderne PSD openen en opnieuw opslaan **niet gegarandeerd lossless**, ook wanneer Lighttable niets zichtbaar wijzigt.

Dit is een van de grootste roundtriprisico's.

---

## 24. Bekende beperkingen en risicogebieden

### 24.1 Hard of fundamenteel

- schrijven uitsluitend 8-bit RGB;
- geen CMYK, Lab, Multichannel of Duotone documentimport;
- geen high-bit-depth PSD-output;
- onbekende Photoshop-blokken worden niet generiek bewaard;
- geen ingebouwde renderer;
- geen volledige color-managementpipeline;
- geen volledige 3D-featureondersteuning.

### 24.2 Gedeeltelijk

- 32-bit input;
- Indexed-mode roundtrip;
- patterns;
- Pattern Overlay;
- text engine;
- vertical text;
- text on path;
- Character/Paragraph Styles;
- Smart Filters;
- pluginfilters;
- video/timeline;
- modern Photoshop metadata;
- obscure blending/compositor flags;
- zeer grote PSB-bestanden.

### 24.3 Data-lossrisico bij roundtrip

- unsupported additional info;
- unsupported image resources;
- nieuwe Photoshop-features;
- onbekende Smart Filter descriptors;
- pattern resources;
- text engine internals na semantische edit;
- linked assets die niet beschikbaar zijn;
- kleurprofielinformatie;
- high-bit-depth pixeldata bij export.

---

## 25. Aanbevolen Lighttable canonical document model

Gebruik niet rechtstreeks het mutable `ag-psd` object als intern documentmodel. Maak een eigen canonieke laag met import/export-adapters.

```ts
interface LtDocument {
  id: string;
  width: number;
  height: number;
  workingColorSpace: string;
  sourceBitDepth: 1 | 8 | 16 | 32;
  internalPrecision: 'rgba8' | 'rgba16f' | 'rgba32f';

  layers: LtLayer[];
  assets: LtAssetRegistry;
  artboards?: LtArtboard[];
  guides?: LtGuide[];
  layerComps?: LtLayerComp[];
  timeline?: LtTimeline;

  photoshop?: {
    sourceFormat: 'psd' | 'psb';
    sourceColorMode: number;
    originalImageResources?: unknown;
    unsupportedFeatureReport: UnsupportedFeature[];
  };
}
```

### 25.1 Laagmodel

```ts
interface LtLayerBase {
  id: string;
  psdLayerId?: number;
  name: string;
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: string;
  clipping: boolean;
  bounds: Rect;
  locks: LayerLocks;
  masks: LtMask[];
  effects: LtEffect[];
  blendIf?: LtBlendIf;
  linkedGroup?: number;
  photoshop?: unknown;
  fallbackPreview?: PixelResource;
}
```

Concrete types:

- pixel;
- group;
- text;
- vector shape;
- adjustment;
- Smart Object;
- video/special;
- unsupported-preserved.

### 25.2 Drie representatieniveaus

Voor complexe lagen:

1. **editable semantic state**;
2. **original Photoshop payload**;
3. **raster fallback/cached preview**.

Dit maakt progressive parity mogelijk zonder documenten direct visueel te breken.

---

## 26. Importpipeline

### Fase 1 — Safe header/structure parse

- gebruik Web Worker;
- parse raw data;
- controleer limieten;
- verzamel layer tree en metadata;
- rapporteer unsupported blocks;
- decode nog niet alle pixels.

### Fase 2 — Feature classification

Per laag:

- bepaal semantisch type;
- bepaal exact editable niveau;
- bepaal rendererbeschikbaarheid;
- bepaal fallbackbehoefte;
- registreer assets en fonts;
- registreer warnings.

### Fase 3 — Lazy pixel decode

Prioriteit:

1. composite preview;
2. zichtbare lagen in viewport;
3. thumbnails;
4. masks;
5. verborgen lagen on demand;
6. embedded Smart Objects on demand.

### Fase 4 — Canonical mapping

- normaliseer fields;
- behoud originele units en colors;
- behoud source payload;
- zet PSD IDs om naar stabiele Lighttable IDs;
- map adjustments/effects/filters naar node types;
- bouw dependency graph voor clipping en Smart Objects.

### Fase 5 — Parity validation

Render Lighttable composite en vergelijk met PSD composite:

- absolute/relative pixel difference;
- perceptual difference;
- alpha difference;
- edge-specific difference;
- per-layer debug difference.

Wanneer verschil boven threshold ligt:

- markeer document/laag als partial parity;
- toon oorspronkelijke composite als optionele reference;
- laat gebruiker unsupported features inspecteren.

---

## 27. Exportpipeline

### Fase 1 — Capability audit

Voor export bepalen:

- doel PSD of PSB;
- 8-bit RGB-conversie nodig;
- unsupported editable features;
- fonts missing;
- linked assets missing;
- patterns unsupported;
- unknown metadata die verloren gaat;
- text/vector/Smart Object previewstatus.

### Fase 2 — Render caches actualiseren

Genereer:

- actuele pixel layer buffers;
- text layer previews;
- vector layer previews;
- Smart Object previews;
- masks;
- volledige document composite;
- thumbnail.

### Fase 3 — ag-psd object opbouwen

Map canonical state terug naar:

- `Psd`;
- `Layer[]`;
- image resources;
- linked files;
- artboards;
- semantische layerdata;
- previews.

### Fase 4 — Schrijven

Aanbevolen standaard:

```ts
writePsdUint8Array(psd, {
  psb: needsPsb,
  generateThumbnail: true,
  trimImageData: true,
  noBackground: true,
  compress: false,
  invalidateTextLayers: changedTextNeedsPhotoshopRefresh,
  logMissingFeatures: true,
});
```

### Fase 5 — Roundtrip verification

Lees het uitgaande bestand direct opnieuw in en verifieer:

- layer count/tree;
- IDs;
- bounds;
- pixel checksums;
- masks;
- semantic properties;
- linked file count/hashes;
- output composite versus Lighttable render.

Voor release-tests daarna ook openen/saven in Photoshop en opnieuw vergelijken.

---

## 28. Paritymatrix voor Lighttable

### 28.1 P0 — noodzakelijk voor bruikbare PSD-workflow

| Feature | Parse | Model | Render | Export | Doel |
|---|---:|---:|---:|---:|---|
| PSD/PSB layer tree | Ja | Bouwen | n.v.t. | Ja | Exact |
| Rasterlayers | Ja | Bouwen | Ja | Ja | Exact |
| Groups | Ja | Bouwen | Ja | Ja | Exact |
| Visibility/opacity | Ja | Bouwen | Ja | Ja | Exact |
| Fill opacity | Ja | Bouwen | Ja | Ja | Exact |
| Basis blend modes | Ja | Bouwen | Bouwen/testen | Ja | Photoshop-match |
| Clipping masks | Ja | Bouwen | Bouwen | Ja | Exact |
| Bitmap masks | Ja | Bouwen | Bouwen | Ja | Exact |
| Layer position/bounds | Ja | Bouwen | Ja | Ja | Exact |
| Layer IDs/names/colors | Ja | Bouwen | UI | Ja | Exact |
| Locks | Ja | Bouwen | UI enforcement | Ja | Exact |
| Composite/thumbnail | Ja | Cache | Bouwen | Ja | Actueel |
| Worker-based safe import | API | Bouwen | n.v.t. | n.v.t. | Productieproof |

### 28.2 P1 — kern Photoshop-parity

| Feature | Prioriteit |
|---|---|
| Alle standaard blend modes | Zeer hoog |
| Group pass-through/isolation | Zeer hoog |
| Blend If / blending ranges | Zeer hoog |
| Adjustment layers | Zeer hoog |
| Textlagen basis | Hoog |
| Vector masks en shape fills/strokes | Hoog |
| Layer effects | Hoog |
| Linked layers | Middel/hoog |
| Advanced blending flags | Middel/hoog |
| Artboards | Middel |
| Layer comps | Middel |

### 28.3 P2 — geavanceerde parity

- Smart Objects;
- nested PSD editing;
- Smart Filters;
- text warps;
- advanced typography;
- patterns;
- multiple effects;
- animation/timeline;
- slices en annotations;
- printmetadata;
- obscure compositor flags.

### 28.4 Buiten scope van volledige PSD-parity zolang `ag-psd` de output niet ondersteunt

- 16-bit PSD-writing;
- 32-bit PSD-writing;
- CMYK-document roundtrip;
- Lab-document roundtrip;
- Multichannel/Duotone;
- volledige unknown-block preservation;
- volledige moderne Photoshop 3D-features.

---

## 29. Photoshop-render parity teststrategie

### 29.1 Golden fixture per feature

Maak één kleine PSD per feature en combinatieset:

- één laag/type/effect per bestand;
- vaste 512 × 512 of 1024 × 1024 dimensies;
- duidelijke gradients, alpha edges en out-of-bounds content;
- Photoshop-generated composite als ground truth;
- exported per-layer PNGs waar nuttig;
- JSON snapshot van relevante `ag-psd` data.

### 29.2 Testdimensies

Test iedere feature met:

- 0%, 50%, 100% opacity;
- fill opacity apart;
- normal en relevante blend modes;
- clipping on/off;
- layer mask on/off;
- group en nested group;
- 8-bit en waar leesbaar 16/32-bit input;
- sRGB en beschikbare profielsituaties;
- negative layer offsets;
- document-edge clipping;
- PSD en PSB;
- Photoshop save → Lighttable import;
- Lighttable export → Photoshop open;
- Photoshop resave → Lighttable re-import.

### 29.3 Visuele vergelijking

Gebruik meerdere metrics:

- exact pixel equality voor pure rasterroundtrip;
- max channel error;
- mean absolute error;
- alpha-only error;
- perceptual ΔE of een perceptuele image metric;
- edge mask error;
- heatmap.

### 29.4 Structurele vergelijking

Snapshot:

- layer tree;
- layer IDs;
- names;
- bounds;
- masks;
- blend modes;
- adjustments;
- effects;
- text runs;
- vector paths;
- linked files;
- image resources.

---

## 30. Aanbevolen testcorpus

Minimaal:

1. raster-only PSD;
2. nested groups met pass-through;
3. iedere blend mode;
4. clipping stacks van 2–5 lagen;
5. bitmap mask + feather/density;
6. vector mask;
7. bitmap + vector mask tegelijk;
8. Blend If split sliders;
9. iedere adjustment layer;
10. iedere layer effect;
11. multiple drop shadows/strokes/overlays;
12. point text;
13. paragraph text;
14. mixed style runs;
15. missing font;
16. vertical text;
17. warped text;
18. text on path;
19. shape fill/stroke/gradient;
20. embedded raster Smart Object;
21. embedded PSD Smart Object;
22. externally linked Smart Object;
23. projective transform;
24. warp;
25. Smart Filter stack;
26. artboards;
27. layer comps;
28. frame animation;
29. video/timeline metadata;
30. Indexed PSD;
31. 16-bit PSD;
32. 32-bit PSD;
33. PSB > 30.000 px in één dimensie;
34. malicious/oversized declarations;
35. PSD met onbekende moderne Photoshop-features.

---

## 31. Feature-loss reporting

Lighttable moet bij import en export een machine-readable rapport genereren:

```ts
interface UnsupportedFeature {
  severity: 'info' | 'warning' | 'lossy' | 'blocking';
  scope: 'document' | 'layer' | 'asset';
  layerId?: string;
  code: string;
  message: string;
  fallback: 'preserved' | 'rasterized' | 'dropped' | 'converted';
}
```

Voorbeelden:

- `PSD_CMYK_UNSUPPORTED`
- `PSD_16BIT_EXPORT_CONVERTED_TO_8BIT`
- `TEXT_VERTICAL_ROUNDTRIP_RISK`
- `TEXT_FONT_MISSING`
- `PATTERN_ZIP_UNSUPPORTED`
- `SMART_FILTER_UNKNOWN_DROPPED`
- `UNKNOWN_ADDITIONAL_INFO_NOT_PRESERVED`
- `PSB_MEMORY_LIMIT`
- `COMPOSITE_REGENERATED`

Deze transparantie is noodzakelijk om niet ten onrechte “PSD-compatible” te claimen bij lossless workflows.

---

## 32. Performance- en veiligheidsarchitectuur

### 32.1 Synchronous parser

PSD-decode is grotendeels synchroon. Doe dit niet op de UI-thread.

Gebruik:

- dedicated Web Worker;
- transferable ArrayBuffers;
- staged/lazy decode;
- duidelijke cancellation boundaries waar mogelijk;
- één of beperkt aantal gelijktijdige PSD-decodes.

### 32.2 Memory

Geschatte RGBA-memory:

```text
8-bit:  width × height × 4 bytes
16-bit: width × height × 8 bytes
32-bit: width × height × 16 bytes
```

Daar komen bij:

- composite;
- alle layer buffers;
- masks;
- temporary decompress buffers;
- GPU textures;
- cached previews;
- embedded Smart Objects.

Decode daarom niet standaard alle lagen tegelijk.

### 32.3 Limits

Configureer productlimieten, bijvoorbeeld:

- maximum document pixels;
- maximum single-layer pixels;
- maximum layer count;
- maximum nesting depth;
- maximum decompressed bytes;
- maximum embedded asset bytes;
- maximum total Smart Object bytes;
- maximum path/point count;
- maximum text length;
- timeout/watchdog via worker termination.

### 32.4 Raw mode

`useRawData` maakt structure-first parsing en gerichte decode mogelijk. Ontwerp de importer rondom dit pad in plaats van de eenvoudige default-read.

---

## 33. Concrete implementatievolgorde

### Milestone A — veilige I/O en raster roundtrip

- worker wrapper;
- safe limits;
- PSD + PSB detection;
- 8-bit rasterlayers;
- groups;
- names, IDs, bounds;
- opacity/visibility;
- masks;
- exact pixel roundtrip;
- composite + thumbnail export;
- unsupported feature report.

### Milestone B — compositor parity

- alle standaard blend modes;
- group pass-through;
- clipping stacks;
- fill opacity;
- Blend If;
- advanced group blending;
- Photoshop golden tests.

### Milestone C — adjustments

- Levels;
- Curves;
- Exposure;
- Hue/Saturation;
- Vibrance;
- Color Balance;
- Black & White;
- LUT;
- overige adjustments.

### Milestone D — text en vector

- text import met fallback;
- font resolution;
- point/box text;
- style runs;
- paragraph styles;
- vector masks;
- shape fills/strokes;
- text/vector preview generation;
- safe export policies.

### Milestone E — layer effects

- shadows;
- glows;
- overlays;
- stroke;
- satin;
- bevel;
- contours;
- multiple effect instances.

### Milestone F — Smart Objects

- embedded/linked asset registry;
- transforms;
- nested PSD;
- warp;
- cached previews;
- basic Smart Filters;
- filter masks.

### Milestone G — document-level parity

- artboards;
- guides;
- layer comps;
- annotations;
- slices;
- animation/timeline preservation;
- patterns;
- advanced metadata.

---

## 34. Definition of Done per feature

Een Photoshop-feature is pas “supported” wanneer:

- [ ] de importer herkent de feature;
- [ ] alle relevante parameters worden gelezen;
- [ ] originele payload/fallback wordt bewaard;
- [ ] het Lighttable-model kan de feature representeren;
- [ ] de UI kan de feature tonen;
- [ ] de UI kan de bedoelde edits uitvoeren;
- [ ] de WebGPU renderer matcht Photoshop binnen afgesproken tolerantie;
- [ ] masks, clipping, opacity en blend modes combineren correct;
- [ ] de layer preview wordt correct gegenereerd;
- [ ] de document composite wordt correct gegenereerd;
- [ ] export schrijft geldige semantische data;
- [ ] export opent zonder fout/warning, behalve expliciet geaccepteerde text-refresh;
- [ ] Photoshop-resave blijft opnieuw importeerbaar;
- [ ] unsupported varianten worden zichtbaar gerapporteerd;
- [ ] performance- en memorylimieten zijn getest.

---

## 35. Belangrijkste architectuurbeslissing

Gebruik `ag-psd` als **codec**, niet als documentengine.

De duurzame architectuur is:

```text
ag-psd adapter
    ↕
Lighttable canonical graph
    ├── layer tree
    ├── pixel resources
    ├── masks
    ├── adjustments/effect nodes
    ├── vector/text nodes
    ├── Smart Object asset graph
    ├── metadata/preservation payload
    └── render caches
         ↓
WebGPU compositor
```

Dit voorkomt dat Photoshop-specifieke objectvormen de interne Lighttable-architectuur dicteren en houdt de deur open voor:

- eigen Lighttable-documentformaat;
- OpenRaster/Krita-import;
- TIFF/EXR high-bit-depth export;
- Resolve-achtige nodegrading;
- video- en 3D-layers;
- niet-Photoshop-specifieke adjustments;
- toekomstige andere PSD-codecs voor features die `ag-psd` mist.

---

## 36. Samenvattende geschiktheid

### Sterk geschikt

- browsergebaseerde PSD/PSB-import;
- rasterlagen en geneste groepen;
- masks;
- layer metadata;
- blend mode-data;
- adjustments;
- effects;
- text/vector/Smart Object-semantiek met fallback;
- 8-bit RGB PSD/PSB-export;
- basis voor progressive Photoshop-parity.

### Alleen geschikt met eigen renderer en testframework

- visuele pariteit;
- text;
- vector shapes;
- adjustments;
- effects;
- Smart Objects;
- Smart Filters;
- Blend If;
- group compositing;
- high-quality roundtrip.

### Niet voldoende als enige oplossing voor volledig lossless Photoshop-roundtrip

- onbekende/new Photoshop features;
- high-bit-depth output;
- CMYK/Lab/Multichannel/Duotone;
- volledige patternondersteuning;
- complete text engine;
- volledige pluginfilterpreservation;
- generieke opaque preservation van onbekende PSD-blokken.

---

## 37. Bronnen

Actuele primaire bronnen:

- Repository: <https://github.com/Agamnentzar/ag-psd>
- Main README: <https://github.com/Agamnentzar/ag-psd/blob/master/README.md>
- PSD object documentation: <https://github.com/Agamnentzar/ag-psd/blob/master/README_PSD.md>
- Type definitions/source model: <https://github.com/Agamnentzar/ag-psd/blob/master/src/psd.ts>
- Reader implementation: <https://github.com/Agamnentzar/ag-psd/blob/master/src/psdReader.ts>
- Writer implementation: <https://github.com/Agamnentzar/ag-psd/blob/master/src/psdWriter.ts>
- Additional-info handlers: <https://github.com/Agamnentzar/ag-psd/blob/master/src/additionalInfo.ts>
- Image-resource handlers: <https://github.com/Agamnentzar/ag-psd/blob/master/src/imageResources.ts>
- Changelog: <https://github.com/Agamnentzar/ag-psd/blob/master/CHANGELOG.md>
- Test fixtures: <https://github.com/Agamnentzar/ag-psd/tree/master/test>

### Documentatie-inconsistenties om rekening mee te houden

De repository-README en `README_PSD.md` bevatten nog enkele oude statements, terwijl changelog en actuele bron nieuwere ondersteuning aantonen. Voor implementatiebeslissingen geldt deze volgorde:

1. actuele source code;
2. actuele tests;
3. changelog;
4. `README_PSD.md`;
5. hoofd-README.

Verifieer kritieke features altijd met een eigen Photoshop-generated fixture voordat Lighttable ze als volledig ondersteund markeert.
